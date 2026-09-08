// 会议室预约系统 · Supabase Edge Function（Deno）
// 取代 Node/Express 服务：同函数托管前端 + 提供 /api 后端
// verify_jwt = false，微信匿名扫码可直接调用
import { Pool } from "https://deno.land/x/postgres@v0.19.3/mod.ts";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") || "";
const pool = new Pool(DB_URL, 1);
const DEFAULT_PASS = "appleipad2";
const PREFIX = "/mbapi";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

/* ---------------- 工具 ---------------- */
function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}
async function query(sql: string, params: any[] = []) {
  const client = await pool.connect();
  try {
    return await client.queryObject(sql, params);
  } finally {
    client.release();
  }
}
async function getSetting(key: string) {
  try {
    const r: any = await query("SELECT value FROM settings WHERE key=$1", [key]);
    if (r.rowCount === 0) return null;
    let v = r.rows[0].value;
    if (typeof v === "string") { try { v = JSON.parse(v); } catch {} }
    return v;
  } catch { return null; }
}
async function setSetting(key: string, value: any) {
  await query(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value=$2",
    [key, value],
  );
}
async function getAdminPass() {
  try {
    const r: any = await query("SELECT value FROM admin_auth WHERE key='adminPass'");
    if (r.rowCount > 0) {
      let v = r.rows[0].value;
      if (typeof v === "string") { try { v = JSON.parse(v); } catch {} }
      if (v) return v;
    }
  } catch {}
  return DEFAULT_PASS;
}
async function isAdmin(password: string | undefined) {
  const pass = await getAdminPass();
  return !!password && password === pass;
}

/* ---------------- 通知（失败静默） ---------------- */
async function sendNotify(b: any) {
  try {
    const n = await getSetting("notify");
    if (!n || !n.notifyOnNew) return;
    const text = `【新会议室预约】\n会议室：${b.roomName || ""}\n时间：${b.date} ${b.start}-${b.end}\n公司：${b.company}\n预约人：${b.name}\n电话：${b.phone}`;
    if (n.webhook) {
      await fetch(n.webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ msgtype: "text", text: { content: text } }),
      }).catch(() => {});
    }
    if (n.serverChan) {
      await fetch(`https://sctapi.ftqq.com/${n.serverChan}.send`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `title=${encodeURIComponent("新会议室预约")}&desp=${encodeURIComponent(text)}`,
      }).catch(() => {});
    }
  } catch {}
}

/* ---------------- 归一化 ---------------- */
function normBooking(r: any) {
  return {
    id: r.id, roomId: r.room_id, roomName: r.room_name,
    company: r.company, name: r.name, phone: r.phone,
    date: r.date, start: r.start_time, end: r.end_time,
    duration: r.duration, remark: r.remark, status: r.status,
    createdAt: r.created_at, cancelledAt: r.cancelled_at,
  };
}
function normRoom(r: any) {
  return {
    id: r.id, name: r.name, shortName: r.short_name,
    capacity: r.capacity, location: r.location, desc: r.description,
    icon: r.icon, color: r.color, sort: r.sort,
    enabled: r.enabled !== false, createdAt: r.created_at,
  };
}
function normBlackout(r: any) {
  let wd = r.weekly_days;
  if (typeof wd === "string") { try { wd = JSON.parse(wd); } catch { wd = []; } }
  if (!Array.isArray(wd)) wd = [];
  return {
    id: r.id, roomId: r.room_id, type: r.type,
    date: r.date, startDate: r.start_date, endDate: r.end_date,
    weeklyDays: wd, startTime: r.start_time, endTime: r.end_time,
    reason: r.reason, createdAt: r.created_at,
  };
}
function normSetting(list: any[]) {
  const map: any = {};
  (list || []).forEach((r) => { map[r.key] = r.value; });
  return map;
}

/* ---------------- 只读接口 ---------------- */
const READ_TABLES: Record<string, string> = {
  rooms: "SELECT * FROM rooms ORDER BY sort ASC",
  blackouts: "SELECT * FROM blackouts",
  public_settings: "SELECT * FROM public_settings",
};
async function handleRead(url: URL) {
  const table = url.searchParams.get("t");
  if (!READ_TABLES[table || ""] && table !== "booking_slots") {
    return json({ ok: false, error: "bad_table" });
  }
  try {
    let rows: any[];
    if (table === "booking_slots") {
      const wheres: string[] = []; const params: string[] = []; let i = 1;
      for (const col of ["room_id", "date", "status"]) {
        const w = url.searchParams.get("w_" + col);
        if (w !== null) { wheres.push(`${col}=$${i++}`); params.push(w); }
      }
      const sql = "SELECT * FROM booking_slots" +
        (wheres.length ? " WHERE " + wheres.join(" AND ") : "") +
        " ORDER BY start_time ASC";
      rows = (await query(sql, params)).rows;
    } else {
      rows = (await query(READ_TABLES[table!])).rows;
    }
    return json({ ok: true, data: rows });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e) });
  }
}

/* ---------------- 动作分发 ---------------- */
async function dispatch(action: string, password: string | undefined, data: any) {
  data = data || {};
  switch (action) {
    case "createBooking": {
      const b = data;
      if (!b.roomId || !b.date || !b.start || !b.end || !b.company || !b.name || !b.phone) {
        return { ok: false, error: "invalid" };
      }
      // ===== 预约规则校验（后端权威，防绕过前端） =====
      const rules: any = (await getSetting("rules")) || {};
      const granularity = Number(rules.minDuration) || 30;
      const maxDuration = Number(rules.maxDuration) || 180;
      const dailyCount = Number(rules.perCompanyDailyCount) || 2;
      const dailyMinutes = Number(rules.perCompanyDailyMinutes) || 360;
      const toMin = (t: string) => {
        const [h, m] = String(t).split(":").map(Number);
        return h * 60 + m;
      };
      const span = toMin(b.end) - toMin(b.start);
      const dur = span > 0 ? span : Number(b.duration) || 0;
      if (dur <= 0 || dur % granularity !== 0 || dur > maxDuration) {
        return {
          ok: false, error: "bad_duration",
          msg: `单次预约时长须为 ${granularity} 分钟的倍数，且不超过 ${maxDuration / 60} 小时`,
        };
      }
      // 每企业每天：预约次数 + 累计时长上限（取消的预约不占额度）
      const comp = String(b.company).trim();
      const day: any = await query(
        `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(duration),0)::int AS mins
         FROM bookings WHERE date=$1 AND status='ok' AND lower(company)=lower($2)`,
        [b.date, comp],
      );
      const cnt = Number(day.rows[0]?.cnt) || 0;
      const used = Number(day.rows[0]?.mins) || 0;
      if (cnt >= dailyCount) {
        return {
          ok: false, error: "company_daily_limit",
          msg: `每家企业每天最多预约 ${dailyCount} 次，如需调整请联系管理员`,
        };
      }
      if (used + dur > dailyMinutes) {
        return {
          ok: false, error: "company_daily_minutes",
          msg: `每家企业每天累计预约不超过 ${dailyMinutes / 60} 小时（今日已用 ${used} 分钟）`,
        };
      }
      const overlap: any = await query(
        `SELECT id FROM booking_slots WHERE room_id=$1 AND date=$2 AND status='ok' AND start_time < $3 AND end_time > $4`,
        [b.roomId, b.date, b.end, b.start],
      );
      if (overlap.rowCount > 0) {
        return { ok: false, error: "conflict", conflict: { roomName: b.roomName } };
      }
      const id = "BK" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
      await query(
        `INSERT INTO bookings (id, room_id, room_name, company, name, phone, date, start_time, end_time, duration, remark, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ok')`,
        [id, b.roomId, b.roomName || "", b.company, b.name, b.phone, b.date, b.start, b.end, dur, b.remark || ""],
      );
      await sendNotify(b);
      const record = {
        id, roomId: b.roomId, roomName: b.roomName, company: b.company, name: b.name,
        phone: b.phone, date: b.date, start: b.start, end: b.end, duration: dur,
        remark: b.remark || "", status: "ok", createdAt: new Date().toISOString(),
      };
      return { ok: true, id, record };
    }
    case "adminLogin": {
      const pass = await getAdminPass();
      return { ok: !!password && password === pass };
    }
    case "adminListBookings": {
      if (!(await isAdmin(password))) return { ok: false, error: "unauthorized" };
      const wheres: string[] = []; const params: any[] = []; let i = 1;
      if (data.roomId) { wheres.push(`room_id=$${i++}`); params.push(data.roomId); }
      if (data.date) { wheres.push(`date=$${i++}`); params.push(data.date); }
      if (data.status) { wheres.push(`status=$${i++}`); params.push(data.status); }
      const sql = "SELECT * FROM bookings" +
        (wheres.length ? " WHERE " + wheres.join(" AND ") : "") +
        " ORDER BY date DESC, start_time ASC";
      return { ok: true, data: (await query(sql, params)).rows.map(normBooking) };
    }
    case "adminCancelBooking": {
      if (!(await isAdmin(password))) return { ok: false, error: "unauthorized" };
      await query("UPDATE bookings SET status='cancelled', cancelled_at=NOW() WHERE id=$1", [data.id]);
      return { ok: true };
    }
    /* ---------- 我的预约（公开：手机号定位 + 双重验证取消） ---------- */
    case "myBookings": {
      // 公开接口：按手机号查询该用户的所有预约（状态不限）
      const phone = String(data?.phone || "").trim();
      if (!/^1[3-9]\d{9}$/.test(phone)) return { ok: false, error: "bad_phone" };
      try {
        const rows = (await query(
          "SELECT * FROM bookings WHERE phone=$1 ORDER BY date DESC, start_time ASC",
          [phone],
        )).rows;
        return { ok: true, data: rows.map(normBooking) };
      } catch (e: any) {
        return { ok: false, error: String(e?.message || e) };
      }
    }
    case "myCancelBooking": {
      // 双重验证：预约号 + 手机号后 4 位必须匹配
      const id = String(data?.id || "").trim();
      const phone = String(data?.phone || "").trim();
      if (!id || !/^(\d{4}|1[3-9]\d{9})$/.test(phone)) return { ok: false, error: "invalid" };
      try {
        const r: any = await query(
          "SELECT id, phone, status, date, start_time FROM bookings WHERE id=$1",
          [id],
        );
        if (r.rowCount === 0) return { ok: false, error: "not_found" };
        const b = r.rows[0];
        if (b.status === "cancelled") return { ok: false, error: "already_cancelled" };
        if (String(b.phone || "").slice(-4) !== phone.slice(-4)) {
          return { ok: false, error: "phone_mismatch" };
        }
        await query(
          "UPDATE bookings SET status='cancelled', cancelled_at=NOW() WHERE id=$1",
          [id],
        );
        return { ok: true };
      } catch (e: any) {
        return { ok: false, error: String(e?.message || e) };
      }
    }
    case "adminExportBookings": {
      if (!(await isAdmin(password))) return { ok: false, error: "unauthorized" };
      const list = (await query("SELECT * FROM bookings ORDER BY date DESC, start_time ASC")).rows.map(normBooking);
      return { ok: true, data: list };
    }
    case "adminListRooms": {
      if (!(await isAdmin(password))) return { ok: false, error: "unauthorized" };
      return { ok: true, data: (await query("SELECT * FROM rooms ORDER BY sort ASC")).rows.map(normRoom) };
    }
    case "adminAddRoom": {
      if (!(await isAdmin(password))) return { ok: false, error: "unauthorized" };
      const r = data;
      const id = r.id || ("RM" + Date.now().toString(36).toUpperCase());
      await query(
        `INSERT INTO rooms (id, name, short_name, capacity, location, description, icon, color, sort, enabled)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, r.name, r.shortName || null, r.capacity || 10, r.location || null, r.desc || null, r.icon || "users", r.color || "blue", r.sort || 999, r.enabled !== false],
      );
      return { ok: true, id };
    }
    case "adminUpdateRoom": {
      if (!(await isAdmin(password))) return { ok: false, error: "unauthorized" };
      const r = data;
      await query(
        `UPDATE rooms SET name=$1, short_name=$2, capacity=$3, location=$4, description=$5, icon=$6, color=$7, sort=$8, enabled=$9 WHERE id=$10`,
        [r.name, r.shortName || null, r.capacity || 10, r.location || null, r.desc || null, r.icon || "users", r.color || "blue", r.sort || 999, r.enabled !== false, r.id],
      );
      return { ok: true };
    }
    case "adminRemoveRoom": {
      if (!(await isAdmin(password))) return { ok: false, error: "unauthorized" };
      await query("DELETE FROM rooms WHERE id=$1", [data.id]);
      await query("DELETE FROM blackouts WHERE room_id=$1", [data.id]);
      return { ok: true };
    }
    case "adminAddBlackout": {
      if (!(await isAdmin(password))) return { ok: false, error: "unauthorized" };
      const b = data;
      const id = "BL" + Date.now().toString(36).toUpperCase();
      await query(
        `INSERT INTO blackouts (id, room_id, type, date, start_date, end_date, weekly_days, start_time, end_time, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, b.roomId, b.type, b.date || null, b.startDate || null, b.endDate || null, b.weeklyDays || [], b.startTime, b.endTime, b.reason || null],
      );
      return { ok: true, id };
    }
    case "adminRemoveBlackout": {
      if (!(await isAdmin(password))) return { ok: false, error: "unauthorized" };
      await query("DELETE FROM blackouts WHERE id=$1", [data.id]);
      return { ok: true };
    }
    case "adminGetSettings": {
      if (!(await isAdmin(password))) return { ok: false, error: "unauthorized" };
      const list = (await query("SELECT key, value FROM settings")).rows;
      return { ok: true, data: normSetting(list as any[]) };
    }
    case "adminSaveSettings": {
      if (!(await isAdmin(password))) return { ok: false, error: "unauthorized" };
      await setSetting(data.key, data.value);
      return { ok: true };
    }
    case "adminSetPass": {
      if (!(await isAdmin(password))) return { ok: false, error: "unauthorized" };
      const np = data.newPass;
      if (!np || String(np).length < 6) return { ok: false, error: "weak" };
      await query(
        `INSERT INTO admin_auth (key, value) VALUES ('adminPass', $1) ON CONFLICT (key) DO UPDATE SET value=$1`,
        [np],
      );
      return { ok: true };
    }
    case "debugEnv": {
      if (!(await isAdmin(password))) return { ok: false, error: "unauthorized" };
      return { ok: true, info: { db: !!DB_URL, adminPassSet: true } };
    }
    default:
      return { ok: false, error: "unknown_action" };
  }
}

/* ---------------- 主处理 ---------------- */
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  let rem = url.pathname.replace(PREFIX, "");
  if (rem === "") rem = "/";

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (rem === "/api/ping") return json({ ok: true, ts: Date.now() });
  if (rem === "/api/read" && req.method === "GET") return await handleRead(url);
  if (rem === "/api" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const result = await dispatch(body.action, body.password, body.data);
    return json(result);
  }
  // 前端托管在 GitHub Pages（永久在线，无休眠无回收）；Edge Function 提供永久固定入口，302 跳转。
  // 二维码指向本函数地址，前端托管地址变更时只需改这里重新 deploy。
  const FRONTEND_BASE = "https://weiyicheng750.github.io/meeting-booking";
  if (!rem.startsWith("/api")) {
    return new Response(null, {
      status: 302,
      headers: { ...corsHeaders, Location: FRONTEND_BASE + (rem === "/" ? "/" : rem) },
    });
  }
  return new Response("Not found", { status: 404, headers: corsHeaders });
});
