// 用戶認證模組: 密碼 hash (scrypt) + 註冊/登入/session + 權限
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import db from './db.mjs';

const SESSION_TTL_DAYS = 30;

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const h = scryptSync(password, salt, 64);
  const hh = Buffer.from(hash, 'hex');
  return h.length === hh.length && timingSafeEqual(h, hh);
}
function newToken() {
  return randomBytes(32).toString('hex');
}

// 種子 admin: 若無任何用戶, 建 admin/admin123 (首次部署後請立即改密)
export async function ensureSeedAdmin() {
  const rows = await db.execute('SELECT COUNT(*) AS c FROM gd_users');
  if (rows.rows[0].c > 0) return;
  await db.execute({
    sql: 'INSERT INTO gd_users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)',
    args: ['admin', hashPassword('admin123'), '管理員', 'admin'],
  });
}

// 註冊 (第一個用戶自動成 admin)
export async function register(username, password, displayName = '') {
  username = (username || '').trim();
  if (!username || !password) throw new Error('帳號與密碼必填');
  if (password.length < 6) throw new Error('密碼至少 6 字元');
  const ex = (await db.execute({ sql: 'SELECT id FROM gd_users WHERE username = ?', args: [username] })).rows[0];
  if (ex) throw new Error('帳號已存在');
  const cnt = (await db.execute('SELECT COUNT(*) AS c FROM gd_users')).rows[0].c;
  const role = cnt === 0 ? 'admin' : 'user';
  const r = await db.execute({
    sql: 'INSERT INTO gd_users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)',
    args: [username, hashPassword(password), displayName || username, role],
  });
  return Number(r.lastInsertRowid);
}

// 登入: 成功回 { token, user }
export async function login(username, password) {
  const u = (await db.execute({ sql: 'SELECT * FROM gd_users WHERE username = ?', args: [username] })).rows[0];
  if (!u || !verifyPassword(password, u.password_hash)) throw new Error('帳號或密碼錯誤');
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 864e5).toISOString();
  await db.execute({ sql: 'INSERT INTO gd_sessions (token, user_id, expires_at) VALUES (?, ?, ?)', args: [token, u.id, expires] });
  return { token, user: publicUser(u) };
}

export async function logout(token) {
  await db.execute({ sql: 'DELETE FROM gd_sessions WHERE token = ?', args: [token] });
}

// 由 token 取用戶 (無效/過期回 null)
export async function getUserByToken(token) {
  if (!token) return null;
  const s = (await db.execute({ sql: 'SELECT * FROM gd_sessions WHERE token = ?', args: [token] })).rows[0];
  if (!s) return null;
  if (s.expires_at && new Date(s.expires_at) < new Date()) {
    await db.execute({ sql: 'DELETE FROM gd_sessions WHERE token = ?', args: [token] });
    return null;
  }
  const u = (await db.execute({ sql: 'SELECT * FROM gd_users WHERE id = ?', args: [s.user_id] })).rows[0];
  return u ? publicUser(u) : null;
}

export async function getUserById(id) {
  const u = (await db.execute({ sql: 'SELECT * FROM gd_users WHERE id = ?', args: [id] })).rows[0];
  return u ? publicUser(u) : null;
}

// 管理員重設密碼
export async function resetPassword(userId, newPassword) {
  if (!newPassword || newPassword.length < 6) throw new Error('新密碼至少 6 字元');
  await db.execute({ sql: 'UPDATE gd_users SET password_hash = ? WHERE id = ?', args: [hashPassword(newPassword), userId] });
}

export async function listUsers() {
  return (await db.execute('SELECT id, username, display_name, role, created_at FROM gd_users ORDER BY id')).rows;
}

export async function deleteUser(userId) {
  await db.execute({ sql: 'DELETE FROM gd_sessions WHERE user_id = ?', args: [userId] });
  await db.execute({ sql: 'DELETE FROM gd_users WHERE id = ?', args: [userId] });
}

function publicUser(u) {
  return { id: u.id, username: u.username, displayName: u.display_name, role: u.role };
}

// 從 req 取 cookie token
export function tokenFromReq(req) {
  const h = req.headers?.cookie || '';
  const m = h.match(/(?:^|;\s*)gd_token=([a-f0-9]+)/);
  return m ? m[1] : null;
}
