// ENGINE của thế giới chung: nhân vật, hiệu ứng, bảng xếp hạng, lịch, chuyển cảnh.
// Mỗi địa điểm (locations/<id>/scene.js) chỉ cần vẽ nền và (tuỳ chọn) diễn lại các hành động theo cách riêng.
//
// NHÂN VẬT: mỗi cảnh có sẵn một đám đông cố định (mặc định 30 nhân vật), KHÔNG gắn với người xem nào.
// Khi có người tương tác, engine bốc ngẫu nhiên một nhân vật đang rảnh để diễn hiệu ứng; trong lúc diễn,
// nhân vật đó tạm mang tên + ảnh của người xem, diễn xong lại thành nhân vật vô danh.
// (Hồ sơ, xu, cấp VIP của từng người xem vẫn được máy chủ lưu đầy đủ.)
//
// Hợp đồng của một scene:
//   export default {
//     background(ctx, w)          vẽ nền mỗi khung hình (bắt buộc)
//     foreground?(ctx, w)         vẽ đè lên nhân vật
//     source:   {x, y} | (w, c)=>{x, y}   nơi đồ/quà bay ra (quầy bar, bếp, phao câu...)
//     spot(w, c) -> {x, y}        chỗ đứng/ngồi ban đầu của từng nhân vật
//     wander?(w, c) -> {x,y}|null đi loanh quanh (null = đứng yên)
//     drawChar?(ctx, w, c)        vẽ thêm cho từng nhân vật (vd. cần câu)
//     actions?: { tên(w, a, d) }  diễn hành động theo kiểu riêng; d = bộ hành động mặc định
//     maxChars?: number           số nhân vật trong cảnh (mặc định 30)
//   }

const W = 1080;
const H = 1920;
const FONT = '"Segoe UI", "Noto Sans", "Helvetica Neue", Arial, sans-serif';
const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
const params = new URLSearchParams(location.search);
const TTS = params.get('tts') === '1';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

// ---------------- Trạng thái ----------------
let state = { worldName: '', location: null, next: null, schedule: [], leaderboard: [], paused: false };
let scene = null;
let sceneId = null;
let connected = false;
const chars = new Map(); // id nhân vật -> nhân vật
const viewerChar = new Map(); // id người xem -> nhân vật đang diễn cho người đó
const DEFAULT_CHARS = 30;
let particles = [];
let floaters = [];
let flyers = [];
let banners = [];
let effects = [];
let props = [];
const stageQueue = [];
let stageBusyUntil = 0;
let transition = null; // { born, title, swapped, pending }
let now = 0; // giây

const images = new Map();
function img(url) {
  if (!url) return null;
  if (!images.has(url)) {
    const im = new Image();
    im.src = url;
    images.set(url, im);
  }
  const im = images.get(url);
  return im.complete && im.naturalWidth ? im : null;
}

// ---------------- Tiện ích vẽ ----------------
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
function hue(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
function emoji(e, x, y, size) {
  ctx.font = `${size}px ${EMOJI_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(e, x, y);
}
function text(t, x, y, { size = 32, color = '#fff', weight = 700, align = 'center', stroke = 'rgba(0,0,0,.65)', maxWidth } = {}) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (stroke) {
    ctx.lineWidth = Math.max(3, size / 7);
    ctx.strokeStyle = stroke;
    ctx.lineJoin = 'round';
    ctx.strokeText(t, x, y, maxWidth);
  }
  ctx.fillStyle = color;
  ctx.fillText(t, x, y, maxWidth);
}
function pill(x, y, w, h, fill, r = h / 2) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}
function wrap(t, maxW, size) {
  ctx.font = `600 ${size}px ${FONT}`;
  const words = t.split(/\s+/);
  const lines = [];
  let line = '';
  for (const wd of words) {
    const test = line ? `${line} ${wd}` : wd;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = wd;
    } else line = test;
  }
  if (line) lines.push(line);
  if (lines.length > 3) {
    lines.length = 3;
    lines[2] += '…';
  }
  return lines;
}

// ---------------- API cho scene ----------------
const w = {
  W,
  H,
  rand,
  clamp,
  ease,
  emoji,
  text,
  pill,
  get t() {
    return now;
  },
  get chars() {
    return [...chars.values()];
  },
  get state() {
    return state;
  },
  getChar: (id) => chars.get(String(id)),
  sourceOf: (c) => srcOf(c),

  /**
   * Nhân vật để diễn hiệu ứng cho người xem trong ms mili giây.
   * Người đó vừa tương tác (nhân vật còn đang diễn) thì dùng lại nhân vật cũ để các hiệu ứng liền mạch;
   * nếu không thì bốc ngẫu nhiên một nhân vật đang rảnh (hết rảnh thì lấy nhân vật sắp diễn xong nhất).
   */
  charFor(user, ms = 6000) {
    let c = viewerChar.get(user.id);
    if (!c || !isBusy(c) || c.viewer?.id !== user.id) {
      const list = [...chars.values()];
      if (!list.length) return null;
      const free = list.filter((o) => !isBusy(o));
      c = free.length ? free[Math.floor(Math.random() * free.length)] : list.reduce((a, b) => (a.busyUntil < b.busyUntil ? a : b));
      if (c.viewer) viewerChar.delete(c.viewer.id);
      c.busyUntil = 0;
    }
    c.viewer = { id: user.id, name: user.name, avatar: user.avatar, tier: user.tier };
    c.busyUntil = Math.max(c.busyUntil, now + ms / 1000);
    viewerChar.set(user.id, c);
    return c;
  },
  moveTo(c, x, y) {
    c.tx = x;
    c.ty = y;
  },
  /** Chọn chỗ trống trong danh sách ghế. */
  freeSeat(seats, c) {
    const used = new Set([...chars.values()].filter((o) => o !== c && o.seat !== undefined).map((o) => o.seat));
    const free = seats.map((_, i) => i).filter((i) => !used.has(i));
    const i = free.length ? free[Math.floor(Math.random() * free.length)] : Math.floor(Math.random() * seats.length);
    c.seat = i;
    return { x: seats[i].x + (free.length ? 0 : rand(-25, 25)), y: seats[i].y + (free.length ? 0 : rand(-10, 10)) };
  },
  say(c, t, ms = 4000) {
    c.bubble = { text: t, until: now + ms / 1000 };
  },
  emote(c, e, ms = 2500) {
    c.emote = { e, until: now + ms / 1000 };
  },
  hold(c, e, ms = 9000) {
    c.item = { e, until: now + ms / 1000 };
  },
  /** Đồ bay từ điểm này tới điểm/nhân vật kia theo đường vòng cung. */
  fly(e, from, to, { ms = 900, size = 64, arc = 160, onArrive } = {}) {
    flyers.push({ e, x0: from.x, y0: from.y, to, born: now, dur: ms / 1000, size, arc, onArrive });
  },
  burst(x, y, { kind = 'confetti', n = 30, e = '✨', spread = 1, speed = 520, size = 34 } = {}) {
    for (let i = 0; i < n; i++) {
      const a = kind === 'hearts' ? rand(-Math.PI * 0.85, -Math.PI * 0.15) : rand(0, Math.PI * 2);
      const v = rand(0.35, 1) * speed * spread;
      particles.push({
        kind,
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - (kind === 'confetti' ? 250 : 0),
        g: kind === 'hearts' ? -60 : kind === 'sparkle' ? 0 : 900,
        life: 0,
        max: rand(1, 2),
        color: `hsl(${rand(0, 360)},90%,60%)`,
        e: kind === 'hearts' ? ['❤️', '💖', '💕'][i % 3] : e,
        size: kind === 'emoji' || kind === 'hearts' ? rand(size * 0.7, size * 1.2) : rand(8, 16),
        rot: rand(0, 6),
        vr: rand(-8, 8),
      });
    }
  },
  float(x, y, t, color = '#fff', size = 34) {
    floaters.push({ x, y, t, color, size, born: now, dur: 1.8 });
  },
  banner(t, { sub = '', color = '#ffca28', ms = 3500, big = false } = {}) {
    banners.push({ t, sub, color, big, born: now, dur: ms / 1000 });
    if (banners.length > 4) banners.shift();
  },
  /** Hiệu ứng tuỳ biến trong ms mili giây: draw(ctx, tiến độ 0..1). */
  effect(ms, draw, layer = 'over') {
    effects.push({ born: now, dur: ms / 1000, draw, layer });
  },
  prop(e, x, y, { ms = 12000, size = 56 } = {}) {
    props.push({ e, x, y, size, born: now, dur: ms / 1000 });
    if (props.length > 60) props.shift();
  },
  spotlight(c, ms = 4000) {
    w.effect(ms, (cx, p) => {
      const a = Math.sin(Math.PI * p) * 0.55;
      const g = cx.createRadialGradient(c.x, c.y - 40, 20, c.x, c.y - 40, 260);
      g.addColorStop(0, `rgba(255,250,220,${a})`);
      g.addColorStop(1, 'rgba(255,250,220,0)');
      cx.fillStyle = g;
      cx.beginPath();
      cx.moveTo(c.x - 40, 0);
      cx.lineTo(c.x + 40, 0);
      cx.lineTo(c.x + 230, c.y + 40);
      cx.lineTo(c.x - 230, c.y + 40);
      cx.closePath();
      cx.fill();
    }, 'under');
  },
  fireworks(ms = 5000) {
    const end = now + ms / 1000;
    const shoot = () => {
      if (now > end) return;
      const x = rand(150, W - 150);
      const y = rand(380, 900);
      for (let i = 0; i < 46; i++) {
        const a = (i / 46) * Math.PI * 2;
        const v = rand(260, 420);
        particles.push({ kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 220, life: 0, max: rand(1.1, 1.6), color: `hsl(${rand(0, 360)},100%,65%)`, size: 7 });
      }
      setTimeout(shoot, rand(250, 550));
    };
    shoot();
  },
  flash(color = '#fff', ms = 400) {
    w.effect(ms, (cx, p) => {
      cx.globalAlpha = (1 - p) * 0.5;
      cx.fillStyle = color;
      cx.fillRect(0, 0, W, H);
      cx.globalAlpha = 1;
    });
  },
};

// ---------------- Hành động mặc định ----------------
const giftLabel = (a) => {
  const g = a.data?.gift;
  return g ? `${g.count > 1 ? `${g.count}× ` : ''}${g.name}` : '';
};
// Biểu tượng đồ/quà: scene có thể đặt qua luật (params.emoji), mặc định là hộp quà
const itemOf = (a) => a.data?.params?.emoji || '🎁';
/** Điểm đồ/quà bay ra: cố định, hoặc tuỳ nhân vật nếu scene.source là hàm. */
const srcOf = (c) => (typeof scene.source === 'function' ? scene.source(w, c) : scene.source);

const defaults = {
  enter(w, a) {
    const c = w.charFor(a.user, 3000);
    if (!c) return;
    if (a.user.isNew) w.emote(c, '🆕', 3000);
    w.emote(c, '👋', 2000);
    if (a.user.tier.rank >= 2) w.banner(`${a.user.tier.name} ${a.user.name} đã đến`, { color: a.user.tier.color, ms: 2600 });
  },
  cheer(w, a) {
    const c = w.charFor(a.user, 2500);
    if (!c) return;
    w.emote(c, '❤️', 1800);
    w.burst(c.x, c.y - 110, { kind: 'hearts', n: 5, speed: 200 });
  },
  follow(w, a) {
    const c = w.charFor(a.user, 3500);
    if (!c) return;
    w.emote(c, '⭐', 3000);
    w.float(c.x, c.y - 150, '+ Theo dõi', '#ffe082');
    w.burst(c.x, c.y - 80, { kind: 'sparkle', n: 14, speed: 260 });
  },
  share(w, a) {
    const c = w.charFor(a.user, 3500);
    if (!c) return;
    w.emote(c, '🔗', 3000);
    w.float(c.x, c.y - 150, 'Đã chia sẻ', '#80deea');
  },
  chat(w, a) {
    const c = w.charFor(a.user, 5000);
    if (!c) return;
    w.say(c, a.data.text);
  },
  crowd(w, a) {
    w.banner(`+${a.data.count} người vừa vào`, { color: '#b0bec5', ms: 2000 });
  },
  request_song(w, a) {
    const c = w.charFor(a.user, 5000);
    if (!c) return;
    w.emote(c, '🎵', 4000);
    w.banner(`🎵 ${a.user.name} chọn bài`, { sub: a.data.text, color: '#ce93d8', ms: 4500 });
  },
  gift_small(w, a) {
    const c = w.charFor(a.user, 6000);
    if (!c) return;
    w.fly(itemOf(a), srcOf(c), c, { onArrive: () => w.hold(c, itemOf(a)) });
    w.float(c.x, c.y - 160, giftLabel(a), '#fff59d');
  },
  gift_medium(w, a) {
    const c = w.charFor(a.user, 6000);
    if (!c) return;
    w.fly(itemOf(a), srcOf(c), c, { size: 80, onArrive: () => w.hold(c, itemOf(a)) });
    w.spotlight(c, 4000);
    w.burst(c.x, c.y - 80, { kind: 'sparkle', n: 24 });
    w.banner(a.say || `${a.user.name} tặng ${giftLabel(a)}`, { color: a.user.tier.color, ms: 3000 });
  },
  gift_big(w, a) {
    const c = w.charFor(a.user, 8000);
    if (!c) return;
    w.fly(itemOf(a), srcOf(c), c, { size: 110, arc: 300, ms: 1200, onArrive: () => w.hold(c, itemOf(a), 15000) });
    w.spotlight(c, 5000);
    w.flash('#fff8e1');
    w.burst(W / 2, 700, { kind: 'confetti', n: 90, spread: 1.4 });
    w.banner(a.say || `${a.user.name} tặng ${giftLabel(a)}`, { sub: giftLabel(a), big: true, color: '#ffca28', ms: 4500 });
    return 4500;
  },
  gift_huge(w, a) {
    const c = w.charFor(a.user, 9000);
    if (!c) return;
    w.flash('#fffde7', 700);
    w.fireworks(6500);
    w.spotlight(c, 7000);
    for (const o of w.chars) {
      w.emote(o, '🎉', 5000);
      setTimeout(() => w.fly(itemOf(a), srcOf(o), o, { size: 56, onArrive: () => w.hold(o, itemOf(a), 15000) }), rand(0, 1500));
    }
    w.banner(a.say || `Cảm ơn ${a.user.name}!`, { sub: giftLabel(a), big: true, color: '#ff8a65', ms: 6500 });
    return 6500;
  },
  tier_up(w, a) {
    const c = w.charFor(a.user, 5000);
    if (!c) return;
    w.burst(c.x, c.y - 80, { kind: 'emoji', e: '🎖️', n: 10, speed: 380 });
    w.banner(`🎖️ ${a.user.name} lên ${a.data.to.name}!`, { color: a.data.to.color, big: true, ms: 3500 });
    return 3500;
  },
  unknown(w, a) {
    const c = a.user && w.charFor(a.user, 3000);
    if (c) w.float(c.x, 600, a.action);
  },
};

// ---------------- Xử lý hành động ----------------
function handle(a) {
  if (!scene || transition) {
    if ((a.priority || 0) >= 3) stageQueue.push(a); // quà lớn không được mất khi đang chuyển cảnh
    return;
  }
  if (!state.location && a.action.startsWith('gift')) {
    // Ngoài giờ mở cửa: vẫn cảm ơn bằng thông báo
    w.banner(a.say || `Cảm ơn ${a.user.name}!`, { sub: giftLabel(a), color: '#ffca28' });
    speak(a.say);
    return;
  }
  if (!state.location) return;
  if ((a.priority || 0) >= 3) {
    stageQueue.push(a);
    stageQueue.sort((x, y) => (y.priority || 0) - (x.priority || 0));
    if (stageQueue.length > 20) stageQueue.length = 20;
    return;
  }
  run(a);
}

function run(a) {
  const custom = scene.actions?.[a.action];
  const fn = custom || defaults[a.action] || defaults.unknown;
  let dur = 0;
  try {
    dur = fn(w, a, defaults) || 0;
  } catch (err) {
    console.error('Lỗi diễn hành động', a.action, err);
  }
  speak(a.say);
  return dur;
}

function pumpStage() {
  if (transition || !scene || !state.location || now < stageBusyUntil || !stageQueue.length) return;
  const a = stageQueue.shift();
  stageBusyUntil = now + (run(a) || 3000) / 1000 + 0.3;
}

// Đọc tên bằng giọng nói của trình duyệt (bật bằng ?tts=1). Không dồn hàng quá 3 câu.
let speaking = 0;
let viVoice = null;
function speak(t) {
  if (!TTS || !t || !('speechSynthesis' in window) || speaking >= 3) return;
  viVoice ??= speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith('vi')) || null;
  const u = new SpeechSynthesisUtterance(t);
  u.lang = 'vi-VN';
  if (viVoice) u.voice = viVoice;
  u.rate = 1.05;
  speaking++;
  u.onend = u.onerror = () => (speaking = Math.max(0, speaking - 1));
  speechSynthesis.speak(u);
}

// ---------------- Quản lý nhân vật ----------------
const isBusy = (c) => Boolean(c.viewer) && now < c.busyUntil;

/** Tạo đám đông cố định cho cảnh mới. */
function populate() {
  chars.clear();
  viewerChar.clear();
  const n = scene?.maxChars ?? DEFAULT_CHARS;
  for (let i = 0; i < n; i++) {
    const c = { id: `npc-${i}`, hue: (i * 47 + 20) % 360, viewer: null, busyUntil: 0, nextWander: now + rand(2, 14) };
    chars.set(c.id, c);
    const s = scene.spot(w, c);
    c.x = c.tx = s.x;
    c.y = c.ty = s.y;
  }
}

/** Bỏ tên người xem khỏi nhân vật (diễn xong, hoặc người đó bị chặn). */
function release(c) {
  if (c.viewer && viewerChar.get(c.viewer.id) === c) viewerChar.delete(c.viewer.id);
  c.viewer = null;
  c.busyUntil = 0;
}

function updateChars(dt) {
  for (const c of chars.values()) {
    const dx = c.tx - c.x;
    const dy = c.ty - c.y;
    const d = Math.hypot(dx, dy);
    const sp = 260 * dt;
    c.moving = d > 2;
    if (d <= sp) {
      c.x = c.tx;
      c.y = c.ty;
    } else {
      c.x += (dx / d) * sp;
      c.y += (dy / d) * sp;
    }
    if (c.viewer && now >= c.busyUntil) release(c);
    if (!c.moving && !isBusy(c) && now > c.nextWander && scene.wander) {
      const p = scene.wander(w, c);
      if (p) w.moveTo(c, p.x, p.y);
      c.nextWander = now + rand(8, 18);
    }
  }
}

function drawChar(c) {
  const bob = c.moving ? Math.abs(Math.sin(now * 10)) * 8 : Math.sin(now * 2 + c.hue) * 2;
  const x = c.x;
  const y = c.y - bob;
  const v = isBusy(c) ? c.viewer : null; // người xem đang được diễn (null = nhân vật vô danh)
  const tierColor = v?.tier?.color || 'rgba(255,255,255,.35)';
  const rank = v?.tier?.rank || 0;

  // bóng
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.beginPath();
  ctx.ellipse(c.x, c.y + 4, 38, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  // thân
  ctx.fillStyle = `hsl(${c.hue},55%,48%)`;
  ctx.beginPath();
  ctx.roundRect(x - 30, y - 70, 60, 70, [26, 26, 12, 12]);
  ctx.fill();
  // đầu (ảnh đại diện hoặc chữ cái đầu)
  const hy = y - 100;
  const r = 36;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, hy, r, 0, Math.PI * 2);
  ctx.closePath();
  const im = v && img(v.avatar);
  if (im) {
    ctx.clip();
    ctx.drawImage(im, x - r, hy - r, r * 2, r * 2);
  } else {
    ctx.fillStyle = `hsl(${c.hue},65%,72%)`;
    ctx.fill();
    if (v) text((v.name || '?').trim().charAt(0).toUpperCase(), x, hy + 2, { size: 34, color: '#263238', stroke: null });
    else {
      // mặt đơn giản cho nhân vật vô danh
      ctx.fillStyle = '#263238';
      ctx.beginPath();
      ctx.arc(x - 12, hy - 4, 4, 0, Math.PI * 2);
      ctx.arc(x + 12, hy - 4, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  ctx.lineWidth = v ? 4 + rank * 1.5 : 2;
  ctx.strokeStyle = tierColor;
  ctx.beginPath();
  ctx.arc(x, hy, r, 0, Math.PI * 2);
  ctx.stroke();
  if (rank >= 3) emoji('👑', x, hy - r - 14, 34);

  // đồ đang cầm
  if (c.item && now < c.item.until) emoji(c.item.e, x + 46, y - 40, 44);
  // biểu cảm
  if (c.emote && now < c.emote.until) emoji(c.emote.e, x + 40, hy - 40, 38);

  // tên người xem (chỉ khi đang diễn cho người đó)
  if (v) {
    ctx.font = `700 24px ${FONT}`;
    const tw = Math.min(ctx.measureText(v.name).width, 220) + 22;
    pill(x - tw / 2, c.y + 12, tw, 34, 'rgba(0,0,0,.55)');
    text(v.name, x, c.y + 30, { size: 24, color: rank >= 1 ? tierColor : '#fff', stroke: null, maxWidth: 220 });
  }

  // bong bóng chat
  if (c.bubble && now < c.bubble.until) {
    const lines = wrap(c.bubble.text, 330, 26);
    let bw = 0;
    ctx.font = `600 26px ${FONT}`;
    for (const l of lines) bw = Math.max(bw, ctx.measureText(l).width);
    bw += 32;
    const bh = lines.length * 32 + 20;
    const bx = clamp(x - bw / 2, 10, W - bw - 10);
    const by = hy - r - 26 - bh;
    pill(bx, by, bw, bh, 'rgba(255,255,255,.95)', 18);
    ctx.fillStyle = 'rgba(255,255,255,.95)';
    ctx.beginPath();
    ctx.moveTo(x - 10, by + bh);
    ctx.lineTo(x + 10, by + bh);
    ctx.lineTo(x, by + bh + 14);
    ctx.fill();
    lines.forEach((l, i) => text(l, bx + bw / 2, by + 26 + i * 32, { size: 26, color: '#212121', weight: 600, stroke: null }));
  }
}

// ---------------- Hiệu ứng ----------------
function updateDraw(dt) {
  // hạt
  particles = particles.filter((p) => (p.life += dt) < p.max);
  for (const p of particles) {
    p.vy += p.g * dt;
    p.vx *= 0.99;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    const a = 1 - p.life / p.max;
    ctx.globalAlpha = a;
    if (p.kind === 'hearts' || p.kind === 'emoji') emoji(p.e, p.x, p.y, p.size);
    else if (p.kind === 'confetti') {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.kind === 'spark' ? p.size * a + 1 : p.size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // đồ bay
  flyers = flyers.filter((f) => {
    const p = (now - f.born) / f.dur;
    const tx = f.to.x;
    const ty = f.to.y - (f.to.id ? 60 : 0);
    if (p >= 1) {
      f.onArrive?.();
      return false;
    }
    const e = ease(p);
    emoji(f.e, f.x0 + (tx - f.x0) * e, f.y0 + (ty - f.y0) * e - Math.sin(Math.PI * p) * f.arc, f.size);
    return true;
  });

  // chữ nổi
  floaters = floaters.filter((f) => {
    const p = (now - f.born) / f.dur;
    if (p >= 1) return false;
    ctx.globalAlpha = 1 - p * p;
    text(f.t, f.x, f.y - p * 90, { size: f.size, color: f.color });
    ctx.globalAlpha = 1;
    return true;
  });
}

function drawEffects(layer) {
  effects = effects.filter((e) => {
    const p = (now - e.born) / e.dur;
    if (p >= 1) return false;
    if (e.layer === layer) e.draw(ctx, p);
    return true;
  });
}

function drawProps() {
  props = props.filter((p) => {
    const age = now - p.born;
    if (age > p.dur) return false;
    ctx.globalAlpha = clamp((p.dur - age) / 0.8, 0, 1);
    emoji(p.e, p.x, p.y - Math.min(age, 0.3) * 30, p.size);
    ctx.globalAlpha = 1;
    return true;
  });
}

function drawBanners() {
  banners = banners.filter((b) => now - b.born < b.dur);
  let y = 640;
  for (const b of banners) {
    const age = now - b.born;
    const a = Math.min(age / 0.25, (b.dur - age) / 0.4, 1);
    const scale = b.big ? 1 + 0.08 * Math.max(0, 1 - age / 0.3) : 1;
    const h = b.big ? 150 : 92;
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.translate(W / 2, y + h / 2);
    ctx.scale(scale, scale);
    const g = ctx.createLinearGradient(-480, 0, 480, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.15, 'rgba(10,10,20,.82)');
    g.addColorStop(0.85, 'rgba(10,10,20,.82)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-540, -h / 2, 1080, h);
    ctx.fillStyle = b.color;
    ctx.fillRect(-380, -h / 2, 760, 4);
    ctx.fillRect(-380, h / 2 - 4, 760, 4);
    text(b.t, 0, b.sub ? -h * 0.16 : 0, { size: b.big ? 50 : 38, color: b.color, maxWidth: 960 });
    if (b.sub) text(b.sub, 0, h * 0.24, { size: b.big ? 34 : 28, color: '#fff', weight: 600, maxWidth: 940 });
    ctx.restore();
    y += h + 16;
  }
}

// ---------------- HUD tối giản (scene tự vẽ thêm nếu cần, dữ liệu ở w.state) ----------------
function drawHud() {
  const g = ctx.createLinearGradient(0, 0, 0, 200);
  g.addColorStop(0, 'rgba(0,0,0,.6)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, 200);
  const loc = state.location;
  text(state.worldName || '', 40, 62, { size: 34, color: '#ffe082', align: 'left' });
  text(loc ? `${loc.emoji} ${loc.name}` : '🌙 Đang nghỉ', 40, 112, { size: 52, align: 'left' });
  // Chấm đỏ góc phải: mất kết nối tới máy chủ
  if (!connected) {
    ctx.fillStyle = '#e53935';
    ctx.beginPath();
    ctx.arc(W - 30, 60, 10, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------- Màn hình nghỉ (ngoài giờ mở cửa) ----------------
function drawClosed() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0d1b2a');
  g.addColorStop(1, '#1b263b');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  text('Đang nghỉ', W / 2, H / 2 - 60, { size: 80, color: '#ffe082' });
  if (state.next) text(`Mở lại lúc ${state.next.start} · ${state.next.emoji} ${state.next.name}`, W / 2, H / 2 + 40, { size: 40 });
}

// ---------------- Chuyển cảnh ----------------
async function applyState(s) {
  const prev = state.location?.id || null;
  state = { ...state, ...s };
  const nextId = state.location?.id || null;
  if (nextId === sceneId && (scene || !nextId)) return;
  const title = state.location ? `${state.location.emoji} ${state.location.name}` : '🌙 Đóng cửa';
  const mod = nextId ? await import(`/locations/${nextId}/scene.js?v=${Date.now()}`).catch((err) => {
    console.error('Không tải được scene', nextId, err);
    return null;
  }) : null;
  const swap = () => {
    scene = mod?.default || null;
    sceneId = nextId;
    chars.clear();
    viewerChar.clear();
    if (scene) populate();
    particles = [];
    flyers = [];
    props = [];
    effects = [];
    stageBusyUntil = 0;
  };
  if (prev === null && sceneId === null && !scene) {
    swap(); // lần đầu: vào thẳng
    transition = { born: now, title, swapped: true, introOnly: true };
  } else transition = { born: now, title, swapped: false, swap };
}

function drawTransition() {
  if (!transition) return;
  const t = now - transition.born;
  let a;
  if (transition.introOnly) a = t < 1.2 ? 0.75 : Math.max(0, 0.75 - (t - 1.2) * 1.5);
  else {
    if (t >= 0.6 && !transition.swapped) {
      transition.swap();
      transition.swapped = true;
    }
    a = t < 0.6 ? t / 0.6 : t < 1.8 ? 1 : Math.max(0, 1 - (t - 1.8) / 0.6);
  }
  ctx.fillStyle = `rgba(0,0,0,${a})`;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = Math.min(1, a * 1.5);
  text(transition.title, W / 2, H / 2 - 100, { size: 80, color: '#ffe082' });
  if (!transition.introOnly) text('Đang chuyển địa điểm…', W / 2, H / 2, { size: 38 });
  ctx.globalAlpha = 1;
  if (a <= 0 && t > 0.7) transition = null;
}

// ---------------- Vòng lặp ----------------
let last = performance.now();
function frame(ts) {
  const dt = Math.min(0.05, (ts - last) / 1000);
  last = ts;
  now += dt;
  ctx.clearRect(0, 0, W, H);

  if (scene && state.location) {
    scene.background(ctx, w);
    drawEffects('under');
    drawProps();
    updateChars(dt);
    const list = [...chars.values()].sort((a, b) => a.y - b.y);
    for (const c of list) {
      scene.drawChar?.(ctx, w, c);
      drawChar(c);
    }
    scene.foreground?.(ctx, w);
  } else drawClosed();

  drawEffects('over');
  updateDraw(dt);
  drawHud();
  drawBanners();
  drawTransition();
  pumpStage();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------- Kết nối máy chủ ----------------
function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?role=world`);
  ws.onopen = () => (connected = true);
  ws.onclose = () => {
    connected = false;
    setTimeout(connect, 2000);
  };
  ws.onerror = () => ws.close();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.type === 'hello' || msg.type === 'state') applyState(msg.state);
    else if (msg.type === 'action') handle(msg.action);
    else if (msg.type === 'boards') state = { ...state, leaderboard: msg.leaderboard };
    else if (msg.type === 'paused') state.paused = msg.paused;
    else if (msg.type === 'remove') {
      const c = viewerChar.get(String(msg.userId));
      if (c) {
        c.bubble = null;
        release(c);
      }
    }
  };
}
connect();

// Cho phép thử nhanh trên trình duyệt: window.world
window.world = { w, handle, get state() { return state; } };
