/* ============================================
 * 管理后台脚本（PostgreSQL / 云函数版）
 * 预约列表、设置读取走云函数 mbapi（密码服务端校验）
 * 会议室/禁约的读来自本地 state（云端 rdb 已加载），写走云函数
 * ============================================ */
MB.ready(function () {
  const AUTH_KEY = 'mb_admin_auth';
  const PASS_KEY = 'mb_admin_pass';
  const filter = { room: 'all', date: '', status: 'ok' };
  const blFilter = { room: 'all' };
  let lastSeenCount = 0;
  let editingRoomId = null;
  let editingBlId = null;

  function adminPass() { return sessionStorage.getItem(PASS_KEY) || ''; }

  /* ============== 登录 ============== */
  window.doLogin = async function () {
    const pass = $('#login-pass').value;
    if (!pass) { $('#login-err').textContent = '请输入密码'; $('#login-err').classList.add('show'); return; }
    const ok = await MB.Auth.login(pass);
    if (!ok) { $('#login-err').textContent = '密码错误'; $('#login-err').classList.add('show'); return; }
    sessionStorage.setItem(AUTH_KEY, '1');
    sessionStorage.setItem(PASS_KEY, pass);
    showPanel();
  };
  window.logout = function () { sessionStorage.removeItem(AUTH_KEY); sessionStorage.removeItem(PASS_KEY); location.reload(); };

  async function showPanel() {
    $('#login-page').style.display = 'none';
    $('#admin-panel').style.display = 'block';
    initTabs();
    renderRoomFilter();
    renderBlFilter();
    await Promise.all([renderStats(), renderList(), renderRooms(), renderBlackouts(), loadSettings()]);
    startPolling();
  }

  /* ============== Tab ============== */
  function initTabs() {
    $$('.tab').forEach(el => {
      el.onclick = () => {
        $$('.tab').forEach(x => x.classList.remove('active'));
        $$('.tab-pane').forEach(x => x.classList.remove('active'));
        el.classList.add('active');
        $('#pane-' + el.dataset.tab).classList.add('active');
      };
    });
  }

  /* ============== 预约列表 ============== */
  async function renderStats() {
    const all = await MB.Bookings.adminList({}, adminPass());
    const today = new Date().toISOString().slice(0, 10);
    const month = today.slice(0, 7);
    $('#stat-total').textContent = all.length;
    $('#stat-today').textContent = all.filter(b => b.date === today && b.status === 'ok').length;
    $('#stat-month').textContent = all.filter(b => b.date.startsWith(month) && b.status === 'ok').length;
  }

  function renderRoomFilter() {
    const wrap = $('#filter-room');
    const rooms = MB.Rooms.all();
    wrap.innerHTML = '<div class="filter-chip active" data-room="all">全部</div>' +
      rooms.map(r => `<div class="filter-chip" data-room="${r.id}">${r.shortName || r.name}</div>`).join('');
    wrap.querySelectorAll('.filter-chip').forEach(el => {
      el.onclick = () => {
        filter.room = el.dataset.room;
        wrap.querySelectorAll('.filter-chip').forEach(x => x.classList.remove('active'));
        el.classList.add('active');
        renderList();
      };
    });
  }

  async function renderList() {
    const f = {};
    if (filter.room !== 'all') f.roomId = filter.room;
    if (filter.date) f.date = filter.date;
    if (filter.status !== 'all') f.status = filter.status;
    const list = await MB.Bookings.adminList(f, adminPass());
    const el = $('#booking-list');
    if (list.length === 0) {
      el.innerHTML = '<div class="empty"><p>暂无符合条件的预约</p></div>';
      return;
    }
    el.innerHTML = list.map(b => {
      const room = MB.Rooms.get(b.roomId);
      return `<div class="booking-row">
        <div class="booking-info">
          <div class="booking-room">${room ? room.shortName || room.name : b.roomName}
            <span class="badge ${b.status === 'ok' ? 'badge-success' : 'badge-neutral'}" style="margin-left: 6px;">${b.status === 'ok' ? '有效' : '已取消'}</span>
          </div>
          <div class="booking-meta">
            <span>📅 ${b.date} ${b.start}-${b.end}</span>
            <span>🏢 ${b.company}</span>
            <span>👤 ${b.name} · ${b.phone}</span>
            ${b.remark ? `<span>📝 ${b.remark}</span>` : ''}
            <span style="opacity: 0.6;">🆔 ${b.id}</span>
          </div>
        </div>
        <div class="booking-actions">
          ${b.status === 'ok' ? `<button class="btn btn-ghost btn-sm" style="color: var(--danger); border-color: var(--danger-soft);" onclick="cancelBooking('${b.id}')">取消</button>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  window.cancelBooking = async function (id) {
    const ok = await MB.confirmModal({ title: '确认取消', message: '取消后该时段将释放，是否继续？', confirmText: '确认取消', danger: true });
    if (!ok) return;
    await MB.Bookings.adminCancel(id, adminPass());
    MB.toast('已取消');
    await Promise.all([renderStats(), renderList()]);
  };

  $$('#filter-status .filter-chip').forEach(el => {
    el.onclick = () => {
      filter.status = el.dataset.status;
      $$('#filter-status .filter-chip').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      renderList();
    };
  });
  $('#filter-date').onchange = e => { filter.date = e.target.value; renderList(); };

  window.exportCSV = async function () {
    const list = await MB.Bookings.adminExport(adminPass());
    if (list.length === 0) { MB.toast('暂无数据可导出'); return; }
    const header = ['预约号', '会议室', '日期', '开始时间', '结束时间', '公司', '预约人', '联系方式', '会议主题', '状态', '创建时间'];
    const rows = list.map(b => [b.id, b.roomName, b.date, b.start, b.end, b.company, b.name, b.phone, b.remark || '', b.status === 'ok' ? '有效' : '已取消', b.createdAt]);
    const csv = '﻿' + [header, ...rows].map(r => r.map(x => `"${String(x == null ? '' : x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `预约记录_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    MB.toast(`已导出 ${list.length} 条记录`);
  };

  /* ============== 会议室管理 ============== */
  function renderRooms() {
    const all = MB.Rooms.all();
    $('#room-count').textContent = all.length;
    const el = $('#room-list-admin');
    if (all.length === 0) {
      el.innerHTML = '<div class="empty"><p>暂无会议室，点击右上角添加</p></div>';
      return;
    }
    el.innerHTML = all.map(r => {
      const iconData = MB.ICONS.find(i => i.id === r.icon) || MB.ICONS[0];
      const colorData = MB.COLORS.find(c => c.id === r.color) || MB.COLORS[0];
      return `<div class="booking-row">
        <div class="booking-info">
          <div class="booking-room">${r.name}
            <span class="badge ${r.enabled ? 'badge-success' : 'badge-neutral'}" style="margin-left: 6px;">${r.enabled ? '启用' : '停用'}</span>
          </div>
          <div class="booking-meta">
            <span>📍 ${r.location || '未设置'}</span>
            <span>👥 ${r.capacity}人</span>
            <span>排序: ${r.sort || 0}</span>
            ${r.desc ? `<span>${r.desc}</span>` : ''}
          </div>
        </div>
        <div class="booking-actions">
          <button class="btn btn-ghost btn-sm" onclick="roomForm('${r.id}')">编辑</button>
          <button class="btn btn-ghost btn-sm" onclick="toggleRoom('${r.id}')">${r.enabled ? '停用' : '启用'}</button>
          <button class="btn btn-ghost btn-sm" style="color: var(--danger); border-color: var(--danger-soft);" onclick="deleteRoom('${r.id}')">删除</button>
        </div>
      </div>`;
    }).join('');
  }

  window.roomForm = function (id) {
    editingRoomId = id || null;
    const r = id ? MB.Rooms.get(id) : { icon: 'users', color: 'blue', capacity: 10, sort: MB.Rooms.all().length + 1 };
    $('#room-modal-title').textContent = id ? '编辑会议室' : '新增会议室';
    $('#rm-name').value = r.name || '';
    $('#rm-short').value = r.shortName || '';
    $('#rm-loc').value = r.location || '';
    $('#rm-cap').value = r.capacity || 10;
    $('#rm-sort').value = r.sort || 1;
    $('#rm-desc').value = r.desc || '';

    $('#rm-icons').innerHTML = MB.ICONS.map(i => `
      <div class="icon-pick ${i.id === r.icon ? 'active' : ''}" data-icon="${i.id}" style="padding: 10px; border-radius: 10px; border: 1.5px solid ${i.id === r.icon ? 'var(--primary)' : 'var(--border)'}; display: flex; align-items: center; justify-content: center; cursor: pointer; background: ${i.id === r.icon ? 'var(--gradient-soft)' : 'var(--surface)'};">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${i.svg}</svg>
      </div>
    `).join('');
    $$('#rm-icons .icon-pick').forEach(el => el.onclick = () => {
      $$('#rm-icons .icon-pick').forEach(x => { x.classList.remove('active'); x.style.borderColor = 'var(--border)'; x.style.background = 'var(--surface)'; });
      el.classList.add('active'); el.style.borderColor = 'var(--primary)'; el.style.background = 'var(--gradient-soft)';
    });

    $('#rm-colors').innerHTML = MB.COLORS.map(c => `
      <div class="color-pick ${c.id === r.color ? 'active' : ''}" data-color="${c.id}" style="width: 36px; height: 36px; border-radius: 50%; background: ${c.fg}; cursor: pointer; border: 3px solid ${c.id === r.color ? '#fff' : 'transparent'}; box-shadow: 0 0 0 ${c.id === r.color ? '2px' : '0'} var(--primary);"></div>
    `).join('');
    $$('#rm-colors .color-pick').forEach(el => el.onclick = () => {
      $$('#rm-colors .color-pick').forEach(x => { x.style.border = '3px solid transparent'; x.style.boxShadow = 'none'; });
      el.classList.add('active'); el.style.border = '3px solid #fff'; el.style.boxShadow = '0 0 0 2px var(--primary)';
    });

    $('#room-modal').classList.add('show');
  };

  window.saveRoom = async function () {
    const name = $('#rm-name').value.trim();
    if (!name) { MB.toast('请填写完整名称'); return; }
    const data = {
      name,
      shortName: $('#rm-short').value.trim(),
      location: $('#rm-loc').value.trim(),
      capacity: parseInt($('#rm-cap').value) || 10,
      sort: parseInt($('#rm-sort').value) || 1,
      desc: $('#rm-desc').value.trim(),
      icon: $('#rm-icons .icon-pick.active').dataset.icon,
      color: $('#rm-colors .color-pick.active').dataset.color
    };
    if (editingRoomId) await MB.Rooms.update(editingRoomId, data, adminPass());
    else await MB.Rooms.add(data, adminPass());
    closeModal('room-modal');
    MB.toast('已保存');
    renderRooms(); renderRoomFilter(); renderBlFilter(); renderList();
  };

  window.toggleRoom = async function (id) {
    const r = MB.Rooms.get(id);
    await MB.Rooms.update(id, { enabled: !r.enabled }, adminPass());
    MB.toast(r.enabled ? '已停用' : '已启用');
    renderRooms(); renderRoomFilter();
  };

  window.deleteRoom = async function (id) {
    const r = MB.Rooms.get(id);
    const bookings = await MB.Bookings.adminList({ roomId: id }, adminPass());
    let msg = `确认删除会议室「${r.name}」？`;
    if (bookings.length > 0) msg += `该会议室有 ${bookings.length} 条预约记录，删除后预约仍保留。`;
    const ok = await MB.confirmModal({ title: '删除会议室', message: msg, confirmText: '确认删除', danger: true });
    if (!ok) return;
    await MB.Rooms.remove(id, adminPass());
    MB.toast('已删除');
    renderRooms(); renderRoomFilter(); renderBlFilter(); renderList();
  };

  /* ============== 禁约管理 ============== */
  function renderBlFilter() {
    const wrap = $('#bl-filter-room');
    const rooms = MB.Rooms.all();
    wrap.innerHTML = '<div class="filter-chip active" data-room="all">全部</div>' +
      rooms.map(r => `<div class="filter-chip" data-room="${r.id}">${r.shortName || r.name}</div>`).join('');
    wrap.querySelectorAll('.filter-chip').forEach(el => {
      el.onclick = () => {
        blFilter.room = el.dataset.room;
        wrap.querySelectorAll('.filter-chip').forEach(x => x.classList.remove('active'));
        el.classList.add('active');
        renderBlackouts();
      };
    });
  }

  function renderBlackouts() {
    const all = MB.Blackouts.list(blFilter.room !== 'all' ? { roomId: blFilter.room } : {});
    $('#bl-count').textContent = all.length;
    const el = $('#blackout-list');
    if (all.length === 0) {
      el.innerHTML = '<div class="empty"><p>暂无禁约时段</p></div>';
      return;
    }
    el.innerHTML = all.map(b => {
      const room = MB.Rooms.get(b.roomId);
      let range = '';
      if (b.type === 'once') range = `${b.date} ${b.startTime}-${b.endTime}`;
      else if (b.type === 'range') range = `${b.startDate}~${b.endDate} ${b.startTime}-${b.endTime}`;
      else if (b.type === 'weekly') {
        const days = ['日', '一', '二', '三', '四', '五', '六'];
        const ds = (b.weeklyDays || []).map(d => '周' + days[d]).join('、');
        range = `每周 ${ds} ${b.startTime}-${b.endTime}`;
      }
      return `<div class="booking-row">
        <div class="booking-info">
          <div class="booking-room">${room ? room.shortName || room.name : '?'}<span class="badge badge-warning" style="margin-left: 6px;">${b.type === 'once' ? '单次' : b.type === 'range' ? '区间' : '每周'}</span></div>
          <div class="booking-meta">
            <span>🕒 ${range}</span>
            ${b.reason ? `<span>📝 ${b.reason}</span>` : ''}
          </div>
        </div>
        <div class="booking-actions">
          <button class="btn btn-ghost btn-sm" style="color: var(--danger); border-color: var(--danger-soft);" onclick="deleteBl('${b.id}')">删除</button>
        </div>
      </div>`;
    }).join('');
  }

  window.blackoutForm = function () {
    editingBlId = null;
    const rooms = MB.Rooms.all();
    if (rooms.length === 0) { MB.toast('请先添加会议室'); return; }
    $('#bl-modal-title').textContent = '新增禁约';
    $('#bl-room').innerHTML = rooms.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
    $('#bl-type').value = 'once';
    $('#bl-date').value = new Date().toISOString().slice(0, 10);
    $('#bl-start').value = new Date().toISOString().slice(0, 10);
    $('#bl-end').value = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    $('#bl-t-start').value = '08:00';
    $('#bl-t-end').value = '20:00';
    $('#bl-reason').value = '';
    $$('#bl-weekdays input').forEach(i => i.checked = false);
    toggleBlType();
    $('#bl-modal').classList.add('show');
  };

  $('#bl-type').onchange = toggleBlType;
  function toggleBlType() {
    const t = $('#bl-type').value;
    $('#bl-once-fields').style.display = t === 'once' ? '' : 'none';
    $('#bl-range-fields').style.display = t === 'range' ? '' : 'none';
    $('#bl-weekly-fields').style.display = t === 'weekly' ? '' : 'none';
  }

  $$('#bl-weekdays .filter-chip').forEach(el => {
    el.onclick = e => {
      e.preventDefault();
      const cb = el.querySelector('input');
      cb.checked = !cb.checked;
      el.classList.toggle('active', cb.checked);
    };
  });

  window.saveBlackout = async function () {
    const roomId = $('#bl-room').value;
    const type = $('#bl-type').value;
    const startTime = $('#bl-t-start').value;
    const endTime = $('#bl-t-end').value;
    const reason = $('#bl-reason').value.trim();
    if (!roomId) { MB.toast('请选择会议室'); return; }
    if (startTime >= endTime) { MB.toast('结束时间必须晚于开始'); return; }
    const data = { roomId, type, startTime, endTime, reason };
    if (type === 'once') data.date = $('#bl-date').value;
    else if (type === 'range') {
      data.startDate = $('#bl-start').value;
      data.endDate = $('#bl-end').value;
      if (data.startDate > data.endDate) { MB.toast('结束日期不能早于开始'); return; }
    } else if (type === 'weekly') {
      data.weeklyDays = $$('#bl-weekdays input:checked').map(i => parseInt(i.value));
      if (data.weeklyDays.length === 0) { MB.toast('请选择至少一个工作日'); return; }
    }
    await MB.Blackouts.add(data, adminPass());
    closeModal('bl-modal');
    MB.toast('已添加');
    renderBlackouts();
  };

  window.deleteBl = async function (id) {
    const ok = await MB.confirmModal({ title: '删除禁约', message: '确认删除该禁约时段？', confirmText: '删除', danger: true });
    if (!ok) return;
    await MB.Blackouts.remove(id, adminPass());
    MB.toast('已删除');
    renderBlackouts();
  };

  /* ---------- 数据源状态 ---------- */
  function renderCloudStatus() {
    const mode = MB.Cloud ? MB.Cloud.mode : 'local';
    const dot = $('#cloud-dot');
    const txt = $('#cloud-mode-text');
    const detail = $('#cloud-detail');
    if (mode === 'cloud') {
      const errs = (MB.Cloud && MB.Cloud.errors && MB.Cloud.errors.length) ? MB.Cloud.errors : [];
      if (errs.length === 0) {
        dot.style.background = '#10B981';
        txt.textContent = '☁️ 云端已连接（数据多设备同步）';
        txt.style.color = '#10B981';
        detail.innerHTML = `环境：${CLOUDBASE_ENV}<br>前端经同域 API 服务读取会议室/禁约；预约提交与管理操作经后端 API 写入 PostgreSQL，前台无法越权。`;
      } else {
        dot.style.background = '#F97316';
        txt.textContent = '⚠️ 已连云端，但部分读取异常';
        txt.style.color = '#F97316';
        detail.innerHTML = `环境：${CLOUDBASE_ENV}<br>匿名登录成功，但下列读取失败：<br>` + errs.map(e => '· ' + e).join('<br>') +
          `<br><br>处理：CloudBase 控制台 SQL 编辑器执行 db/01-tables.sql 等建表脚本。`;
      }
    } else {
      dot.style.background = '#EF4444';
      txt.textContent = '📱 本地模式（数据只存本机）';
      txt.style.color = '#EF4444';
      detail.innerHTML = `未连上 API 服务，预约数据只保存在当前浏览器。请确认后端 Node 服务已启动且可访问 /api/ping。`;
    }
  }

  /* ============== 设置 ============== */
  async function loadSettings() {
    const r = MB.Rules.get();
    $('#r-advance').value = r.advanceDays;
    $('#r-start').value = r.workStart;
    $('#r-end').value = r.workEnd;
    $('#r-min').value = r.minDuration;
    // 单次最长时长（旧数据无此字段时默认 180 分钟）
    const maxDuration = r.maxDuration || 180;
    const selMax = $('#r-max');
    if (![].slice.call(selMax.options).some(o => Number(o.value) === maxDuration)) {
      const opt = document.createElement('option');
      opt.value = String(maxDuration);
      opt.textContent = (maxDuration / 60) + ' 小时';
      selMax.appendChild(opt);
    }
    selMax.value = String(maxDuration);
    $('#r-dcount').value = r.perCompanyDailyCount || 2;
    $('#r-dhours').value = (r.perCompanyDailyMinutes || 360) / 60;

    const res = await MB.Cloud.admin('adminGetSettings', adminPass(), {});
    const s = (res && res.ok && res.data) ? res.data : {};
    const n = s.notify || MB.Notify.get();
    $('#n-webhook').value = n.webhook || '';
    $('#n-sc').value = n.serverChan || '';
    $('#n-email').value = n.email || '';
    $('#n-remind').value = n.remindBefore;
    $('#n-new').checked = !!n.notifyOnNew;
    $('#n-cancel').checked = !!n.notifyOnCancel;
    state_notify_cache = n;
    renderCloudStatus();
  }
  let state_notify_cache = MB.Notify.get();

  window.saveRules = async function () {
    const advanceDays = Math.max(1, parseInt($('#r-advance').value) || 7);
    const workStart = $('#r-start').value || '08:00';
    const workEnd = $('#r-end').value || '20:00';
    const minDuration = parseInt($('#r-min').value) || 30;
    const maxDuration = parseInt($('#r-max').value) || 180;
    const perCompanyDailyCount = Math.max(1, parseInt($('#r-dcount').value) || 2);
    const perCompanyDailyMinutes = Math.max(30, Math.round(parseFloat($('#r-dhours').value || 6) * 60));
    if (workStart >= workEnd) { MB.toast('工作结束时间必须晚于开始'); return; }
    if (maxDuration < minDuration) { MB.toast('单次最长时长不能小于时段粒度'); return; }
    if (maxDuration % minDuration !== 0) { MB.toast('单次最长时长须为时段粒度的整数倍'); return; }
    await MB.Rules.set({ advanceDays, workStart, workEnd, minDuration, maxDuration, perCompanyDailyCount, perCompanyDailyMinutes, hourDuration: Math.max(60, minDuration), perCompanyLimit: perCompanyDailyCount }, adminPass());
    MB.toast('规则已保存');
  };

  window.saveNotify = async function () {
    const c = {
      webhook: $('#n-webhook').value.trim(),
      serverChan: $('#n-sc').value.trim(),
      email: $('#n-email').value.trim(),
      remindBefore: parseInt($('#n-remind').value) || 15,
      notifyOnNew: $('#n-new').checked,
      notifyOnCancel: $('#n-cancel').checked
    };
    await MB.Notify.set(c, adminPass());
    MB.toast('通知设置已保存');
  };

  window.changePass = async function () {
    const cur = $('#cur-pass').value;
    const p1 = $('#new-pass').value;
    const p2 = $('#new-pass2').value;
    if (!cur) { MB.toast('请输入当前密码'); return; }
    if (!p1) { MB.toast('请输入新密码'); return; }
    if (p1 !== p2) { MB.toast('两次密码不一致'); return; }
    if (p1.length < 6) { MB.toast('密码至少 6 位'); return; }
    const ok = await MB.Auth.set(p1, cur);
    if (ok) { MB.toast('密码已修改'); sessionStorage.setItem(PASS_KEY, p1); $('#cur-pass').value = ''; $('#new-pass').value = ''; $('#new-pass2').value = ''; }
    else MB.toast('当前密码错误');
  };

  window.clearAllData = async function () {
    const ok = await MB.confirmModal({ title: '⚠️ 清空所有数据', message: '这将删除所有预约、会议室、禁约设置，不可恢复！（云端数据需到控制台清空）', confirmText: '确认清空', danger: true });
    if (!ok) return;
    ['mb_bookings_v2', 'mb_rooms', 'mb_blackouts', 'mb_rules', 'mb_notify', 'mb_seeded_v2'].forEach(k => localStorage.removeItem(k));
    location.reload();
  };

  /* ============== Modal ============== */
  window.closeModal = function (id) { $('#' + id).classList.remove('show'); };
  $$('.modal-mask').forEach(m => m.onclick = e => { if (e.target === m) m.classList.remove('show'); });

  /* ============== 轮询（云端模式每 30s 刷新预约列表）============== */
  function startPolling() {
    setInterval(async () => {
      if (MB.Cloud.mode !== 'cloud') return;
      try {
        const cur = await MB.Bookings.adminList({}, adminPass());
        if (cur.length > lastSeenCount) {
          const diff = cur.length - lastSeenCount;
          showNewBadge(diff);
          MB.toast(`🔔 ${diff} 条新预约`, 3000);
        }
        lastSeenCount = cur.length;
        await Promise.all([renderStats(), renderList()]);
      } catch (e) {}
    }, 60000);  // 60 秒轮询（避开国内访问 Supabase 的 700ms 延迟）
  }
  function showNewBadge(n) {
    const b = $('#new-badge');
    b.textContent = n;
    b.style.display = '';
    clearTimeout(b._t);
    b._t = setTimeout(() => b.style.display = 'none', 5000);
  }

  /* ============== 初始化 ============== */
  if (sessionStorage.getItem(AUTH_KEY)) showPanel();
});
