/* ============================================
 * 会议室预约系统 · 数据层（CloudBase PostgreSQL 版）
 * 前端匿名直连 rdb() 读；写操作走云函数 mbapi（service_role）
 * 本地降级：无网络/无环境时退回 localStorage
 * ============================================================ */

// ===== 云端配置 =====
const CLOUDBASE_ENV = 'meeting-d0gv3pa8v2ae97a3e';
const CLOUDBASE_ACCESS_KEY = 'eyJhbGciOiJSUzI1NiIsImtpZCI6ImE4OGM5NWVlLTI1MzgtNDBlNy04Mjk4LWU3YjkxZjk0MWU1OSJ9.eyJpc3MiOiJodHRwczovL21lZXRpbmctZDBndjNwYTh2MmFlOTdhM2UuYXAtc2hhbmdoYWkudGNiLWFwaS50ZW5jZW50Y2xvdWRhcGkuY29tIiwic3ViIjoiYW5vbiIsImF1ZCI6Im1lZXRpbmctZDBndjNwYTh2MmFlOTdhM2UiLCJleHAiOjQwOTI0NTM4MjAsImlhdCI6MTc4ODc3MDYyMCwibm9uY2UiOiJISExjektXVVFIU041aHZKQVVyRVdnIiwiYXRfaGFzaCI6IkhITGN6S1dVUUhTTjVodkpBVXJFV2ciLCJuYW1lIjoiQW5vbnltb3VzIiwic2NvcGUiOiJhbm9ueW1vdXMiLCJwcm9qZWN0X2lkIjoibWVldGluZy1kMGd2M3BhOHYyYWU5N2EzZSIsIm1ldGEiOnsicGxhdGZvcm0iOiJQdWJsaXNoYWJsZUtleSJ9LCJyb2xlIjoiYW5vbiIsImlzX2Fub255bW91cyI6dHJ1ZSwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiYW5vbnltb3VzIiwicHJvdmlkZXJzIjpbImFub255bW91cyJdfSwidXNlcl9tZXRhZGF0YSI6eyJuYW1lIjoiQW5vbnltb3VzIn0sInVzZXJfdHlwZSI6IiIsImNsaWVudF90eXBlIjoiY2xpZW50X3VzZXIiLCJpc19zeXN0ZW1fYWRtaW4iOmZhbHNlfQ.CC1I41A8_CDn9MW-j_pa0G3DtmGAfOzG4Fxc0BJI7kKPeOjX5iC0ln8dgWJvcWgS99mGDisSYWetzty6-cAVRzh2wiZ7mgmEQbd2h4m_YeaODG1IY2H29C1tYoq5Y3W7fk2RrKD50WCIHxrLovYHiZJEe0vfoNFQmRNMs6EbNbfa8TJus7Y_8tEnciqXkC7i88muI-709Ocy0LxaRHb4U-Ka8-HxoOWsFtu-kTnw7R8zK7HCYXsJDvIuyh9PiVHGISoG543fSbETQqHjfNLZtK2g9B-AJ2zHiZH_ND9BEVWjFep3XX7BvHBcr5XgcJiQB7CLzeAnik0m0Ku7k26-jw';
const DEFAULT_PASS = 'appleipad2';

// 本地降级用的存储 Key
const K = {
  BOOKINGS: 'mb_bookings_v2',
  ADMIN: 'mb_admin_pass',
  SEEDED: 'mb_seeded_v2',
  ROOMS: 'mb_rooms',
  BLACKOUTS: 'mb_blackouts',
  RULES: 'mb_rules',
  NOTIFY: 'mb_notify'
};

// 8个图标预设
const ICONS = [
  { id: 'users', svg: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
  { id: 'sofa', svg: '<path d="M20 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3"/><path d="M2 11v5a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v2H6v-2a2 2 0 0 0-4 0Z"/><path d="M4 18v2"/><path d="M20 18v2"/>' },
  { id: 'presentation', svg: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>' },
  { id: 'board', svg: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>' },
  { id: 'phone', svg: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92Z"/>' },
  { id: 'diamond', svg: '<path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z"/>' },
  { id: 'crown', svg: '<path d="M2 20h20"/><path d="m2 9 4 3 5-7 5 7 4-3v11H2z"/>' },
  { id: 'star', svg: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>' }
];

// 8个颜色
const COLORS = [
  { id: 'blue', bg: '#EEF2FF', fg: '#5B7CFA' },
  { id: 'purple', bg: '#F5F3FF', fg: '#8B5CF6' },
  { id: 'green', bg: '#ECFDF5', fg: '#10B981' },
  { id: 'orange', bg: '#FFF7ED', fg: '#F97316' },
  { id: 'red', bg: '#FEF2F2', fg: '#EF4444' },
  { id: 'teal', bg: '#F0FDFA', fg: '#14B8A6' },
  { id: 'pink', bg: '#FDF2F8', fg: '#EC4899' },
  { id: 'indigo', bg: '#EEF2FF', fg: '#6366F1' }
];

// 运行时内存状态（云端的会议室/禁约/规则会加载到这里；预约单仅后台经云函数读取）
const state = {
  rooms: [], bookings: [], blackouts: [],
  rules: null, notify: null, pass: null
};

/* ============== 本地存储（降级/离线备份）============== */
const Store = {
  get(key, def) {
    try { return JSON.parse(localStorage.getItem(key)) ?? def; }
    catch { return def; }
  },
  set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }
};

/* ============== 字段归一化（snake_case → camelCase）============== */
function normRoom(r) {
  return { id: r.id, name: r.name, shortName: r.short_name, capacity: r.capacity,
    location: r.location, desc: r.description, icon: r.icon, color: r.color,
    sort: r.sort, enabled: r.enabled !== false, createdAt: r.created_at };
}
function normBlackout(r) {
  let wd = r.weekly_days;
  if (typeof wd === 'string') { try { wd = JSON.parse(wd); } catch { wd = []; } }
  if (!Array.isArray(wd)) wd = [];
  return { id: r.id, roomId: r.room_id, type: r.type, date: r.date,
    startDate: r.start_date, endDate: r.end_date, weeklyDays: wd,
    startTime: r.start_time, endTime: r.end_time, reason: r.reason, createdAt: r.created_at };
}
function normSlot(r) {
  return { id: r.id, roomId: r.room_id, date: r.date, start: r.start_time, end: r.end_time, status: r.status };
}
function normBooking(r) {
  return { id: r.id, roomId: r.room_id, roomName: r.room_name, company: r.company, name: r.name,
    phone: r.phone, date: r.date, start: r.start_time, end: r.end_time, duration: r.duration,
    remark: r.remark, status: r.status, createdAt: r.created_at, cancelledAt: r.cancelled_at };
}

/* ============== 云端层（CloudBase JS SDK：rdb 读 + 云函数写）============== */
const Cloud = {
  app: null, db: null, mode: 'local', ready: false, errors: [],
  async init() {
    try {
      const res = await fetch('/api/ping');
      if (!res.ok) throw new Error('ping ' + res.status);
      const j = await res.json();
      if (!j.ok) throw new Error('ping not ok');
      this.mode = 'cloud';
    } catch (e) {
      console.warn('[Cloud] 无法连接 API 服务，降级为本地存储', e);
      this.mode = 'local';
    }
    this.ready = true;
  },
  // 匿名只读：会议室 / 禁约 / 预约槽位视图 / 公开设置
  async rdbSelect(table, cols, where) {
    cols = cols || '*'; where = where || {};
    if (this.mode !== 'cloud') return [];
    try {
      const params = new URLSearchParams();
      params.set('t', table);
      if (cols !== '*') params.set('c', cols);
      for (const k in where) params.set('w_' + k, where[k]);
      const res = await fetch('/api/read?' + params.toString());
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || 'read failed');
      return j.data || [];
    } catch (e) {
      this.errors.push(table + '：' + (e.message || e));
      console.warn('[Cloud] 读取失败', table, e);
      return [];
    }
  },
  // 云函数调用
  async call(name, data) {
    if (this.mode !== 'cloud') return { ok: false, error: 'local mode' };
    try {
      const res = await fetch('/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      console.warn('[fn] 调用失败', name, e);
      return { ok: false, error: (e && e.message) || String(e) };
    }
  },
  // 管理类统一入口（带密码）
  admin(action, password, data) {
    return this.call('mbapi', { action, password, data: data || {} });
  },
  async loadRooms() { const rows = await this.rdbSelect('rooms', '*'); state.rooms = rows.map(normRoom); return state.rooms; },
  async loadBlackouts() { const rows = await this.rdbSelect('blackouts', '*'); state.blackouts = rows.map(normBlackout); return state.blackouts; },
  async loadRules() {
    const rows = await this.rdbSelect('public_settings', '*');
    const map = {}; (rows || []).forEach(r => { if (r.key) map[r.key] = r.value; });
    state.rules = map.rules || null;
    return state.rules;
  },
  async loadAll() {
    if (this.mode !== 'cloud') return false;
    this.errors = [];
    await this.loadRooms();
    await this.loadBlackouts();
    await this.loadRules();
    Store.set(K.ROOMS, state.rooms);
    Store.set(K.BLACKOUTS, state.blackouts);
    if (this.errors.length) { console.warn('[Cloud] 部分加载异常', this.errors); return false; }
    return true;
  }
};

/* ============== 动态加载 SDK ============== */
function lazyLoadCloud() {
  return new Promise(res => {
    if (window.cloudbase) return res();
    const s = document.createElement('script');
    s.src = 'js/cloudbase.full.js';
    s.onload = () => res();
    s.onerror = () => res();
    document.head.appendChild(s);
  });
}

/* ============== 预约（公开只读槽位 + 提交走云函数）============== */
const Bookings = {
  // 公开：从 booking_slots 视图读取某会议室某天已占用槽位
  async list(filter = {}) {
    const where = {};
    if (filter.roomId) where.room_id = filter.roomId;
    if (filter.date) where.date = filter.date;
    if (filter.status) where.status = filter.status;
    const rows = await Cloud.rdbSelect('booking_slots', '*', where);
    return rows.map(normSlot);
  },
  listSlots(filter) { return this.list(filter); },
  // 提交预约（云函数做冲突校验 + 通知）
  async add(b) {
    const res = await Cloud.call('mbapi', { action: 'createBooking', data: b });
    if (res && res.ok) {
      const rec = res.record || Object.assign({ id: res.id }, b);
      try { sessionStorage.setItem('mb_bk_' + rec.id, JSON.stringify(rec)); } catch (e) {}
      return { ok: true, id: rec.id, record: rec };
    }
    return { ok: false, error: (res && res.error) || 'create_failed', conflict: res && res.conflict };
  },
  // success 页：从本次会话取刚创建的预约（云端不回传隐私字段给前端）
  get(id) {
    try { const s = sessionStorage.getItem('mb_bk_' + id); if (s) return JSON.parse(s); } catch (e) {}
    return null;
  },
  // 后台：全量列表（云函数，需密码）
  async adminList(filter = {}, password) {
    const res = await Cloud.admin('adminListBookings', password, filter);
    if (res && res.ok) return (res.data || []).map(normBooking);
    return [];
  },
  async adminCancel(id, password) {
    const res = await Cloud.admin('adminCancelBooking', password, { id });
    return res && res.ok ? { ok: true } : { ok: false, error: res && res.error };
  },
  async adminExport(password) {
    const res = await Cloud.admin('adminExportBookings', password, {});
    if (res && res.ok) return (res.data || []).map(normBooking);
    return [];
  }
};

/* ============== 会议室（公开读；写走云函数）============== */
const Rooms = {
  list(includeDisabled = false) {
    const all = state.rooms;
    return (includeDisabled ? all : all.filter(r => r.enabled)).sort((a, b) => (a.sort || 0) - (b.sort || 0));
  },
  all() { return state.rooms.slice().sort((a, b) => (a.sort || 0) - (b.sort || 0)); },
  get(id) { return state.rooms.find(r => r.id === id); },
  async add(r, password) {
    const res = await Cloud.admin('adminAddRoom', password, r);
    if (res && res.ok) { await Cloud.loadRooms(); return res.id; }
    return null;
  },
  async update(id, patch, password) {
    const res = await Cloud.admin('adminUpdateRoom', password, Object.assign({ id }, patch));
    if (res && res.ok) { await Cloud.loadRooms(); }
    return !!(res && res.ok);
  },
  async remove(id, password) {
    const res = await Cloud.admin('adminRemoveRoom', password, { id });
    if (res && res.ok) { await Cloud.loadRooms(); }
    return !!(res && res.ok);
  }
};

/* ============== 黑名单/禁约（公开读；写走云函数）============== */
const Blackouts = {
  list(filter = {}) {
    return state.blackouts.filter(b => {
      if (filter.roomId && b.roomId !== filter.roomId) return false;
      if (filter.date) {
        const d = new Date(filter.date).getDay();
        if (b.type === 'once' && b.date === filter.date) return true;
        if (b.type === 'weekly' && (b.weeklyDays || []).includes(d)) return true;
        if (b.type === 'range' && filter.date >= b.startDate && filter.date <= b.endDate) return true;
        return false;
      }
      return true;
    }).sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
  },
  isBlocked(roomId, date, start, end) {
    const list = this.list({ roomId, date });
    return list.find(b => !(end <= b.startTime || start >= b.endTime));
  },
  async add(b, password) {
    const res = await Cloud.admin('adminAddBlackout', password, b);
    if (res && res.ok) { await Cloud.loadBlackouts(); return res.id; }
    return null;
  },
  async remove(id, password) {
    const res = await Cloud.admin('adminRemoveBlackout', password, { id });
    if (res && res.ok) { await Cloud.loadBlackouts(); }
    return !!(res && res.ok);
  }
};

/* ============== 预约规则 ============== */
const DEFAULT_RULES = { advanceDays: 7, workStart: '08:00', workEnd: '20:00', minDuration: 30, hourDuration: 60, perCompanyLimit: 1 };
const Rules = {
  get() { return state.rules || DEFAULT_RULES; },
  async set(r, password) {
    const res = await Cloud.admin('adminSaveSettings', password, { key: 'rules', value: r });
    if (res && res.ok) state.rules = r;
    return !!(res && res.ok);
  }
};

/* ============== 通知配置（webhook 等敏感信息仅存云端，前端用默认）============== */
const DEFAULT_NOTIFY = { webhook: '', serverChan: '', email: '', notifyOnNew: true, notifyOnCancel: true, remindBefore: 15 };
const Notify = {
  get() { return state.notify || DEFAULT_NOTIFY; },
  async set(c, password) {
    const res = await Cloud.admin('adminSaveSettings', password, { key: 'notify', value: c });
    if (res && res.ok) state.notify = c;
    return !!(res && res.ok);
  }
};

/* ============== 管理员（密码服务端校验）============== */
const Auth = {
  async login(pass) { const res = await Cloud.admin('adminLogin', pass, {}); return !!(res && res.ok); },
  async set(newPass, curPass) { const res = await Cloud.admin('adminSetPass', curPass, { newPass }); return !!(res && res.ok); }
};

/* ============== 时段生成（考虑黑名单 + 已占用槽位）============== */
async function generateSlots(dateStr, duration, roomId) {
  const rules = Rules.get();
  const slots = [];
  const [sh, sm] = rules.workStart.split(':').map(Number);
  const [eh, em] = rules.workEnd.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const bookings = await Bookings.list({ roomId, date: dateStr, status: 'ok' });
  const blackouts = Blackouts.list({ roomId, date: dateStr });

  for (let m = startMin; m + duration <= endMin; m += duration) {
    const s = fmtMin(m);
    const e = fmtMin(m + duration);
    const conflict = bookings.find(x => !(e <= x.start || s >= x.end));
    const blocked = blackouts.find(x => !(e <= x.startTime || s >= x.endTime));
    slots.push({ start: s, end: e, disabled: !!(conflict || blocked), reason: conflict ? '已预约' : (blocked ? '禁约' : '') });
  }
  return slots;
}

function fmtMin(m) {
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

/* ============== 日期工具 ============== */
function getDateList(days) {
  days = days || Rules.get().advanceDays;
  const list = [];
  const today = new Date();
  const wkMap = ['日', '一', '二', '三', '四', '五', '六'];
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    list.push({ date: d.toISOString().slice(0, 10), day: wkMap[d.getDay()], num: d.getDate(), mon: d.getMonth() + 1, isToday: i === 0 });
  }
  return list;
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const wk = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${d.getMonth() + 1}月${d.getDate()}日 ${wk[d.getDay()]}`;
}

/* ============== UI 工具 ============== */
function $(s) { return document.querySelector(s); }
function $$(s) { return document.querySelectorAll(s); }

function toast(msg, duration = 1800) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), duration);
}

function confirmModal({ title, message, confirmText = '确定', cancelText = '取消', danger = false }) {
  return new Promise(resolve => {
    const mask = document.createElement('div');
    mask.className = 'modal-mask show';
    mask.innerHTML = `
      <div class="modal">
        <div class="modal-icon ${danger ? 'warning' : ''}">
          ${danger
            ? '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
            : '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
          }
        </div>
        <h3>${title}</h3>
        <p>${message}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost btn-cancel">${cancelText}</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-ok">${confirmText}</button>
        </div>
      </div>
    `;
    document.body.appendChild(mask);
    mask.querySelector('.btn-cancel').onclick = () => { mask.remove(); resolve(false); };
    mask.querySelector('.btn-ok').onclick = () => { mask.remove(); resolve(true); };
    mask.onclick = e => { if (e.target === mask) { mask.remove(); resolve(false); } };
  });
}

function getQuery(name) {
  return new URLSearchParams(location.search).get(name);
}

/* ============== 启动引导（云端优先，失败降级本地）============== */
let _booted = false;
const _waiters = [];
function loadLocal() {
  state.rooms = Store.get(K.ROOMS, []);
  state.bookings = Store.get(K.BOOKINGS, []);
  state.blackouts = Store.get(K.BLACKOUTS, []);
  state.rules = Store.get(K.RULES, null);
  state.notify = Store.get(K.NOTIFY, null);
  state.pass = Store.get(K.ADMIN, null);
}

async function bootstrap() {
  await Cloud.init();
  if (Cloud.mode === 'cloud') {
    const ok = await Cloud.loadAll();
    if (!ok && state.rooms.length === 0) loadLocal();
  } else {
    loadLocal();
  }

  if (!state.rules) state.rules = DEFAULT_RULES;
  if (!state.notify) state.notify = DEFAULT_NOTIFY;

  // 本地模式补充示例数据，便于离线预览
  if (Cloud.mode === 'local' && state.rooms.length === 0 && !Store.get(K.SEEDED, false)) {
    const defs = [
      { id: 'cx-small', name: '创新大厦·小会议室', shortName: '小会议室', capacity: 8, location: '中关村生命科学园·创新大厦5层', desc: '适合小组讨论、远程视频会议', icon: 'users', color: 'blue', sort: 1, enabled: true },
      { id: 'cx-big', name: '创新大厦·大会议室', shortName: '大会议室', capacity: 20, location: '中关村生命科学园·创新大厦5层', desc: '适合部门会议、培训、路演', icon: 'presentation', color: 'purple', sort: 2, enabled: true }
    ];
    defs.forEach(r => state.rooms.push(r));
    Store.set(K.ROOMS, state.rooms);
    Store.set(K.SEEDED, true);
  }

  _booted = true;
  _waiters.forEach(f => { try { f(); } catch (e) { console.error(e); } });
}

/* ============== 兼容层 ============== */
const MB = {
  ICONS, COLORS, RULES: DEFAULT_RULES,
  Store, Bookings, Rooms, Blackouts, Rules, Notify, Auth, Cloud,
  generateSlots, getDateList, formatDate,
  toast, confirmModal, getQuery, $, $$,
  ready(fn) { if (_booted) fn(); else _waiters.push(fn); },
  bootstrap
};
window.MB = MB;

// 立即启动
bootstrap();
