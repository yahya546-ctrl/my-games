require('dotenv').config();
const express = require('express'), helmet = require('helmet'), rateLimit = require('express-rate-limit'), multer = require('multer'),
  AdmZip = require('adm-zip'), bcrypt = require('bcryptjs'), crypto = require('crypto'), path = require('path'), fs = require('fs');
const db = require('./db');
const PROD = process.env.NODE_ENV === 'production', PORT = process.env.PORT || 3000;
const DATA = path.resolve(process.env.DATA_DIR || './data');
const GAMES = path.join(DATA, 'games'), THUMBS = path.join(DATA, 'thumbs'), TMP = path.join(DATA, 'tmp');
[GAMES, THUMBS, TMP].forEach(d => fs.mkdirSync(d, { recursive: true }));
const MAX_ZIP = (+process.env.MAX_GAME_MB || 100) * 1024 * 1024, MAX_UNZIP = MAX_ZIP * 3;

const app = express(); app.set('trust proxy', 1);
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const err = (res, code, msg) => res.status(code).json({ error: msg });

// ---------- Session (server-side, token hashed in DB) ----------
app.use((req, res, next) => {
  req.user = null;
  const t = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('sid='))?.slice(4);
  if (t) {
    const u = db.prepare('SELECT u.id,u.username,u.email,u.role,u.banned FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires>?').get(sha(t), Date.now());
    if (u && !u.banned) req.user = u;
  }
  next();
});
const needUser = (req, res, next) => req.user ? next() : err(res, 401, 'Please log in');
const needAdmin = (req, res, next) => !req.user ? err(res, 401, 'Please log in') : req.user.role !== 'admin' ? err(res, 403, 'Forbidden') : next();

// ---------- Game files (no site CSP here so games run normally; login required) ----------
app.use('/play/:id', (req, res, next) => {
  if (!req.user) return res.status(401).send('Login required');
  const g = db.prepare('SELECT id,published,source_type FROM games WHERE id=?').get(+req.params.id);
  if (!g || g.source_type !== 'files' || (!g.published && req.user.role !== 'admin')) return res.sendStatus(404);
  res.set('X-Content-Type-Options', 'nosniff');
  express.static(path.join(GAMES, String(g.id)), { index: 'index.html', dotfiles: 'deny' })(req, res, next);
});

app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'https:'], frameSrc: ["'self'", 'https:'], connectSrc: ["'self'"], objectSrc: ["'none'"] } },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '50kb' }));
app.use('/api', (req, res, next) => { // CSRF: reject cross-site state-changing requests
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
    try { if (new URL(req.headers.origin).host !== req.headers.host) return err(res, 403, 'Bad origin'); } catch { return err(res, 403, 'Bad origin'); }
  }
  next();
});

// ---------- Auth ----------
const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
function startSession(res, userId) {
  const t = crypto.randomBytes(32).toString('hex'), ttl = 7 * 864e5;
  db.prepare('INSERT INTO sessions(id,user_id,expires) VALUES(?,?,?)').run(sha(t), userId, Date.now() + ttl);
  res.cookie('sid', t, { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: ttl, path: '/' });
}
app.post('/api/auth/signup', authLimit, (req, res) => {
  const { username = '', email = '', password = '' } = req.body || {};
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return err(res, 400, 'Username: 3-20 letters, numbers or _');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) return err(res, 400, 'Enter a valid email');
  if (typeof password !== 'string' || password.length < 8 || password.length > 100) return err(res, 400, 'Password must be 8-100 characters');
  if (db.prepare('SELECT 1 FROM users WHERE username=? OR email=?').get(username, email)) return err(res, 409, 'Username or email already used');
  const id = db.prepare("INSERT INTO users(username,email,password_hash,role,created_at) VALUES(?,?,?,'user',?)").run(username, email, bcrypt.hashSync(password, 12), Date.now()).lastInsertRowid;
  startSession(res, id); res.json({ user: { id, username, email, role: 'user' } });
});
app.post('/api/auth/login', authLimit, (req, res) => {
  const { login = '', password = '' } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username=? OR email=?').get(String(login), String(login));
  const ok = bcrypt.compareSync(String(password), u ? u.password_hash : '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi');
  if (!u || !ok) return err(res, 401, 'Wrong username or password');
  if (u.banned) return err(res, 403, 'This account is suspended');
  startSession(res, u.id); res.json({ user: { id: u.id, username: u.username, email: u.email, role: u.role } });
});
app.post('/api/auth/logout', (req, res) => {
  const t = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('sid='))?.slice(4);
  if (t) db.prepare('DELETE FROM sessions WHERE id=?').run(sha(t));
  res.clearCookie('sid'); res.json({ ok: true });
});
app.get('/api/me', (req, res) => res.json({ user: req.user }));
const siteName = () => db.prepare("SELECT value FROM settings WHERE key='site_name'").get()?.value || 'MY GAME LAUNCHER';
app.get('/api/settings', (req, res) => res.json({ site_name: siteName() }));

// ---------- Public games API ----------
const PUB = 'g.id,g.name,g.description,g.category,g.version,g.thumbnail,g.source_type,g.game_url,g.plays,g.featured,g.created_at';
const FAV = uid => `EXISTS(SELECT 1 FROM favorites f WHERE f.game_id=g.id AND f.user_id=${+uid || 0}) AS fav`;
app.get('/api/games', (req, res) => {
  const { q = '', category = '', sort = 'latest', featured = '', limit = '60' } = req.query;
  const where = ['g.published=1'], args = [];
  if (q) { where.push('(g.name LIKE ? OR g.description LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  if (category) { where.push('g.category=?'); args.push(category); }
  if (featured === '1') where.push('g.featured=1');
  const order = { latest: 'g.created_at DESC', most_played: 'g.plays DESC', popular: '(SELECT COUNT(*) FROM favorites f WHERE f.game_id=g.id) DESC, g.plays DESC' }[sort] || 'g.created_at DESC';
  res.json({ games: db.prepare(`SELECT ${PUB},${FAV(req.user?.id)} FROM games g WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`).all(...args, Math.min(+limit || 60, 200)) });
});
app.get('/api/categories', (req, res) => res.json({ categories: db.prepare('SELECT category AS name, COUNT(*) AS n FROM games WHERE published=1 GROUP BY category ORDER BY n DESC').all() }));
app.get('/api/games/:id', (req, res) => {
  const g = db.prepare(`SELECT ${PUB},g.published,${FAV(req.user?.id)} FROM games g WHERE g.id=?`).get(+req.params.id);
  if (!g || (!g.published && req.user?.role !== 'admin')) return err(res, 404, 'Game not found');
  res.json({ game: g });
});
app.post('/api/games/:id/play', needUser, (req, res) => {
  const g = db.prepare('SELECT id,published FROM games WHERE id=?').get(+req.params.id);
  if (!g || (!g.published && req.user.role !== 'admin')) return err(res, 404, 'Game not found');
  db.prepare('UPDATE games SET plays=plays+1 WHERE id=?').run(g.id);
  db.prepare('INSERT INTO recent(user_id,game_id,played_at) VALUES(?,?,?) ON CONFLICT(user_id,game_id) DO UPDATE SET played_at=excluded.played_at').run(req.user.id, g.id, Date.now());
  res.json({ ok: true });
});
app.get('/api/favorites', needUser, (req, res) => res.json({ games: db.prepare(`SELECT ${PUB},1 AS fav FROM games g JOIN favorites f ON f.game_id=g.id WHERE f.user_id=? AND g.published=1`).all(req.user.id) }));
app.post('/api/favorites/:id', needUser, (req, res) => { db.prepare('INSERT OR IGNORE INTO favorites VALUES(?,?)').run(req.user.id, +req.params.id); res.json({ ok: true }); });
app.delete('/api/favorites/:id', needUser, (req, res) => { db.prepare('DELETE FROM favorites WHERE user_id=? AND game_id=?').run(req.user.id, +req.params.id); res.json({ ok: true }); });
app.get('/api/recent', needUser, (req, res) => res.json({ games: db.prepare(`SELECT ${PUB},${FAV(req.user.id)} FROM games g JOIN recent r ON r.game_id=g.id WHERE r.user_id=? AND g.published=1 ORDER BY r.played_at DESC LIMIT 12`).all(req.user.id) }));

// ---------- Admin API ----------
const admin = express.Router(); admin.use(needAdmin);
const upload = multer({ dest: TMP, limits: { fileSize: MAX_ZIP, files: 2, fields: 12 } })
  .fields([{ name: 'thumbnail', maxCount: 1 }, { name: 'gamefile', maxCount: 1 }]);
const cleanTmp = f => Object.values(f || {}).flat().forEach(x => fs.rm(x.path, { force: true }, () => {}));
const withUpload = (req, res, next) => upload(req, res, e => e ? err(res, 400, e.code === 'LIMIT_FILE_SIZE' ? `File too large (max ${MAX_ZIP >> 20} MB)` : 'Upload failed') : next());

function saveThumb(f) {
  if (f.size > 2 * 1024 * 1024) throw new Error('Thumbnail must be under 2 MB');
  const b = Buffer.alloc(12), fd = fs.openSync(f.path, 'r'); fs.readSync(fd, b, 0, 12, 0); fs.closeSync(fd);
  const ext = b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ? 'png' : b.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'jpg'
    : (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') ? 'webp' : null;
  if (!ext) throw new Error('Thumbnail must be PNG, JPG or WEBP');
  const name = crypto.randomBytes(12).toString('hex') + '.' + ext;
  fs.copyFileSync(f.path, path.join(THUMBS, name)); return '/thumbs/' + name;
}
function extractGame(f, id) {
  const head = Buffer.alloc(4), fd = fs.openSync(f.path, 'r'); fs.readSync(fd, head, 0, 4, 0); fs.closeSync(fd);
  if (head.toString('hex') !== '504b0304') throw new Error('Game file must be a .zip');
  const entries = new AdmZip(f.path).getEntries().filter(e => !e.isDirectory);
  if (!entries.length || entries.length > 5000) throw new Error('Zip has no files or too many files');
  const BAD = /\.(php\d?|exe|dll|sh|bat|cmd|jsp|asp|aspx|py|cgi|pl|so)$/i;
  let total = 0;
  for (const e of entries) { total += e.header.size; if (BAD.test(e.entryName)) throw new Error('Blocked file type: ' + e.entryName); }
  if (total > MAX_UNZIP) throw new Error('Unzipped game is too large');
  const names = entries.map(e => e.entryName.replace(/\\/g, '/'));
  let prefix = '';
  if (!names.includes('index.html')) { const m = names.find(n => /^[^/]+\/index\.html$/.test(n)); if (!m) throw new Error('Zip must contain index.html at its root'); prefix = m.split('/')[0] + '/'; }
  const dir = path.join(GAMES, String(id)); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  entries.forEach((e, i) => {
    const n = names[i]; if (!n.startsWith(prefix)) return;
    const dest = path.resolve(dir, n.slice(prefix.length));
    if (!dest.startsWith(dir + path.sep)) throw new Error('Unsafe path in zip'); // zip-slip protection
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, e.getData());
  });
}
const clip = (s, n) => String(s ?? '').trim().slice(0, n);
const flag = v => (v === '1' || v === 'true' || v === 'on') ? 1 : 0;
const rmThumb = t => t && fs.rm(path.join(THUMBS, path.basename(t)), { force: true }, () => {});

admin.get('/stats', (req, res) => res.json({
  totalGames: db.prepare('SELECT COUNT(*) c FROM games').get().c, publishedGames: db.prepare('SELECT COUNT(*) c FROM games WHERE published=1').get().c,
  totalUsers: db.prepare('SELECT COUNT(*) c FROM users').get().c, totalPlays: db.prepare('SELECT COALESCE(SUM(plays),0) c FROM games').get().c,
  newUsers7d: db.prepare('SELECT COUNT(*) c FROM users WHERE created_at>?').get(Date.now() - 7 * 864e5).c,
  top: db.prepare('SELECT id,name,plays FROM games ORDER BY plays DESC LIMIT 10').all()
}));
admin.get('/games', (req, res) => res.json({ games: db.prepare('SELECT * FROM games ORDER BY created_at DESC').all() }));
admin.post('/games', withUpload, (req, res) => {
  const f = req.files || {}, b = req.body; let id;
  try {
    const name = clip(b.name, 80); if (!name) throw new Error('Game name is required');
    const url = clip(b.game_url, 500), zip = f.gamefile?.[0];
    if (!zip && !/^https:\/\/\S+$/.test(url)) throw new Error('Provide a game .zip or an https:// Game URL');
    const thumb = f.thumbnail?.[0] ? saveThumb(f.thumbnail[0]) : null;
    id = db.prepare('INSERT INTO games(name,description,category,version,thumbnail,source_type,game_url,published,featured,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(name, clip(b.description, 2000), clip(b.category, 30) || 'General', clip(b.version, 20) || '1.0', thumb, zip ? 'files' : 'url', zip ? null : url, flag(b.published), flag(b.featured), Date.now()).lastInsertRowid;
    if (zip) extractGame(zip, id);
    res.json({ id });
  } catch (e) { if (id) { db.prepare('DELETE FROM games WHERE id=?').run(id); fs.rmSync(path.join(GAMES, String(id)), { recursive: true, force: true }); } err(res, 400, e.message); }
  finally { cleanTmp(f); }
});
admin.put('/games/:id', withUpload, (req, res) => {
  const f = req.files || {}, b = req.body, id = +req.params.id;
  try {
    const g = db.prepare('SELECT * FROM games WHERE id=?').get(id); if (!g) throw new Error('Game not found');
    const name = clip(b.name, 80) || g.name, zip = f.gamefile?.[0], url = clip(b.game_url, 500);
    let type = g.source_type, gurl = g.game_url, thumb = g.thumbnail;
    if (zip) { extractGame(zip, id); type = 'files'; gurl = null; }
    else if (url) { if (!/^https:\/\/\S+$/.test(url)) throw new Error('Game URL must start with https://'); type = 'url'; gurl = url; }
    if (f.thumbnail?.[0]) { thumb = saveThumb(f.thumbnail[0]); rmThumb(g.thumbnail); }
    db.prepare('UPDATE games SET name=?,description=?,category=?,version=?,thumbnail=?,source_type=?,game_url=?,featured=?,published=? WHERE id=?')
      .run(name, b.description !== undefined ? clip(b.description, 2000) : g.description, clip(b.category, 30) || g.category, clip(b.version, 20) || g.version, thumb, type, gurl,
        b.featured !== undefined ? flag(b.featured) : g.featured, b.published !== undefined ? flag(b.published) : g.published, id);
    res.json({ ok: true });
  } catch (e) { err(res, 400, e.message); } finally { cleanTmp(f); }
});
admin.post('/games/:id/publish', (req, res) => { db.prepare('UPDATE games SET published=1 WHERE id=?').run(+req.params.id); res.json({ ok: true }); });
admin.post('/games/:id/unpublish', (req, res) => { db.prepare('UPDATE games SET published=0 WHERE id=?').run(+req.params.id); res.json({ ok: true }); });
admin.delete('/games/:id', (req, res) => {
  const g = db.prepare('SELECT thumbnail FROM games WHERE id=?').get(+req.params.id); if (!g) return err(res, 404, 'Game not found');
  db.prepare('DELETE FROM games WHERE id=?').run(+req.params.id); rmThumb(g.thumbnail);
  fs.rmSync(path.join(GAMES, String(+req.params.id)), { recursive: true, force: true }); res.json({ ok: true });
});
admin.get('/users', (req, res) => res.json({ users: db.prepare('SELECT id,username,email,role,banned,created_at FROM users ORDER BY created_at DESC').all() }));
admin.post('/users/:id/:action', (req, res) => {
  const id = +req.params.id; if (id === req.user.id) return err(res, 400, "You can't change your own account here");
  const a = req.params.action;
  if (a === 'ban' || a === 'unban') { db.prepare('UPDATE users SET banned=? WHERE id=?').run(a === 'ban' ? 1 : 0, id); if (a === 'ban') db.prepare('DELETE FROM sessions WHERE user_id=?').run(id); }
  else if (a === 'make-admin' || a === 'make-user') db.prepare('UPDATE users SET role=? WHERE id=?').run(a === 'make-admin' ? 'admin' : 'user', id);
  else return err(res, 400, 'Unknown action');
  res.json({ ok: true });
});
admin.put('/settings', (req, res) => { db.prepare("INSERT INTO settings(key,value) VALUES('site_name',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(clip(req.body?.site_name, 40) || 'MY GAME LAUNCHER'); res.json({ ok: true }); });
app.use('/api/admin', admin);
app.use('/api', (req, res) => err(res, 404, 'Not found'));

// ---------- Admin pages: protected on the server ----------
app.use('/admin', (req, res, next) => req.user?.role === 'admin' ? next() : res.redirect('/#/login'), express.static(path.join(__dirname, 'views/admin')));

// ---------- Public site ----------
app.use('/thumbs', express.static(THUMBS, { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public')));
app.listen(PORT, () => console.log(`Game launcher running on http://localhost:${PORT}`));
