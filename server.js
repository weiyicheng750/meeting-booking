/* ============================================================
 * 会议室预约系统 · 后端服务（Node.js + Express + PostgreSQL）
 * 取代 CloudBase 云函数 mbapi + rdb() 只读，统一走 HTTP API
 * 前端同域部署（public/），零跨域；免费部署到 Render
 *
 * 适配数据库：
 *   - CloudBase PostgreSQL（公网连接串）
 *   - Supabase 免费 PG（自动启用 SSL）
 *   - 任何标准 PostgreSQL（通过 DATABASE_URL 连接串）
 *
 * 环境变量：
 *   DATABASE_URL   PostgreSQL 连接串（必填）
 *   ADMIN_PASS     后台密码（可选，默认 appleipad2）
 *   PORT           端口（Render 自动注入，本地默认 3000）
 * ============================================================ */

require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const DEFAULT_PASS = 'appleipad2';

// SSL 自动识别：Supabase / 含 sslmode=require 时启用，其他默认不开
const connStr = process.env.DATABASE_URL || '';
const wantSsl = /sslmode=(require|verify-full|verify-ca)/i.test(connStr)
             || /supabase\.com|pooler\.supabase/i.test(connStr);
const poolConfig = { connectionString: connStr || undefined };
if (connStr && wantSsl) poolConfig.ssl = { rejectUnauthorized: false };
const pool = new Pool(poolConfig);

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

/* ---------------- 工具 ---------------- */
function ok(res, data) { res.json(Object.assign({ ok: true }, data)); }
function fail(res, error, extra) { res.json(Object.assign({ ok: false, error }, extra || {})); }

async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params || []);
  } finally {
    client.release();
  }
}

// 读取 settings 的 JSON value（兼容 JSONB 与 TEXT 两种列类型）
async function getSetting(key) {
  try {
    const r = await query('SELECT value FROM settings WHERE key=$1', [key]);
    if (r.rowCount === 0) return null;
    let v = r.rows[0].value;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) {} }
    return v;
  } catch (e) { return null; }
}
async function setSetting(key, value) {
  await query(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value=$2',
    [key, value]
  );
}

async function getAdminPass() {
  try {
    const r = await query("SELECT value FROM admin_auth WHERE key='adminPass'");
    if (r.rowCount > 0) {
      let v = r.rows[0].value;
      if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) {} }
      if (v) return v;
    }
  } catch (e) {}
  return DEFAULT_PASS;
}
async function isAdmin(password) {
  const pass = await getAdminPass();
  return !!password && password === pass;
}

/* ---------------- 通知（失败不影响主流程） ---------------- */
async function sendNotify(b) {
  try {
    const n = await getSetting('notify');
    if (!n || !n.notifyOnNew) return;
    const text = `【新会议室预约】\n会议室：${b.roomName || ''}\n时间：${b.date} ${b.start}-${b.end}\n公司：${b.company}\n预约人：${b.name}\n电话：${b.phone}`;
    if (n.webhook) {
      await fetch(n.webhook, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'text', text: { content: text } })
      }).catch(() => {});
    }
    if (n.serverChan) {
      await fetch(`https://sctapi.ftqq.com/${n.serverChan}.send`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `title=${encodeURIComponent('新会议室预约')}&desp=${encodeURIComponent(text)}`
      }).catch(() => {});
    }
  } catch (e) { /* 通知失败静默 */ }
}

/* ---------------- 归一化（snake_case → camelCase） ---------------- */
function normBooking(r) {
  return {
    id: r.id, roomId: r.room_id, roomName: r.room_name,
    company: r.company, name: r.name, phone: r.phone,
    date: r.date, start: r.start_time, end: r.end_time,
    duration: r.duration, remark: r.remark, status: r.status,
    createdAt: r.created_at, cancelledAt: r.cancelled_at
  };
}
function normRoom(r) {
  return {
    id: r.id, name: r.name, shortName: r.short_name,
    capacity: r.capacity, location: r.location, desc: r.description,
    icon: r.icon, color: r.color, sort: r.sort,
    enabled: r.enabled !== false, createdAt: r.created_at
  };
}
function normBlackout(r) {
  let wd = r.weekly_days;
  if (typeof wd === 'string') { try { wd = JSON.parse(wd); } catch (e) { wd = []; } }
  if (!Array.isArray(wd)) wd = [];
  return {
    id: r.id, roomId: r.room_id, type: r.type,
    date: r.date, startDate: r.start_date, endDate: r.end_date,
    weeklyDays: wd, startTime: r.start_time, endTime: r.end_time,
    reason: r.reason, createdAt: r.created_at
  };
}
function normSetting(list) {
  const map = {};
  (list || []).forEach(r => { map[r.key] = r.value; });
  return map;
}

/* ---------------- 只读接口 /api/read ---------------- */
const READ_TABLES = {
  rooms: 'SELECT * FROM rooms ORDER BY sort ASC',
  blackouts: 'SELECT * FROM blackouts',
  public_settings: 'SELECT * FROM public_settings'
};
const READ_WHITELIST_COLS = { booking_slots: ['room_id', 'date', 'status'] };

app.get('/api/read', async (req, res) => {
  const table = req.query.t;
  if (!Object.prototype.hasOwnProperty.call(READ_TABLES, table) && table !== 'booking_slots') {
    return fail(res, 'bad_table');
  }
  try {
    let rows;
    if (table === 'booking_slots') {
      const wheres = []; const params = []; let i = 1;
      (READ_WHITELIST_COLS.booking_slots).forEach(col => {
        if (req.query['w_' + col] !== undefined) {
          wheres.push(`${col}=$${i++}`);
          params.push(req.query['w_' + col]);
        }
      });
      const sql = 'SELECT * FROM booking_slots'
        + (wheres.length ? ' WHERE ' + wheres.join(' AND ') : '')
        + ' ORDER BY start_time ASC';
      rows = (await query(sql, params)).rows;
    } else {
      rows = (await query(READ_TABLES[table])).rows;
    }
    ok(res, { data: rows });
  } catch (e) {
    console.error('[read]', table, e.message);
    fail(res, String(e.message || e));
  }
});

/* ---------------- 写/管理接口 /api ---------------- */
app.post('/api', async (req, res) => {
  const { action, password, data } = req.body || {};
  try {
    const result = await dispatch(action, password, data || {});
    res.json(result);
  } catch (e) {
    console.error('[api]', action, e.message);
    fail(res, String(e.message || e));
  }
});

async function dispatch(action, password, data) {
  switch (action) {

    /* ============ 公开：提交预约（含冲突校验 + 通知） ============ */
    case 'createBooking': {
      const b = data;
      if (!b.roomId || !b.date || !b.start || !b.end || !b.company || !b.name || !b.phone) {
        return { ok: false, error: 'invalid' };
      }
      const overlap = await query(
        `SELECT id FROM booking_slots WHERE room_id=$1 AND date=$2 AND status='ok' AND start_time < $3 AND end_time > $4`,
        [b.roomId, b.date, b.end, b.start]
      );
      if (overlap.rowCount > 0) {
        return { ok: false, error: 'conflict', conflict: { roomName: b.roomName } };
      }
      const id = 'BK' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
      await query(
        `INSERT INTO bookings (id, room_id, room_name, company, name, phone, date, start_time, end_time, duration, remark, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ok')`,
        [id, b.roomId, b.roomName || '', b.company, b.name, b.phone, b.date, b.start, b.end, b.duration || 60, b.remark || '']
      );
      await sendNotify(b);
      const record = {
        id, roomId: b.roomId, roomName: b.roomName, company: b.company, name: b.name,
        phone: b.phone, date: b.date, start: b.start, end: b.end, duration: b.duration || 60,
        remark: b.remark || '', status: 'ok', createdAt: new Date().toISOString()
      };
      return { ok: true, id, record };
    }

    /* ============ 管理：登录校验 ============ */
    case 'adminLogin': {
      const pass = await getAdminPass();
      return { ok: !!password && password === pass };
    }

    /* ============ 管理：预约列表 ============ */
    case 'adminListBookings': {
      if (!(await isAdmin(password))) return { ok: false, error: 'unauthorized' };
      const wheres = []; const params = []; let i = 1;
      if (data.roomId) { wheres.push(`room_id=$${i++}`); params.push(data.roomId); }
      if (data.date) { wheres.push(`date=$${i++}`); params.push(data.date); }
      if (data.status) { wheres.push(`status=$${i++}`); params.push(data.status); }
      const sql = 'SELECT * FROM bookings'
        + (wheres.length ? ' WHERE ' + wheres.join(' AND ') : '')
        + ' ORDER BY date DESC, start_time ASC';
      return { ok: true, data: (await query(sql, params)).rows.map(normBooking) };
    }

    /* ============ 管理：取消预约 ============ */
    case 'adminCancelBooking': {
      if (!(await isAdmin(password))) return { ok: false, error: 'unauthorized' };
      await query("UPDATE bookings SET status='cancelled', cancelled_at=NOW() WHERE id=$1", [data.id]);
      return { ok: true };
    }

    /* ============ 管理：导出全部 ============ */
    case 'adminExportBookings': {
      if (!(await isAdmin(password))) return { ok: false, error: 'unauthorized' };
      const list = (await query('SELECT * FROM bookings ORDER BY date DESC, start_time ASC')).rows.map(normBooking);
      return { ok: true, data: list };
    }

    /* ============ 管理：会议室 ============ */
    case 'adminListRooms': {
      if (!(await isAdmin(password))) return { ok: false, error: 'unauthorized' };
      return { ok: true, data: (await query('SELECT * FROM rooms ORDER BY sort ASC')).rows.map(normRoom) };
    }
    case 'adminAddRoom': {
      if (!(await isAdmin(password))) return { ok: false, error: 'unauthorized' };
      const r = data;
      const id = r.id || ('RM' + Date.now().toString(36).toUpperCase());
      await query(
        `INSERT INTO rooms (id, name, short_name, capacity, location, description, icon, color, sort, enabled)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, r.name, r.shortName || null, r.capacity || 10, r.location || null, r.desc || null, r.icon || 'users', r.color || 'blue', r.sort || 999, r.enabled !== false]
      );
      return { ok: true, id };
    }
    case 'adminUpdateRoom': {
      if (!(await isAdmin(password))) return { ok: false, error: 'unauthorized' };
      const r = data;
      await query(
        `UPDATE rooms SET name=$1, short_name=$2, capacity=$3, location=$4, description=$5, icon=$6, color=$7, sort=$8, enabled=$9 WHERE id=$10`,
        [r.name, r.shortName || null, r.capacity || 10, r.location || null, r.desc || null, r.icon || 'users', r.color || 'blue', r.sort || 999, r.enabled !== false, r.id]
      );
      return { ok: true };
    }
    case 'adminRemoveRoom': {
      if (!(await isAdmin(password))) return { ok: false, error: 'unauthorized' };
      await query('DELETE FROM rooms WHERE id=$1', [data.id]);
      await query('DELETE FROM blackouts WHERE room_id=$1', [data.id]);
      return { ok: true };
    }

    /* ============ 管理：禁约 ============ */
    case 'adminAddBlackout': {
      if (!(await isAdmin(password))) return { ok: false, error: 'unauthorized' };
      const b = data;
      const id = 'BL' + Date.now().toString(36).toUpperCase();
      await query(
        `INSERT INTO blackouts (id, room_id, type, date, start_date, end_date, weekly_days, start_time, end_time, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, b.roomId, b.type, b.date || null, b.startDate || null, b.endDate || null, b.weeklyDays || [], b.startTime, b.endTime, b.reason || null]
      );
      return { ok: true, id };
    }
    case 'adminRemoveBlackout': {
      if (!(await isAdmin(password))) return { ok: false, error: 'unauthorized' };
      await query('DELETE FROM blackouts WHERE id=$1', [data.id]);
      return { ok: true };
    }

    /* ============ 管理：设置 ============ */
    case 'adminGetSettings': {
      if (!(await isAdmin(password))) return { ok: false, error: 'unauthorized' };
      const list = (await query('SELECT key, value FROM settings')).rows;
      return { ok: true, data: normSetting(list) };
    }
    case 'adminSaveSettings': {
      if (!(await isAdmin(password))) return { ok: false, error: 'unauthorized' };
      await setSetting(data.key, data.value);
      return { ok: true };
    }
    case 'adminSetPass': {
      if (!(await isAdmin(password))) return { ok: false, error: 'unauthorized' };
      const np = data.newPass;
      if (!np || String(np).length < 6) return { ok: false, error: 'weak' };
      await query(
        `INSERT INTO admin_auth (key, value) VALUES ('adminPass', $1) ON CONFLICT (key) DO UPDATE SET value=$1`,
        [np]
      );
      return { ok: true };
    }

    /* ============ 诊断 ============ */
    case 'debugEnv': {
      if (!(await isAdmin(password))) return { ok: false, error: 'unauthorized' };
      return { ok: true, info: { db: !!process.env.DATABASE_URL, adminPassSet: true } };
    }

    default:
      return { ok: false, error: 'unknown_action' };
  }
}

/* ---------------- 健康检查 ---------------- */
app.get('/api/ping', (req, res) => res.json({ ok: true, ts: Date.now() }));

/* ---------------- 静态文件（仅 public/，根目录不暴露）---------------- */
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.listen(PORT, () => {
  console.log(`会议室预约服务已启动: http://localhost:${PORT}`);
});
