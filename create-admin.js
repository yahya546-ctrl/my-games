require('dotenv').config();
const bcrypt = require('bcryptjs'), db = require('../db');
const { ADMIN_USERNAME: u, ADMIN_EMAIL: e, ADMIN_PASSWORD: p } = process.env;
if (!u || !e || !p || p.length < 10) { console.error('Set ADMIN_USERNAME, ADMIN_EMAIL and ADMIN_PASSWORD (min 10 chars) in .env'); process.exit(1); }
const hash = bcrypt.hashSync(p, 12);
const ex = db.prepare('SELECT id FROM users WHERE username=? OR email=?').get(u, e);
if (ex) { db.prepare("UPDATE users SET role='admin', password_hash=?, banned=0 WHERE id=?").run(hash, ex.id); console.log('Existing account promoted/updated to admin'); }
else { db.prepare("INSERT INTO users(username,email,password_hash,role,created_at) VALUES(?,?,?,'admin',?)").run(u, e, hash, Date.now()); console.log('Admin account created'); }
console.log('Now delete ADMIN_PASSWORD from your .env file.');
