const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const apiRouter = require('./routes/api');
const roster = require('./lib/roster');

try {
  roster.assertRosterConfigured();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 4173;
const COOKIE_SECRET = process.env.COOKIE_SECRET;

if (!COOKIE_SECRET) {
  console.warn(
    '警告：未设置 COOKIE_SECRET 环境变量，正在使用仅供本地开发的默认值。\n' +
    '部署到公网前必须设置一个随机字符串，例如：COOKIE_SECRET=$(openssl rand -hex 32)'
  );
}

// Required for secure cookies and correct client IPs (rate limiting) when
// running behind a reverse proxy that terminates TLS.
app.set('trust proxy', 1);

app.use(cookieParser(COOKIE_SECRET || 'dev-only-insecure-secret-change-me'));
app.use('/api', apiRouter);
app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  console.log(`Trajectory annotation tool running at http://localhost:${PORT}`);
});
