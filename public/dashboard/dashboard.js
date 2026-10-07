// Bảng điều khiển: hỏi trạng thái mỗi 2 giây, gửi lệnh qua /api/*.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => Number(n || 0).toLocaleString('vi-VN');
const time = (ts) => new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

let token = '';
try {
  token = new URLSearchParams(location.search).get('token') || localStorage.getItem('dashToken') || '';
} catch {
  // trình duyệt chặn bộ nhớ: nhập lại mỗi lần
}

const STATE_VI = { connected: 'đã kết nối', connecting: 'đang kết nối', disconnected: 'mất kết nối', offline: 'kênh chưa live', error: 'lỗi', idle: 'chưa chạy' };
const ACTION_VI = {
  enter: 'vào', cheer: 'thả tim', follow: 'theo dõi', share: 'chia sẻ', chat: 'chat', crowd: 'đám đông',
  gift_small: 'quà nhỏ', gift_medium: 'quà vừa', gift_big: 'quà lớn', gift_huge: 'quà khủng', tier_up: 'lên cấp', request_song: 'chọn nhạc',
  troll: 'troll', troll_shield: 'bật khiên', troll_dance: 'nhảy troll', troll_top: 'nạn nhân của đêm', troll_armed: 'nhắm troll',
};

async function call(path, body) {
  const res = await fetch(`/api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-token': token },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    $('login').style.display = 'block';
    throw new Error('Sai mật khẩu');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Lỗi');
  return data;
}

let paused = false;
let locOptionsKey = '';
let cmdOptionsKey = '';

const PILL_VI = { connected: 'Đang live', connecting: 'Đang kết nối', disconnected: 'Mất kết nối', offline: 'Chưa live', error: 'Lỗi nguồn', idle: 'Chưa chạy' };
// Màu nhãn cho từng loại hành động / mức nhật ký
const actionTone = (a) =>
  a.startsWith('gift') || a === 'tier_up' ? 'warn' : a.startsWith('troll') ? 'purple' : a === 'enter' || a === 'follow' ? 'info' : a === 'cheer' ? 'bad' : '';
const LOG_TONE = { info: 'info', warn: 'warn', error: 'bad' };
const DATE_FMT = { weekday: 'long', day: 'numeric', month: 'long' };

function render(s) {
  $('login').style.display = 'none';
  $('title').textContent = s.worldName || 'Bảng điều khiển';
  document.title = `${s.worldName || 'Bảng điều khiển'} · Tổng quan`;
  const st = s.source;
  // Nguồn giả lập "đã kết nối" không phải đang live thật
  const pillText = st.source === 'simulator' && st.state === 'connected' ? 'Giả lập' : PILL_VI[st.state] || st.state;
  $('statusPill').className = `pill ${st.source === 'simulator' ? 'connecting' : st.state}`;
  $('statusPill').textContent = pillText;
  $('src').innerHTML = `<b>${esc(st.source)}</b> · ${esc(STATE_VI[st.state] || st.state)}${st.detail ? `<br><span class="muted">${esc(st.detail)}</span>` : ''}`;
  $('kWorld').textContent = fmt(s.worldClients);
  $('world').className = `badge ${s.worldClients ? 'ok' : 'bad'}`;
  $('world').textContent = s.worldClients ? 'Đang mở' : 'Chưa mở';
  const locText = s.location ? `${s.location.emoji} ${s.location.name}${s.overridden ? ' (chỉnh tay)' : ''}` : '🌙 Đóng cửa';
  $('loc').textContent = locText;
  $('next').textContent = s.next ? `${s.next.emoji} ${s.next.name} lúc ${s.next.start}` : '—';

  const date = new Date().toLocaleDateString('vi-VN', DATE_FMT);
  $('subline').innerHTML = [
    `<span>${esc(date.charAt(0).toUpperCase() + date.slice(1))}</span>`,
    `<span>📍 ${esc(locText)}</span>`,
    `<span>Nguồn: <span class="${st.state === 'connected' && st.source !== 'simulator' ? 'hl' : ''}">${esc(pillText)}</span></span>`,
    s.next ? `<span>Tiếp theo: ${esc(s.next.name)} lúc ${esc(s.next.start)}</span>` : '',
  ]
    .filter(Boolean)
    .join('<span class="sep">·</span>');

  const key = s.locations.map((l) => l.id).join();
  if (key !== locOptionsKey) {
    locOptionsKey = key;
    $('locSelect').innerHTML =
      '<option value="">📅 Theo lịch</option>' + s.locations.map((l) => `<option value="${esc(l.id)}">${esc(l.emoji)} ${esc(l.name)}</option>`).join('');
  }
  if (document.activeElement !== $('locSelect')) $('locSelect').value = s.overridden && s.location ? s.location.id : '';

  const cmdKey = JSON.stringify(s.commands || []);
  if (cmdKey !== cmdOptionsKey) {
    cmdOptionsKey = cmdKey;
    $('cmdBtns').innerHTML = (s.commands || []).length
      ? s.commands
          .map((c) => `<button data-sim='${esc(JSON.stringify({ type: 'gift', giftName: c.gift, coins: 1 }))}'>${esc(c.icon)} ${esc(c.label)}</button>`)
          .join('')
      : '<span class="muted">Không có</span>';
  }

  paused = s.paused;
  $('pauseBtn').innerHTML = paused ? '▶ <span class="txt">Bật hiệu ứng</span>' : '⏸ <span class="txt">Tạm dừng</span>';
  $('pauseBtn').className = paused ? 'primary' : '';

  const ss = s.session || { coins: 0, coinsPerHour: 0, gifters: 0 };
  $('sCoins').textContent = fmt(ss.coins);
  $('sVnd').textContent = `${fmt(ss.coins * s.vndPerCoin)} đ`;
  $('sRate').textContent = fmt(ss.coinsPerHour);
  $('sGifters').textContent = fmt(ss.gifters);
  $('bCoins').textContent = s.session ? 'Ca hiện tại' : 'Chưa mở ca';
  const todayTotal = s.todayByLocation.reduce((n, r) => n + (r.coins || 0), 0);
  $('kToday').textContent = fmt(todayTotal);
  $('bToday').textContent = `≈ ${fmt(todayTotal * s.vndPerCoin)} đ`;
  $('today').innerHTML = s.todayByLocation.length
    ? s.todayByLocation.map((r) => `${esc(r.name)} <span class="coins">${fmt(r.coins)} xu</span>`).join('<br>')
    : '<span class="muted">Chưa có quà</span>';

  const active = s.alerts.active;
  $('alertBox').classList.toggle('show', active.length > 0);
  $('alerts').innerHTML = active
    .map((a) => `<div class="item"><span>${esc(a.message)}</span><button class="small" data-dismiss="${esc(a.key)}">Ẩn</button></div>`)
    .join('');

  if (s.actions.length) {
    $('actions').innerHTML = s.actions
      .slice(-60)
      .reverse()
      .map(
        (a) => `<div class="row"><span><span class="t">${time(a.ts)}</span><span class="badge ${actionTone(a.action)}">${esc(ACTION_VI[a.action] || a.action)}</span>
          ${a.user ? ` <b>${esc(a.user.name)}</b>` : ''} ${a.coins ? `<span class="coins">${fmt(a.coins)} xu</span>` : ''} ${esc(a.text)} ${a.test ? '<span class="badge">thử</span>' : ''}</span>
          ${a.user && !a.test ? `<button class="danger" data-block="${esc(a.user.id)}" data-name="${esc(a.user.name)}">Chặn</button>` : ''}</div>`,
      )
      .join('');
  }

  $('blockedCount').textContent = s.blocked.length;
  $('blocked').innerHTML = s.blocked.length
    ? s.blocked.map((b) => `<div class="row"><span>${esc(b.name || b.id)} <span class="muted">${esc(b.id)}</span></span><button class="small" data-unblock="${esc(b.id)}">Bỏ chặn</button></div>`).join('')
    : '<span class="muted">Không có</span>';

  $('logs').innerHTML = s.logs
    .map((l) => `<div class="row"><span><span class="t">${time(l.ts)}</span>${esc(l.msg)}</span><span class="badge ${LOG_TONE[l.level] || ''}">${esc(l.level)}</span></div>`)
    .join('');
}

async function refresh() {
  try {
    render((await call('status')));
    const top = await call('leaderboard');
    $('top').innerHTML = top.today.length
      ? top.today
          .map((p, i) => `<div class="row"><span><span class="rank ${i < 3 ? `r${i + 1}` : ''}">${i + 1}</span>${esc(p.name)}</span><span class="coins">${fmt(p.coins)} xu</span></div>`)
          .join('')
      : '<span class="muted">Chưa có</span>';
  } catch (err) {
    $('statusPill').className = 'pill error';
    $('statusPill').textContent = 'Mất máy chủ';
    $('src').textContent = `Không kết nối được máy chủ (${err.message})`;
  }
}

// Người thử: đổi tên là thành người khác (để thử mời / ném bánh giữa 2 người)
function testUser() {
  const name = ($('chatName').value || 'Người thử').trim();
  return { userId: `test-${name.toLowerCase().replace(/\s+/g, '-')}`, name };
}
function sendChat(text) {
  if (!text.trim()) return;
  act('simulate', { ...testUser(), type: 'chat', text: text.trim() });
}

// Thử quán đông: thả nhiều người thử vào cùng lúc
const HO = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Vũ', 'Đặng', 'Bùi'];
const TEN = ['An', 'Bình', 'Chi', 'Dũng', 'Giang', 'Hà', 'Khoa', 'Linh', 'Mai', 'Nam', 'Phúc', 'Quân', 'Trang', 'Vy'];
async function bulkJoin(n) {
  for (let i = 0; i < n; i++) {
    const id = `thu-${Date.now()}-${i}`;
    const name = `${HO[Math.floor(Math.random() * HO.length)]} ${TEN[Math.floor(Math.random() * TEN.length)]}`;
    call('simulate', { type: 'join', userId: id, name }).catch(() => {});
    if (i % 8 === 7) await new Promise((r) => setTimeout(r, 1000)); // tránh vượt giới hạn người vào mỗi giây
  }
}

async function act(path, body) {
  try {
    await call(path, body);
  } catch (err) {
    alert(err.message);
  }
  refresh();
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.sim) act('simulate', { ...testUser(), ...JSON.parse(b.dataset.sim) });
  else if (b.dataset.bulk) bulkJoin(Number(b.dataset.bulk));
  else if (b.dataset.chat) sendChat(b.dataset.chat);
  else if (b.dataset.block && confirm(`Chặn ${b.dataset.name}? Người này sẽ không hiện trên live nữa.`)) act('block', { userId: b.dataset.block, name: b.dataset.name });
  else if (b.dataset.unblock) act('unblock', { userId: b.dataset.unblock });
  else if (b.dataset.dismiss) act('dismiss-alert', { key: b.dataset.dismiss });
});
$('pauseBtn').onclick = () => act('pause', { paused: !paused });
$('chatSend').onclick = () => {
  sendChat($('chatText').value);
  $('chatText').value = '';
};
$('chatText').onkeydown = (e) => {
  if (e.key === 'Enter') $('chatSend').click();
};
$('reconnectBtn').onclick = () => act('reconnect', {});
$('locSelect').onchange = (e) => act('location', { location: e.target.value || null });
$('tokenBtn').onclick = () => {
  token = $('tokenInput').value;
  try {
    localStorage.setItem('dashToken', token);
  } catch {
    // bỏ qua
  }
  refresh();
};

refresh();
setInterval(refresh, 2000);
