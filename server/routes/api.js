const express = require('express');
const { parseJsonlTrajectory } = require('../lib/jsonlParser');
const schema = require('../lib/annotationSchema');
const store = require('../storage/fileStore');

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

router.get('/schema', (req, res) => {
  res.json({
    stages: schema.STAGES,
    conclusions: schema.CONCLUSIONS,
    issueTypes: schema.ISSUE_TYPES,
    tools: schema.TOOLS,
  });
});

router.get('/trajectories', asyncRoute((req, res) => {
  res.json(store.listTrajectories());
}));

router.get('/trajectories/:id', asyncRoute((req, res) => {
  const raw = store.readTrajectoryRaw(req.params.id);
  const parsed = parseJsonlTrajectory(raw);
  res.json(parsed);
}));

router.get('/annotations/:id', asyncRoute((req, res) => {
  const doc = store.readAnnotation(req.params.id) || schema.emptyDocument(req.params.id);
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
  store.writeAnnotation(req.params.id, doc);
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
  const doc = store.readAnnotation(req.params.id);
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
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}.annotations.csv"`);
  res.send('﻿' + csv); // BOM so Excel/飞书导入 renders Chinese correctly
}));

router.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'internal error' });
});

module.exports = router;
