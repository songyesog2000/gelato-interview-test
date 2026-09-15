const express = require('express');
const rateLimit = require('express-rate-limit');
const { parseJsonlTrajectory } = require('../lib/jsonlParser');
const schema = require('../lib/annotationSchema');
const store = require('../storage/fileStore');
const roster = require('../lib/roster');
const { requireAuth, setCandidateCookie, clearCandidateCookie } = require('../middleware/auth');

const router = express.Router();

function asyncRoute(handler) {
  return (req, res, next) => {
    try {
      handler(req, res);
    } catch (err) {
      next(err);
    }
  };
}

// The access code is the only credential in this system, so login attempts
// are capped per IP to slow down brute-forcing a candidate's code.
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '尝试次数过多，请 10 分钟后再试' },
});

router.post('/login', loginLimiter, express.json(), asyncRoute((req, res) => {
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  const candidate = roster.lookupCandidate(code);
  if (!candidate) return res.status(401).json({ error: '代码无效，请核实后重试' });
  setCandidateCookie(req, res, code);
  res.json({ name: candidate.name });
}));

router.post('/logout', (req, res) => {
  clearCandidateCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ name: req.candidate.name });
});

router.get('/schema', (req, res) => {
  res.json({
    stages: schema.STAGES,
    conclusions: schema.CONCLUSIONS,
    issueTypes: schema.ISSUE_TYPES,
    tools: schema.TOOLS,
  });
});

// Everything below reads/writes one candidate's own files; requireAuth
// resolves that candidate from the signed cookie and nothing else.
router.use(['/trajectories', '/annotations'], requireAuth);

router.get('/trajectories', asyncRoute((req, res) => {
  res.json(store.listTrajectories(req.candidate.code));
}));

router.post('/trajectories', express.json({ limit: '20mb' }), asyncRoute((req, res) => {
  const { group, filename, content } = req.body || {};
  const id = store.importTrajectory(req.candidate.code, { group, filename, content });
  res.status(201).json({ id });
}));

router.get('/trajectories/:id', asyncRoute((req, res) => {
  const raw = store.readTrajectoryRaw(req.candidate.code, req.params.id);
  const parsed = parseJsonlTrajectory(raw);
  res.json(parsed);
}));

router.patch('/trajectories/:id', express.json(), asyncRoute((req, res) => {
  const { newFilename } = req.body || {};
  if (typeof newFilename !== 'string' || newFilename.trim().length === 0) {
    return res.status(400).json({ error: '缺少 newFilename' });
  }
  const id = store.renameTrajectory(req.candidate.code, req.params.id, newFilename.trim());
  res.json({ id });
}));

router.get('/annotations/:id', asyncRoute((req, res) => {
  const doc = store.readAnnotation(req.candidate.code, req.params.id) || schema.emptyDocument(req.params.id);
  res.json(doc);
}));

function validateDocument(doc) {
  if (!doc || typeof doc !== 'object') return '请求体必须是一个 JSON 对象';
  if (!doc.meta || typeof doc.meta !== 'object') return '缺少 meta 字段';
  if (!Array.isArray(doc.records)) return 'records 必须是数组';
  for (const [i, record] of doc.records.entries()) {
    if (typeof record.index !== 'number') return `records[${i}] 缺少 index`;
    if (record.阶段 && !schema.STAGES.includes(record.阶段)) return `records[${i}] 阶段取值无效: ${record.阶段}`;
    if (record.核查结论 && !schema.CONCLUSIONS.includes(record.核查结论)) {
      return `records[${i}] 核查结论取值无效: ${record.核查结论}`;
    }
    if (record.问题标注 && !Array.isArray(record.问题标注)) return `records[${i}].问题标注 必须是数组`;
  }
  return null;
}

router.put('/annotations/:id', express.json({ limit: '10mb' }), asyncRoute((req, res) => {
  const error = validateDocument(req.body);
  if (error) return res.status(400).json({ error });
  const doc = { ...req.body, trajectoryId: req.params.id };
  store.writeAnnotation(req.candidate.code, req.params.id, doc);
  res.json({ ok: true });
}));

function csvEscape(value) {
  const str = value === undefined || value === null ? '' : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function formatIssues(issues) {
  if (!Array.isArray(issues) || issues.length === 0) return '';
  return issues
    .map((issue) => {
      const types = (issue.类型 || []).join('+');
      return `${issue.编号}｜${types} 现象：${issue.问题现象}｜理由：${issue.判断理由}｜影响与恢复：${issue.影响与恢复}｜改进建议：${issue.改进建议}`;
    })
    .join('\n');
}

router.get('/annotations/:id/export', asyncRoute((req, res) => {
  const doc = store.readAnnotation(req.candidate.code, req.params.id);
  if (!doc) return res.status(404).json({ error: '尚无标注数据' });

  const columns = [
    '作答人', '实施阶段', '交互顺序', '本次输入', '核查结论',
    '问题标注', '异常与疑点', '使用工具', '模型配置', '原始会话', '最终代码链接',
  ];
  const rows = [columns];
  doc.records
    .slice()
    .sort((a, b) => a.index - b.index)
    .forEach((record, i) => {
      rows.push([
        doc.meta.作答人,
        record.阶段,
        record.index,
        record.本次输入,
        record.核查结论,
        formatIssues(record.问题标注),
        record.异常与疑点,
        i === 0 ? doc.meta.使用工具 : '',
        i === 0 ? doc.meta.模型配置 : '',
        i === 0 ? doc.meta.原始会话文件名 : '',
        i === 0 ? doc.meta.最终代码链接 : '',
      ]);
    });

  const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
  const safeFilename = req.params.id.replace(/\//g, '__');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}.annotations.csv"`);
  res.send('﻿' + csv); // BOM so Excel/飞书导入 renders Chinese correctly
}));

router.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'internal error' });
});

module.exports = router;
