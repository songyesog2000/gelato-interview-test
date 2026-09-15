// Filesystem layer, scoped per logged-in candidate. Trajectory files can
// live under two roots that are both auto-scanned on every list request:
//   data/candidates/<code>/trajectories/  - writable; where this candidate
//                          drops/imports their own session files. Subfolders
//                          are treated as groups for the sidebar.
//   samples/             - read-only reference material shipped with the
//                          repo, shared by every candidate; shows up in the
//                          sidebar automatically.
//   data/candidates/<code>/annotations/  - one JSON document per trajectory
//                          id, holding that candidate's annotation work.
//
// Every function below takes the candidate's `code` (already validated
// against the roster by the auth middleware) as its first argument so one
// candidate can never read or write another's files.
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const DATA_ROOT = path.join(PROJECT_ROOT, 'data');
const CANDIDATES_ROOT = path.join(DATA_ROOT, 'candidates');
const SAMPLES_DIR = path.join(PROJECT_ROOT, 'samples');

fs.mkdirSync(CANDIDATES_ROOT, { recursive: true });

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Trajectory ids look like "trajectories/batch1/session.jsonl" or
// "samples/sample-trajectory.jsonl": the first path segment picks the root,
// the rest is a relative path inside it. Every segment is validated on its
// own so ".." or an absolute path can never escape the root directory.
const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

function isSafeSegment(segment) {
  return typeof segment === 'string' && segment.length > 0 && segment !== '.' && segment !== '..' && SEGMENT_RE.test(segment);
}

// Candidate codes are validated against the roster before they ever reach
// here, but a directory name built from user input gets checked again
// regardless — defense in depth.
function rootsFor(code) {
  if (!isSafeSegment(code)) throw new HttpError(400, 'invalid candidate code');
  const base = path.join(CANDIDATES_ROOT, code);
  const trajectoriesDir = path.join(base, 'trajectories');
  const annotationsDir = path.join(base, 'annotations');
  fs.mkdirSync(trajectoriesDir, { recursive: true });
  fs.mkdirSync(annotationsDir, { recursive: true });
  return {
    annotationsDir,
    roots: {
      trajectories: { dir: trajectoriesDir, writable: true, groupLabel: null },
      samples: { dir: SAMPLES_DIR, writable: false, groupLabel: '样本参考（只读）' },
    },
  };
}

function resolveId(roots, id) {
  if (typeof id !== 'string' || id.length === 0) throw new HttpError(400, 'invalid trajectory id');
  const segments = id.split('/');
  const root = roots[segments[0]];
  if (!root) throw new HttpError(400, `unknown trajectory root: ${segments[0]}`);
  const relSegments = segments.slice(1);
  if (relSegments.length === 0 || !relSegments.every(isSafeSegment)) {
    throw new HttpError(400, `invalid trajectory id: ${id}`);
  }
  return { root, relPath: path.join(...relSegments), absPath: path.join(root.dir, ...relSegments) };
}

function walkJsonlFiles(dir, baseDir = dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkJsonlFiles(abs, baseDir));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      results.push(path.relative(baseDir, abs));
    }
  }
  return results;
}

function listTrajectories(code) {
  const { roots } = rootsFor(code);
  const items = [];
  for (const [rootKey, root] of Object.entries(roots)) {
    for (const relPath of walkJsonlFiles(root.dir)) {
      const abs = path.join(root.dir, relPath);
      const stat = fs.statSync(abs);
      const parts = relPath.split(path.sep);
      const filename = parts[parts.length - 1];
      const groupParts = parts.slice(0, -1);
      const group = root.groupLabel || (groupParts.length > 0 ? groupParts.join('/') : '未分组');
      items.push({
        id: [rootKey, ...parts].join('/'),
        group,
        filename,
        writable: root.writable,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
    }
  }
  items.sort((a, b) => (a.group || '').localeCompare(b.group || '') || a.filename.localeCompare(b.filename));
  return items;
}

function readTrajectoryRaw(code, id) {
  const { roots } = rootsFor(code);
  const { absPath } = resolveId(roots, id);
  if (!fs.existsSync(absPath)) throw new HttpError(404, `trajectory not found: ${id}`);
  return fs.readFileSync(absPath, 'utf8');
}

function annotationFilenameFor(roots, id) {
  resolveId(roots, id); // validates shape; throws HttpError(400) if malformed
  return `${id.replace(/\//g, '__')}.json`;
}

function readAnnotation(code, id) {
  const { roots, annotationsDir } = rootsFor(code);
  const filePath = path.join(annotationsDir, annotationFilenameFor(roots, id));
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeAnnotation(code, id, doc) {
  const { roots, annotationsDir } = rootsFor(code);
  const filePath = path.join(annotationsDir, annotationFilenameFor(roots, id));
  fs.writeFileSync(filePath, JSON.stringify(doc, null, 2), 'utf8');
}

const FILENAME_RE = /^[^/\\]+\.jsonl$/;

function renameTrajectory(code, id, newFilename) {
  const { roots, annotationsDir } = rootsFor(code);
  const { root, absPath, relPath } = resolveId(roots, id);
  if (!root.writable) throw new HttpError(403, '样本文件为只读参考，不能重命名');
  const base = newFilename.replace(/\.jsonl$/, '');
  if (!FILENAME_RE.test(newFilename) || !isSafeSegment(base)) {
    throw new HttpError(400, '文件名需以 .jsonl 结尾，且只能包含字母、数字、点、下划线、短横线');
  }
  if (!fs.existsSync(absPath)) throw new HttpError(404, `trajectory not found: ${id}`);
  const newAbsPath = path.join(path.dirname(absPath), newFilename);
  if (newAbsPath !== absPath && fs.existsSync(newAbsPath)) {
    throw new HttpError(409, `目标文件名已存在: ${newFilename}`);
  }
  fs.renameSync(absPath, newAbsPath);

  const newRelPath = path.join(path.dirname(relPath), newFilename);
  const newId = ['trajectories', ...newRelPath.split(path.sep)].join('/');

  // Carry over any existing annotation work so renaming doesn't orphan it.
  const oldAnnotationPath = path.join(annotationsDir, annotationFilenameFor(roots, id));
  if (id !== newId && fs.existsSync(oldAnnotationPath)) {
    const doc = JSON.parse(fs.readFileSync(oldAnnotationPath, 'utf8'));
    doc.trajectoryId = newId;
    if (doc.meta) doc.meta.原始会话文件名 = newFilename;
    const newAnnotationPath = path.join(annotationsDir, annotationFilenameFor(roots, newId));
    fs.writeFileSync(newAnnotationPath, JSON.stringify(doc, null, 2), 'utf8');
    fs.unlinkSync(oldAnnotationPath);
  }
  return newId;
}

function importTrajectory(code, { group, filename, content }) {
  const { roots } = rootsFor(code);
  if (typeof filename !== 'string' || !FILENAME_RE.test(filename) || !isSafeSegment(filename.replace(/\.jsonl$/, ''))) {
    throw new HttpError(400, '文件名需以 .jsonl 结尾，且只能包含字母、数字、点、下划线、短横线');
  }
  const groupSegments = (group || '').split('/').filter(Boolean);
  if (!groupSegments.every(isSafeSegment)) {
    throw new HttpError(400, '分组名称只能包含字母、数字、点、下划线、短横线');
  }
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new HttpError(400, '文件内容为空');
  }
  const targetDir = path.join(roots.trajectories.dir, ...groupSegments);
  fs.mkdirSync(targetDir, { recursive: true });
  const absPath = path.join(targetDir, filename);
  if (fs.existsSync(absPath)) throw new HttpError(409, `已存在同名文件: ${filename}`);
  fs.writeFileSync(absPath, content, 'utf8');
  return ['trajectories', ...groupSegments, filename].join('/');
}

module.exports = {
  CANDIDATES_ROOT,
  SAMPLES_DIR,
  listTrajectories,
  readTrajectoryRaw,
  renameTrajectory,
  importTrajectory,
  readAnnotation,
  writeAnnotation,
  HttpError,
};
