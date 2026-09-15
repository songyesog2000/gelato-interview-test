// Thin filesystem layer. Two directories under DATA_ROOT:
//   trajectories/  - raw .jsonl session files the interviewee drops in
//   annotations/   - one JSON document per trajectory, holding the human's
//                    annotation work; filenames mirror the trajectory id.
const fs = require('fs');
const path = require('path');

const DATA_ROOT = path.join(__dirname, '..', '..', 'data');
const TRAJECTORIES_DIR = path.join(DATA_ROOT, 'trajectories');
const ANNOTATIONS_DIR = path.join(DATA_ROOT, 'annotations');

for (const dir of [TRAJECTORIES_DIR, ANNOTATIONS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

// Trajectory ids are derived from filenames and used to name annotation
// files, so we only accept the safe subset of characters a real session
// filename would have (uuid / timestamp style names).
const SAFE_ID = /^[A-Za-z0-9._-]+$/;

function isSafeId(id) {
  return typeof id === 'string' && id.length > 0 && SAFE_ID.test(id) && !id.includes('..');
}

function listTrajectories() {
  return fs
    .readdirSync(TRAJECTORIES_DIR)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => {
      const stat = fs.statSync(path.join(TRAJECTORIES_DIR, name));
      return { id: name, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function readTrajectoryRaw(id) {
  if (!isSafeId(id)) throw new HttpError(400, 'invalid trajectory id');
  const filePath = path.join(TRAJECTORIES_DIR, id);
  if (!fs.existsSync(filePath)) throw new HttpError(404, `trajectory not found: ${id}`);
  return fs.readFileSync(filePath, 'utf8');
}

function annotationPath(id) {
  return path.join(ANNOTATIONS_DIR, `${id}.json`);
}

function readAnnotation(id) {
  if (!isSafeId(id)) throw new HttpError(400, 'invalid trajectory id');
  const filePath = annotationPath(id);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeAnnotation(id, doc) {
  if (!isSafeId(id)) throw new HttpError(400, 'invalid trajectory id');
  fs.writeFileSync(annotationPath(id), JSON.stringify(doc, null, 2), 'utf8');
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = {
  TRAJECTORIES_DIR,
  ANNOTATIONS_DIR,
  isSafeId,
  listTrajectories,
  readTrajectoryRaw,
  readAnnotation,
  writeAnnotation,
  HttpError,
};
