// Cookie-based auth: the candidate's access code is stored in a signed,
// httpOnly cookie once they log in. There's no server-side session store —
// every request re-validates the code against the roster, so revoking a
// candidate's access (by editing candidates.json) takes effect on their
// very next request.
const roster = require('../lib/roster');

const COOKIE_NAME = 'candidate_code';
const COOKIE_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12h: generous for one sitting

function isRequestSecure(req) {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

function setCandidateCookie(req, res, code) {
  res.cookie(COOKIE_NAME, code, {
    httpOnly: true,
    signed: true,
    sameSite: 'lax',
    secure: isRequestSecure(req),
    maxAge: COOKIE_MAX_AGE_MS,
  });
}

function clearCandidateCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

function requireAuth(req, res, next) {
  const code = req.signedCookies && req.signedCookies[COOKIE_NAME];
  if (!code) return res.status(401).json({ error: '请先使用面试官提供的代码登录' });
  const candidate = roster.lookupCandidate(code);
  if (!candidate) return res.status(401).json({ error: '登录凭证已失效，请重新使用代码登录' });
  req.candidate = candidate;
  next();
}

module.exports = { requireAuth, setCandidateCookie, clearCandidateCookie, COOKIE_NAME };
