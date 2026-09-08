/* ============================================
 * 我的预约页 · 逻辑
 * 依赖：common.js（MB.bootstrap / MB.Bookings / MB.MyMemory）
 * ============================================================ */
MB.ready(async function () {
  const $ = MB.$, $$ = MB.$$;

  const state = {
    phone: '',
    bookings: [],       // 当前查询结果
    activeTab: 'upcoming'
  };

  /* ============== 工具 ============== */
  const NOW = new Date();
  function toMinutes(t) { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; }
  function todayStr() { return NOW.toISOString().slice(0, 10); }
  function classify(b) {
    // 返回 upcoming / past / cancelled
    if (b.status === 'cancelled') return 'cancelled';
    if (b.date < todayStr()) return 'past';
    if (b.date === todayStr()) {
      const nowMin = NOW.getHours() * 60 + NOW.getMinutes();
      if (nowMin >= toMinutes(b.end)) return 'past';
      if (nowMin >= toMinutes(b.start)) return 'upcoming'; // 进行中也算"待进行"
      return 'upcoming';
    }
    return 'upcoming';
  }
  function durLabel(d) {
    if (!d) return '';
    if (d < 60) return d + ' 分钟';
    const h = d / 60;
    return (h % 1 === 0 ? h : h.toFixed(1)) + ' 小时';
  }
  function statusLabel(c) {
    if (c === 'cancelled') return '已取消';
    if (c === 'past') return '已完成';
    return '待进行';
  }

  /* ============== 渲染列表 ============== */
  function renderTabs() {
    const buckets = { upcoming: 0, past: 0, cancelled: 0 };
    state.bookings.forEach(b => { buckets[classify(b)]++; });
    $('#cnt-upcoming').textContent = buckets.upcoming;
    $('#cnt-past').textContent = buckets.past;
    $('#cnt-cancelled').textContent = buckets.cancelled;
    $$('#tabs .tab').forEach(el => {
      el.classList.toggle('active', el.dataset.tab === state.activeTab);
    });
  }

  function renderList() {
    renderTabs();
    const list = state.bookings
      .filter(b => classify(b) === state.activeTab)
      .sort((a, b) => {
        // 待进行：日期升序（最近的在前）；已完成/已取消：日期降序
        if (state.activeTab === 'upcoming') {
          return a.date === b.date ? toMinutes(a.start) - toMinutes(b.start) : a.date.localeCompare(b.date);
        }
        return a.date === b.date ? toMinutes(b.start) - toMinutes(b.start) : b.date.localeCompare(a.date);
      });

    const el = $('#list');
    if (list.length === 0) {
      const tip = state.activeTab === 'upcoming' ? '当前手机号下暂无待进行的预约' :
                  state.activeTab === 'past' ? '暂无已完成预约' : '暂无已取消预约';
      el.innerHTML = `<div class="empty"><p>${tip}</p></div>`;
      return;
    }

    el.innerHTML = list.map(b => {
      const cls = classify(b);
      const canCancel = cls === 'upcoming';
      return `
        <div class="booking-card ${cls}">
          <div class="booking-card-head">
            <div class="booking-room">${escapeHtml(b.roomName || '会议室')}</div>
            <div class="booking-status ${cls}">${statusLabel(cls)}</div>
          </div>
          <div class="booking-time">
            <span class="booking-day">${MB.formatDate(b.date)}</span>
            <strong>${b.start} - ${b.end}</strong>
            <span style="color:var(--text-muted); margin-left:6px; font-size:12px;">${durLabel(b.duration)}</span>
          </div>
          <div class="booking-meta">
            <span>🏢 ${escapeHtml(b.company || '')}</span>
            <span>👤 ${escapeHtml(b.name || '')}</span>
          </div>
          ${b.remark ? `<div class="booking-remark">📌 ${escapeHtml(b.remark)}</div>` : ''}
          <div class="booking-id">预约号 ${b.id}</div>
          <div class="booking-actions">
            <button class="btn btn-ghost btn-sm" onclick="addToCal('${b.id}','${b.date}','${b.start}','${b.end}','${escapeAttr(b.roomName || '')}','${escapeAttr(b.remark || '')}')">📅 加入日历</button>
            ${canCancel ? `<button class="btn btn-danger btn-sm" onclick="cancelFlow('${b.id}','${escapeAttr(b.company || '')}')">✕ 取消预约</button>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/'/g, '&#39;'); }

  /* ============== 查询 ============== */
  async function queryByPhone(phone) {
    if (!/^1[3-9]\d{9}$/.test(phone)) { MB.toast('请输入正确的 11 位手机号'); return; }
    state.phone = phone;
    $('#phone').value = phone;
    MB.toast('查询中...', 1000);
    const list = await MB.Bookings.myList(phone);
    if (!list.length && MB.Cloud.mode !== 'cloud') {
      MB.toast('网络异常，请稍后再试'); return;
    }
    state.bookings = list;
    renderList();
    if (list.length === 0) MB.toast('该手机号下暂无预约');
    updateMemoryTip();
  }

  function updateMemoryTip() {
    const cnt = MB.MyMemory.list().length;
    $('#my-memory-count').textContent = cnt;
    if (state.bookings.length > 0) {
      $('#my-extra-tip').innerHTML = `<span class="my-cleared">✓ 找到 ${state.bookings.length} 条预约</span>`;
    }
  }

  /* ============== 取消 ============== */
  window.cancelFlow = async function (id, company) {
    if (!confirm('确认要取消该预约吗？取消后无法恢复。')) return;
    const phone = prompt('请输入预约时填写的手机号后 4 位进行验证：');
    if (!phone) return;
    if (!/^\d{4}$/.test(phone)) { MB.toast('请输入 4 位数字'); return; }

    const ok = await MB.confirmModal({
      title: '确认取消预约',
      message: `预约号 ${id}<br>${company}<br><br>取消后该时段将立即释放给其他人`,
      confirmText: '确认取消',
      cancelText: '再想想',
      danger: true
    });
    if (!ok) return;

    MB.toast('取消中...', 800);
    const r = await MB.Bookings.myCancel(id, phone);
    if (r && r.ok) {
      // 更新本地状态 + 移除本机记忆
      const idx = state.bookings.findIndex(x => x.id === id);
      if (idx >= 0) {
        state.bookings[idx] = Object.assign({}, state.bookings[idx], { status: 'cancelled', cancelledAt: new Date().toISOString() });
      }
      MB.MyMemory.remove(id);
      renderList();
      MB.toast('已取消');
    } else {
      const msg = ({
        not_found: '预约号不存在',
        already_cancelled: '该预约已取消',
        phone_mismatch: '手机号后 4 位验证失败',
        invalid: '参数错误',
      })[r && r.error] || '取消失败，请稍后再试';
      MB.toast(msg, 2400);
    }
  };

  /* ============== 加入日历（嵌入现有记录） */
  window.addToCal = function (id, date, start, end, roomName, remark) {
    const pad = n => String(n).padStart(2, '0');
    const sd = date.replace(/-/g, '');
    const [sh, sm] = start.split(':');
    const [eh, em] = end.split(':');
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Meeting Booking//CN',
      'BEGIN:VEVENT',
      `UID:${id}@meeting-booking`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
      `DTSTART:${sd}T${pad(+sh)}${pad(+sm)}00`,
      `DTEND:${sd}T${pad(+eh)}${pad(+em)}00`,
      `SUMMARY:${roomName || '会议室预约'} - ${remark || ''}`,
      `LOCATION:中关村生命科学园·创新大厦`,
      'END:VEVENT', 'END:VCALENDAR'
    ].join('\r\n');
    const blob = new Blob([ics], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${id}.ics`; a.click();
    URL.revokeObjectURL(url);
    MB.toast('日历文件已下载');
  };

  /* ============== 事件绑定 ============== */
  $('#btn-query').onclick = () => queryByPhone($('#phone').value.trim());

  $('#phone').onkeydown = e => { if (e.key === 'Enter') queryByPhone(e.target.value.trim()); };

  $$('#tabs .tab').forEach(el => {
    el.onclick = () => {
      state.activeTab = el.dataset.tab;
      renderList();
    };
  });

  // 展开/收起预约号补查
  $('#toggle-search').onclick = () => {
    $('#toggle-search').classList.toggle('open');
    $('#search-panel').classList.toggle('open');
  };

  // 预约号补查（预约号 + 手机号后4位 → 直接查 myBookings 然后前端过滤）
  $('#btn-qbk').onclick = async () => {
    const bk = $('#q-bkid').value.trim().toUpperCase();
    const phone4 = $('#q-phone4').value.trim();
    if (!/^BK[A-Z0-9]+$/i.test(bk)) { MB.toast('请输入正确的预约号格式'); return; }
    if (!/^\d{4}$/.test(phone4)) { MB.toast('请输入手机号后 4 位'); return; }
    // 先让用户输入完整手机号以调用 myBookings
    const fullPhone = prompt('请输入完整的 11 位手机号以查询：');
    if (!fullPhone || !/^1[3-9]\d{9}$/.test(fullPhone)) { MB.toast('手机号格式不正确'); return; }
    if (fullPhone.slice(-4) !== phone4) { MB.toast('后 4 位与手机号不匹配'); return; }
    const list = await MB.Bookings.myList(fullPhone);
    const found = list.find(x => x.id.toUpperCase() === bk);
    if (!found) { MB.toast('未找到该预约'); return; }
    state.phone = fullPhone;
    state.bookings = list;
    state.activeTab = classify(found);
    renderList();
    updateMemoryTip();
    MB.toast('已定位到该预约');
  };

  /* ============== 初始化：自动用本机记忆的手机号查 ============== */
  const lastPhone = MB.MyMemory.lastPhone();
  if (lastPhone) {
    $('#phone').value = lastPhone;
    await queryByPhone(lastPhone);
  } else {
    renderList(); // 渲染空状态
  }
  updateMemoryTip();
});