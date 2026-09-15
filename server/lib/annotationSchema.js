// Shared constants describing the annotation vocabulary and the shape of a
// stored annotation document. Kept as plain data (no classes) so both the
// server (validation) and any future export/report code can reuse it.

const STAGES = ['初始实现', '功能扩展', '缺陷处理', '代码理解'];

const CONCLUSIONS = ['发现错误', '未发现错误', '暂不能判断'];

const ISSUE_TYPES = [
  { code: 'E01', label: '明确指令未遵循' },
  { code: 'E02', label: '需求理解偏差' },
  { code: 'E03', label: '幻觉或失实陈述' },
  { code: 'E04', label: '工具使用错误' },
  { code: 'E05', label: '代码质量问题' },
  { code: 'E06', label: '效率与冗余' },
  { code: 'E07', label: '沟通与解释问题' },
  { code: 'E08', label: '偏离任务或越权操作' },
  { code: 'ENV', label: '环境故障（非模型原因）' },
  { code: 'USER', label: '用户误操作/主动转向/题目问题' },
  { code: 'OTHER', label: '其他（无法归类）' },
];

const TOOLS = ['Claude Code CLI', 'Codex CLI'];

// One "问题标注" entry inside a record's issues[] array.
function emptyIssue(seq) {
  return {
    编号: `P${String(seq).padStart(2, '0')}`,
    类型: [],
    问题现象: '',
    判断理由: '',
    影响与恢复: '',
    改进建议: '',
  };
}

// One row of the delivery table ("一次实际指令对应一条记录").
function emptyRecord(index) {
  return {
    index,
    阶段: STAGES[0],
    本次输入: '',
    核查结论: '',
    问题标注: [],
    异常与疑点: '',
  };
}

function emptyDocument(trajectoryId) {
  return {
    trajectoryId,
    meta: {
      作答人: '',
      使用工具: '',
      模型配置: '',
      原始会话文件名: trajectoryId,
      最终代码链接: '',
    },
    records: [],
  };
}

module.exports = {
  STAGES,
  CONCLUSIONS,
  ISSUE_TYPES,
  TOOLS,
  emptyIssue,
  emptyRecord,
  emptyDocument,
};
