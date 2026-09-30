const Database = require('better-sqlite3'), path = require('path'), fs = require('fs');
const dir = path.resolve(process.env.DATA_DIR || './data');
fs.mkdirSync(dir, { recursive: true });
const db = new Database(path.join(dir, 'app.db'));
db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL COLLATE NOCASE, email TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
  banned INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS games(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'General',
  version TEXT NOT NULL DEFAULT '1.0', thumbnail TEXT, source_type TEXT NOT NULL CHECK(source_type IN ('files','url')),
  game_url TEXT, published INTEGER NOT NULL DEFAULT 0, featured INTEGER NOT NULL DEFAULT 0,
  plays INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS favorites(user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, game_id INTEGER REFERENCES games(id) ON DELETE CASCADE, PRIMARY KEY(user_id,game_id));
CREATE TABLE IF NOT EXISTS recent(user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, game_id INTEGER REFERENCES games(id) ON DELETE CASCADE, played_at INTEGER NOT NULL, PRIMARY KEY(user_id,game_id));
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS idx_games_pub ON games(published, created_at);
`);
db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
module.exports = db;
