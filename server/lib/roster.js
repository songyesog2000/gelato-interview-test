// Candidate access-code roster. The interviewer maintains a plain
// "code -> name" JSON file on the server; there is no self-service sign-up.
// The roster is re-read from disk on every lookup (it's a tiny file) so
// revoking a code by editing it takes effect immediately, without a
// restart or deploy.
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'candidates.json');
const EXAMPLE_PATH = path.join(__dirname, '..', 'config', 'candidates.example.json');

// Codes double as directory names under data/candidates/, so they're held
// to the same safe character set as everything else derived from user input.
const CODE_RE = /^[A-Za-z0-9._-]+$/;

function setupInstructions() {
  return (
    `未找到候选人名单文件: ${CONFIG_PATH}\n` +
    `请复制 ${EXAMPLE_PATH} 为 candidates.json，并填入实际的"代码: 姓名"对照表后重新启动。`
  );
}

function loadRoster() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(setupInstructions());
  }
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const roster = {};
  for (const [code, name] of Object.entries(raw)) {
    if (!CODE_RE.test(code)) {
      throw new Error(`candidates.json 中的代码 "${code}" 含有非法字符，只允许字母、数字、点、下划线、短横线`);
    }
    roster[code] = name;
  }
  return roster;
}

// Called once at server startup so a missing/malformed roster fails loudly
// on boot instead of surfacing as confusing 401s on every request.
function assertRosterConfigured() {
  loadRoster();
}

function lookupCandidate(code) {
  if (typeof code !== 'string' || !CODE_RE.test(code)) return null;
  const roster = loadRoster();
  const name = roster[code];
  return name ? { code, name } : null;
}

module.exports = { lookupCandidate, assertRosterConfigured, CONFIG_PATH, CODE_RE };
