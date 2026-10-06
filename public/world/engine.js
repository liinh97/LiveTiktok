// ENGINE của thế giới chung: nền, đám đông, hiệu ứng, chuyển cảnh, hàng chờ quà lớn.
//
// NHÂN VẬT: mỗi cảnh có sẵn một đám đông cố định, KHÔNG gắn với người xem nào.
// Khi có người tương tác, engine bốc ngẫu nhiên một nhân vật đang rảnh để diễn hiệu ứng; trong lúc diễn,
// trên đầu nhân vật hiện thẻ (ảnh đại diện + tên) của người xem, diễn xong lại thành nhân vật vô danh.
// (Hồ sơ, xu, cấp VIP của từng người xem vẫn được máy chủ lưu đầy đủ.)
//
// Hợp đồng của một scene (locations/<id>/scene.js):
//   export default {
//     background(ctx, w)          vẽ nền mỗi khung hình (bắt buộc). w.hasMedia = true nếu đã có video/ảnh nền thật
//                                 (thả locations/<id>/assets/background.mp4|webm|jpg|png|webp là tự dùng, không cần khai báo)
//     foreground?(ctx, w)         vẽ đè lên nhân vật (vd. mép quầy bar phía trước)
//     source: {x,y} | (w,c)=>{x,y} nơi đồ/quà bay ra (quầy bar, bếp...)
//     spots?: [{x,y}] | (w)=>[]   chỗ đứng cố định của đám đông (mỗi chỗ một người, không chồng nhau)
//     spot?(w, c) -> {x,y}        hoặc tự chọn chỗ cho từng nhân vật
//     scaleAt?(y) -> number       to/nhỏ theo độ xa gần (mặc định 1)
//     charHeight?: number         chiều cao nhân vật (px, chưa nhân tỉ lệ) để đặt thẻ tên trên đầu
//     drawBody?(ctx, w, c, o)     tự vẽ thân nhân vật; o = { x, y, s (tỉ lệ), lit (màu viền khi đang diễn | null) }
//     wander?(w, c) -> {x,y}|null đi loanh quanh (null = đứng yên)
//     stageFloorY?: number        độ cao sàn để đặt pháo sáng / khói (mặc định 1500)
//     actions?: { tên(w, a, d) }  diễn hành động theo kiểu riêng; d = bộ hành động mặc định
//     maxChars?: number           số nhân vật (mặc định 24)
//   }

import { createFx } from './fx.js';

const W = 1080;
const H = 1920;
const FONT = '"Segoe UI", "Noto Sans", "Helvetica Neue", Arial, sans-serif';
const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
const params = new URLSearchParams(location.search);
const TTS = params.get('tts') === '1';
const DEFAULT_CHARS = 24;

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

// ---------------- Trạng thái ----------------
let state = { worldName: '', location: null, next: null, schedule: [], leaderboard: [], paused: false };
let scene = null;
let sceneId = null;
let media = null; // { el, kind }
let connected = false;
const chars = new Map(); // id nhân vật -> nhân vật
const viewerChar = new Map(); // id người xem -> nhân vật đang diễn cho người đó
let bits = []; // hạt đơn giản: tim, emoji
let floaters = [];
let flyers = [];
let banners = [];
const stageQueue = [];
let stageBusyUntil = 0;
let transition = null;
let now = 0; // giây

const fx = createFx({ ctx, W, H, clock: () => now });

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
  if (lines.length > 2) {
    lines.length = 2;
    lines[1] += '…';
  }
  return lines;
}
/** '#ffca28' -> [255, 202, 40] để dùng với fx */
function rgb(hex, fallback = [255, 220, 150]) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------- API cho scene ----------------
const scaleOf = (c) => scene?.scaleAt?.(c.y) ?? 1;
const headTop = (c) => c.y - (scene?.charHeight ?? 136) * scaleOf(c);

const w = {
  W,
  H,
  fx,
  rand,
  clamp,
  ease,
  emoji,
  text,
  pill,
  rgb,
  get t() {
    return now;
  },
  get chars() {
    return [...chars.values()];
  },
  get state() {
    return state;
  },
  get hasMedia() {
    return mediaReady();
  },
  scaleOf,
  headTop,
  /** Vị trí ngực nhân vật (để đèn rọi, tia lửa nhắm vào). */
  chest: (c) => ({ x: c.x, y: c.y - (scene?.charHeight ?? 136) * scaleOf(c) * 0.45 }),
  sourceOf: (c) => srcOf(c),

  /**
   * Nhân vật để diễn cho người xem trong ms mili giây.
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
  /** Về lại chỗ đứng ban đầu. */
  goHome(c) {
    c.tx = c.home.x;
    c.ty = c.home.y;
  },
  /** Tư thế tạm thời: 'cheer' (giơ tay), 'dance' (nhún nhảy)... scene tự vẽ theo c.pose. */
  pose(c, name, ms = 3000) {
    c.pose = name;
    c.poseUntil = now + ms / 1000;
  },
  say(c, t, ms = 4000) {
    c.bubble = { text: t, until: now + ms / 1000 };
  },
  emote(c, e, ms = 2500) {
    c.emote = { e, until: now + ms / 1000 };
  },
  hold(c, e, ms = 4000) {
    c.item = { e, until: now + ms / 1000 };
  },
  /** Đồ bay từ điểm này tới điểm/nhân vật kia theo đường vòng cung. */
  fly(e, from, to, { ms = 900, size = 64, arc = 160, onArrive } = {}) {
    flyers.push({ e, x0: from.x, y0: from.y, to, born: now, dur: ms / 1000, size, arc, onArrive });
  },
  /** Tim / emoji bay lên. */
  hearts(x, y, { n = 5, e = null } = {}) {
    for (let i = 0; i < n; i++) {
      bits.push({ x, y, vx: rand(-60, 60), vy: rand(-260, -160), life: 0, max: rand(1, 1.6), e: e || ['❤️', '💖', '💕'][i % 3], size: rand(24, 36) });
    }
  },
  float(x, y, t, color = '#fff', size = 30) {
    floaters.push({ x, y, t, color, size, born: now, dur: 1.8 });
  },
  banner(t, { sub = '', color = '#ffca28', ms = 3500, big = false } = {}) {
    banners.push({ t, sub, color, big, born: now, dur: ms / 1000 });
    if (banners.length > 3) banners.shift();
  },
};

// ---------------- Hành động mặc định (dùng thư viện fx) ----------------
const giftLabel = (a) => {
  const g = a.data?.gift;
  return g ? `${g.count > 1 ? `${g.count}× ` : ''}${g.name}` : '';
};
// Biểu tượng đồ/quà: scene đặt qua luật (params.emoji), mặc định là hộp quà
const itemOf = (a) => a.data?.params?.emoji || '🎁';
const labelOf = (a) => a.data?.params?.label || giftLabel(a);
const srcOf = (c) => (typeof scene.source === 'function' ? scene.source(w, c) : scene.source);
const floorY = () => scene?.stageFloorY ?? 1500;
const tierRgb = (a) => rgb(a.user?.tier?.color);

const defaults = {
  enter(w, a) {
    const c = w.charFor(a.user, 2500);
    if (!c) return;
    if (a.user.isNew) w.emote(c, '🆕', 2500);
    if (a.user.tier.rank >= 2) {
      w.charFor(a.user, 4000);
      w.fx.halo(() => ({ x: c.x, y: c.y }), { color: tierRgb(a) });
      w.banner(`${a.user.tier.name} ${a.user.name} đã đến`, { color: a.user.tier.color, ms: 2600 });
    }
  },
  cheer(w, a) {
    const c = w.charFor(a.user, 1800);
    if (!c) return;
    w.hearts(c.x, headTop(c), { n: 3 });
  },
  follow(w, a) {
    const c = w.charFor(a.user, 3000);
    if (!c) return;
    w.fx.sparkBurst(c.x, headTop(c), { n: 30, color: [255, 230, 140] });
    w.float(c.x, headTop(c) - 70, '+ Theo dõi', '#ffe082');
  },
  share(w, a) {
    const c = w.charFor(a.user, 3000);
    if (!c) return;
    w.float(c.x, headTop(c) - 70, 'Đã chia sẻ', '#80deea');
  },
  chat(w, a) {
    const c = w.charFor(a.user, 4500);
    if (!c) return;
    w.say(c, a.data.text);
  },
  crowd(w, a) {
    w.banner(`+${a.data.count} người vừa vào`, { color: '#b0bec5', ms: 2000 });
  },
  request_song(w, a) {
    const c = w.charFor(a.user, 5000);
    if (!c) return;
    w.fx.wash({ color: [170, 80, 255], ms: 2500 });
    w.banner(`🎵 ${a.user.name} chọn bài`, { sub: a.data.text, color: '#ce93d8', ms: 4500 });
  },
  gift_small(w, a) {
    const c = w.charFor(a.user, 4000);
    if (!c) return;
    w.fly(itemOf(a), srcOf(c), w.chest(c), {
      size: 54,
      onArrive: () => {
        w.fx.sparkBurst(c.x, w.chest(c).y, { n: 26 });
        w.hold(c, itemOf(a), 3000);
      },
    });
    w.float(c.x, headTop(c) - 80, labelOf(a), '#fff59d');
  },
  gift_medium(w, a) {
    const c = w.charFor(a.user, 6000);
    if (!c) return;
    w.fx.beam(() => ({ x: c.x, y: c.y }), { ms: 5000, color: tierRgb(a) });
    w.pose(c, 'dance', 5000);
    w.fly(itemOf(a), srcOf(c), w.chest(c), {
      size: 70,
      onArrive: () => {
        w.fx.sparkBurst(c.x, w.chest(c).y, { n: 50 });
        w.hold(c, itemOf(a), 4000);
      },
    });
    w.banner(a.say || `${a.user.name} tặng ${giftLabel(a)}`, { color: a.user.tier.color, ms: 3000 });
  },
  gift_big(w, a) {
    const c = w.charFor(a.user, 8000);
    if (!c) return;
    w.fx.flash({ alpha: 0.35 });
    w.fx.beam(() => ({ x: c.x, y: c.y }), { ms: 6500, color: [255, 215, 120], width: 150 });
    w.fx.sparkFountain(110, floorY(), { ms: 4000 });
    w.fx.sparkFountain(W - 110, floorY(), { ms: 4000 });
    w.pose(c, 'cheer', 5000);
    w.fly(itemOf(a), srcOf(c), w.chest(c), { size: 96, arc: 260, ms: 1200, onArrive: () => w.hold(c, itemOf(a), 6000) });
    w.banner(a.say || `${a.user.name} tặng ${giftLabel(a)}`, { sub: giftLabel(a), big: true, color: '#ffca28', ms: 5000 });
    return 5000;
  },
  gift_huge(w, a) {
    const c = w.charFor(a.user, 9500);
    if (!c) return;
    const fy = floorY();
    w.fx.strobe({ ms: 1200 });
    w.fx.flash({ alpha: 0.6, ms: 700 });
    w.fx.laserFan({ ms: 7000, y: 380 });
    [W * 0.2, W * 0.8].forEach((x, i) => setTimeout(() => w.fx.co2Jet(x, fy, { ms: 1400 }), 400 + i * 150));
    setTimeout(() => [W * 0.35, W * 0.65].forEach((x) => w.fx.co2Jet(x, fy, { ms: 1200 })), 3500);
    [90, W * 0.33, W * 0.67, W - 90].forEach((x) => w.fx.sparkFountain(x, fy, { ms: 5500, height: 800 }));
    w.fx.confettiRain({ ms: 6500 });
    w.fx.beam(() => ({ x: c.x, y: c.y }), { ms: 8000, color: [255, 215, 120], width: 160 });
    for (const o of w.chars) w.pose(o, 'cheer', 6500);
    w.banner(a.say || `Cảm ơn ${a.user.name}!`, { sub: giftLabel(a), big: true, color: '#ff8a65', ms: 7000 });
    return 7500;
  },
  tier_up(w, a) {
    const c = w.charFor(a.user, 5000);
    if (!c) return;
    const col = rgb(a.data.to.color);
    w.fx.halo(() => ({ x: c.x, y: c.y }), { color: col, ms: 3000 });
    w.fx.beam(() => ({ x: c.x, y: c.y }), { ms: 3500, color: col });
    w.banner(`🎖️ ${a.user.name} lên ${a.data.to.name}!`, { color: a.data.to.color, big: true, ms: 3500 });
    return 3500;
  },
  unknown(w, a) {
    const c = a.user && w.charFor(a.user, 3000);
    if (c) w.float(c.x, headTop(c) - 70, a.action);
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

// ---------------- Đám đông ----------------
const isBusy = (c) => Boolean(c.viewer) && now < c.busyUntil;

function populate() {
  chars.clear();
  viewerChar.clear();
  const spots = typeof scene.spots === 'function' ? scene.spots(w) : scene.spots;
  const n = spots ? Math.min(spots.length, scene.maxChars ?? spots.length) : scene.maxChars ?? DEFAULT_CHARS;
  const order = spots ? [...spots].sort(() => Math.random() - 0.5) : null;
  for (let i = 0; i < n; i++) {
    const c = { id: `npc-${i}`, seed: Math.random(), hue: (i * 47 + 20) % 360, viewer: null, busyUntil: 0, nextWander: now + rand(2, 14) };
    const s = order ? order[i] : scene.spot(w, c);
    c.home = { x: s.x, y: s.y };
    c.x = c.tx = s.x;
    c.y = c.ty = s.y;
    chars.set(c.id, c);
  }
}

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
    const sp = 240 * dt;
    c.moving = d > 2;
    if (d <= sp) {
      c.x = c.tx;
      c.y = c.ty;
    } else {
      c.x += (dx / d) * sp;
      c.y += (dy / d) * sp;
    }
    if (c.pose && now >= c.poseUntil) c.pose = null;
    if (c.viewer && now >= c.busyUntil) release(c);
    if (!c.moving && !isBusy(c) && now > c.nextWander && scene.wander) {
      const p = scene.wander(w, c);
      if (p) w.moveTo(c, p.x, p.y);
      c.nextWander = now + rand(8, 18);
    }
  }
}

/** Thân nhân vật mặc định (dạng hoạt hình đơn giản) khi scene không tự vẽ. */
function defaultBody(c, { x, y, s, lit }) {
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.beginPath();
  ctx.ellipse(x, c.y + 4, 38 * s, 11 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `hsl(${c.hue},45%,42%)`;
  ctx.beginPath();
  ctx.roundRect(x - 30 * s, y - 70 * s, 60 * s, 70 * s, [26 * s, 26 * s, 12 * s, 12 * s]);
  ctx.fill();
  ctx.fillStyle = `hsl(${c.hue},55%,70%)`;
  ctx.beginPath();
  ctx.arc(x, y - 100 * s, 34 * s, 0, Math.PI * 2);
  ctx.fill();
  if (lit) {
    ctx.strokeStyle = lit;
    ctx.lineWidth = 4;
    ctx.stroke();
  }
}

function drawChar(c) {
  const v = isBusy(c) ? c.viewer : null;
  const s = scaleOf(c);
  const dance = c.pose === 'dance' ? Math.sin(now * 9 + c.seed * 6) : 0;
  const bob = c.moving ? Math.abs(Math.sin(now * 10)) * 6 * s : Math.abs(dance) * 10 * s + Math.sin(now * 1.6 + c.seed * 9) * 1.5 * s;
  const x = c.x + dance * 6 * s;
  const y = c.y - bob;
  const lit = v ? v.tier?.color || '#ffffff' : null;
  (scene.drawBody ? (o) => scene.drawBody(ctx, w, c, o) : (o) => defaultBody(c, o))({ x, y, s, lit });

  const top = headTop(c) - bob;
  if (c.item && now < c.item.until) emoji(c.item.e, x + 34 * s, y - (scene?.charHeight ?? 136) * s * 0.5, 40 * s);

  if (!v) return;
  // Thẻ người xem trên đầu: ảnh đại diện + tên
  const ts = clamp(s, 0.8, 1.15);
  ctx.font = `700 ${Math.round(22 * ts)}px ${FONT}`;
  const name = v.name || '';
  const nw = Math.min(ctx.measureText(name).width, 200 * ts);
  const ar = 19 * ts;
  const tw = nw + ar * 2 + 26 * ts;
  const th = ar * 2 + 8 * ts;
  const tx = clamp(x - tw / 2, 8, W - tw - 8);
  const ty = top - th - 14 * ts;
  const rank = v.tier?.rank || 0;
  pill(tx, ty, tw, th, 'rgba(10,8,18,.78)');
  ctx.strokeStyle = lit;
  ctx.lineWidth = rank >= 1 ? 2.5 : 1.2;
  ctx.beginPath();
  ctx.roundRect(tx, ty, tw, th, th / 2);
  ctx.stroke();
  const ax = tx + 4 * ts + ar;
  const ay = ty + th / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(ax, ay, ar, 0, Math.PI * 2);
  ctx.clip();
  const im = img(v.avatar);
  if (im) ctx.drawImage(im, ax - ar, ay - ar, ar * 2, ar * 2);
  else {
    ctx.fillStyle = `hsl(${c.hue},45%,55%)`;
    ctx.fillRect(ax - ar, ay - ar, ar * 2, ar * 2);
    text(name.trim().charAt(0).toUpperCase() || '?', ax, ay + 1, { size: 20 * ts, stroke: null });
  }
  ctx.restore();
  text(name, ax + ar + 8 * ts, ay + 1, { size: 22 * ts, align: 'left', color: rank >= 1 ? lit : '#fff', stroke: null, maxWidth: 200 * ts });
  if (rank >= 3) emoji('👑', ax, ty - 6 * ts, 26 * ts);
  if (c.emote && now < c.emote.until) emoji(c.emote.e, tx + tw + 4, ay, 30 * ts);

  // Bong bóng chat
  if (c.bubble && now < c.bubble.until) {
    const lines = wrap(c.bubble.text, 320, 25);
    let bw = 0;
    ctx.font = `600 25px ${FONT}`;
    for (const l of lines) bw = Math.max(bw, ctx.measureText(l).width);
    bw += 30;
    const bh = lines.length * 31 + 18;
    const bx = clamp(x - bw / 2, 10, W - bw - 10);
    const by = ty - bh - 12;
    pill(bx, by, bw, bh, 'rgba(255,255,255,.94)', 16);
    ctx.fillStyle = 'rgba(255,255,255,.94)';
    ctx.beginPath();
    ctx.moveTo(x - 9, by + bh);
    ctx.lineTo(x + 9, by + bh);
    ctx.lineTo(x, by + bh + 11);
    ctx.fill();
    lines.forEach((l, i) => text(l, bx + bw / 2, by + 24 + i * 31, { size: 25, color: '#1a1a1a', weight: 600, stroke: null }));
  }
}

// ---------------- Hạt đơn giản, đồ bay, chữ nổi ----------------
function updateDraw(dt) {
  bits = bits.filter((p) => (p.life += dt) < p.max);
  for (const p of bits) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    ctx.globalAlpha = 1 - p.life / p.max;
    emoji(p.e, p.x, p.y, p.size);
  }
  ctx.globalAlpha = 1;

  flyers = flyers.filter((f) => {
    const p = (now - f.born) / f.dur;
    if (p >= 1) {
      f.onArrive?.();
      return false;
    }
    const e = ease(p);
    emoji(f.e, f.x0 + (f.to.x - f.x0) * e, f.y0 + (f.to.y - f.y0) * e - Math.sin(Math.PI * p) * f.arc, f.size);
    return true;
  });

  floaters = floaters.filter((f) => {
    const p = (now - f.born) / f.dur;
    if (p >= 1) return false;
    ctx.globalAlpha = 1 - p * p;
    text(f.t, f.x, f.y - p * 80, { size: f.size, color: f.color });
    ctx.globalAlpha = 1;
    return true;
  });
}

function drawBanners() {
  banners = banners.filter((b) => now - b.born < b.dur);
  let y = 600;
  for (const b of banners) {
    const age = now - b.born;
    const a = clamp(Math.min(age / 0.25, (b.dur - age) / 0.4, 1), 0, 1);
    const pop = b.big ? 1 + 0.1 * Math.max(0, 1 - age / 0.3) : 1;
    const h = b.big ? 150 : 88;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(W / 2, y + h / 2);
    ctx.scale(pop, pop);
    const g = ctx.createLinearGradient(-540, 0, 540, 0);
    g.addColorStop(0, 'rgba(8,6,14,0)');
    g.addColorStop(0.18, 'rgba(8,6,14,.82)');
    g.addColorStop(0.82, 'rgba(8,6,14,.82)');
    g.addColorStop(1, 'rgba(8,6,14,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-540, -h / 2, 1080, h);
    const line = ctx.createLinearGradient(-420, 0, 420, 0);
    line.addColorStop(0, 'rgba(255,255,255,0)');
    line.addColorStop(0.5, b.color);
    line.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = line;
    ctx.fillRect(-420, -h / 2, 840, 3);
    ctx.fillRect(-420, h / 2 - 3, 840, 3);
    ctx.shadowColor = b.color;
    ctx.shadowBlur = b.big ? 24 : 12;
    text(b.t, 0, b.sub ? -h * 0.17 : 0, { size: b.big ? 50 : 36, color: b.color, maxWidth: 960, stroke: null });
    ctx.shadowBlur = 0;
    if (b.sub) text(b.sub, 0, h * 0.24, { size: b.big ? 32 : 26, color: '#fff', weight: 600, maxWidth: 940, stroke: null });
    ctx.restore();
    y += h + 14;
  }
}

// ---------------- HUD tối giản ----------------
function drawHud() {
  const g = ctx.createLinearGradient(0, 0, 0, 200);
  g.addColorStop(0, 'rgba(0,0,0,.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, 200);
  const loc = state.location;
  text(state.worldName || '', 40, 62, { size: 32, color: '#ffe082', align: 'left' });
  text(loc ? `${loc.emoji} ${loc.name}` : '🌙 Đang nghỉ', 40, 110, { size: 48, align: 'left' });
  if (!connected) {
    ctx.fillStyle = '#e53935';
    ctx.beginPath();
    ctx.arc(W - 30, 60, 10, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawClosed() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0d1b2a');
  g.addColorStop(1, '#1b263b');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  text('Đang nghỉ', W / 2, H / 2 - 60, { size: 80, color: '#ffe082' });
  if (state.next) text(`Mở lại lúc ${state.next.start} · ${state.next.emoji} ${state.next.name}`, W / 2, H / 2 + 40, { size: 40 });
}

// ---------------- Nền video/ảnh thật ----------------
function loadMedia(id, m) {
  if (!m) return null;
  const url = (p) => `/locations/${id}/${p}`;
  if (m.video) {
    const v = document.createElement('video');
    Object.assign(v, { muted: true, loop: true, playsInline: true, autoplay: true, preload: 'auto' });
    v.setAttribute('playsinline', '');
    v.src = url(m.video);
    v.addEventListener('error', () => {
      // không có video thì thử ảnh, không có nữa thì scene tự vẽ nền
      if (m.image && media?.el === v) media = { el: imageEl(url(m.image)), kind: 'image' };
    });
    v.play().catch(() => {});
    return { el: v, kind: 'video' };
  }
  if (m.image) return { el: imageEl(url(m.image)), kind: 'image' };
  return null;
}
function imageEl(src) {
  const im = new Image();
  im.src = src;
  return im;
}
function mediaReady() {
  const el = media?.el;
  if (!el) return false;
  return media.kind === 'video' ? el.readyState >= 2 && !el.error : el.complete && el.naturalWidth > 0;
}
function drawMedia() {
  if (!mediaReady()) return;
  const el = media.el;
  if (media.kind === 'video' && el.paused) el.play().catch(() => {});
  const sw = media.kind === 'video' ? el.videoWidth : el.naturalWidth;
  const sh = media.kind === 'video' ? el.videoHeight : el.naturalHeight;
  const k = Math.max(W / sw, H / sh); // phủ kín khung, cắt phần thừa
  const dw = sw * k;
  const dh = sh * k;
  ctx.drawImage(el, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

// ---------------- Chuyển cảnh ----------------
async function applyState(s) {
  const prev = state.location?.id || null;
  state = { ...state, ...s };
  const nextId = state.location?.id || null;
  if (nextId === sceneId && (scene || !nextId)) return;
  const title = state.location ? `${state.location.emoji} ${state.location.name}` : '🌙 Đóng cửa';
  const mod = nextId
    ? await import(`/locations/${nextId}/scene.js?v=${Date.now()}`).catch((err) => {
        console.error('Không tải được scene', nextId, err);
        return null;
      })
    : null;
  const swap = () => {
    if (media?.kind === 'video') media.el.pause();
    scene = mod?.default || null;
    sceneId = nextId;
    media = scene ? loadMedia(nextId, state.location?.media) : null;
    chars.clear();
    viewerChar.clear();
    if (scene) populate();
    bits = [];
    flyers = [];
    fx.clear();
    stageBusyUntil = 0;
  };
  if (prev === null && sceneId === null && !scene) {
    swap();
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
    drawMedia();
    scene.background(ctx, w);
    fx.draw('under');
    updateChars(dt);
    const list = [...chars.values()].sort((a, b) => a.y - b.y);
    for (const c of list) drawChar(c);
    scene.foreground?.(ctx, w);
  } else drawClosed();

  fx.update(dt);
  fx.draw('over');
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
window.world = { w, handle, get state() { return state; }, get media() { return media; } };
