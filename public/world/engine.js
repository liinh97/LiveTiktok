// ENGINE của thế giới chung: nền, đám đông, camera, hiệu ứng, menu lệnh quà, chuyển cảnh, hàng chờ quà lớn.
//
// NHÂN VẬT: mỗi người xem có MỘT nhân vật chibi riêng (mặt là ảnh đại diện nếu có), vào phòng là xuất hiện,
// ở lại cho tới khi lâu không tương tác. Ngoại hình (kiểu nhân vật, to/nhỏ, cánh) do máy chủ giữ trong user.look.
// Quán đầy (maxChars) thì người lâu không tương tác nhất ra về nhường chỗ.
//
// Hợp đồng của một scene (locations/<id>/scene.js):
//   export default {
//     background(ctx, w)          vẽ nền mỗi khung hình (bắt buộc). w.hasMedia = true nếu đã có video/ảnh nền thật
//                                 (thả locations/<id>/assets/background.mp4|webm|jpg|png|webp là tự dùng)
//     foreground?(ctx, w)         vẽ đè lên nhân vật
//     spots: [{x,y}] | (w)=>[]    các chỗ đứng (nên nhiều hơn maxChars)
//     entrance: {x, y}            cửa vào
//     walkPath?: [{x,y}]          đường đi vòng quanh quán (lệnh "Đi vòng")
//     source: {x,y} | (w,c)=>{x,y} nơi đồ/quà bay ra (quầy bar, bếp...)
//     scaleAt?(y) -> number       to/nhỏ theo độ xa gần (mặc định 1)
//     update?(w, dt)              gọi mỗi khung hình
//     stageFloorY?: number        độ cao sàn để đặt pháo sáng / khói (mặc định 1500)
//     actions?: { tên(w, a, d) }  diễn hành động theo kiểu riêng; d = bộ hành động mặc định
//     maxChars?: number           số nhân vật tối đa (mặc định 250; ghi đè bằng ?max= trên URL)
//   }

import { drawArms, drawWings, FOOT_Y, HEAD_R, HEAD_Y, partsOf, renderChibi, renderTag, SPRITE_H, SPRITE_W } from './chibi.js';
import { createFx } from './fx.js';

const W = 1080;
const H = 1920;
const FONT = '"Segoe UI", "Noto Sans", "Helvetica Neue", Arial, sans-serif';
const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
const params = new URLSearchParams(location.search);
const TTS = params.get('tts') === '1';
const MAX_OVERRIDE = Number(params.get('max')) || null;
const DEFAULT_MAX = 250;
const IDLE_LEAVE_SEC = 15 * 60;
const SHOW_ALL_TAGS_UNDER = 60; // ít người thì hiện tên tất cả
const BEAT_HZ = 2; // nhịp nhạc ~120 BPM

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

// ---------------- Trạng thái ----------------
let state = { worldName: '', location: null, next: null, schedule: [], leaderboard: [], crowd: [], paused: false };
let scene = null;
let sceneId = null;
let media = null; // { el, kind }
let connected = false;
const chars = new Map(); // id người xem -> nhân vật
let spots = [];
let freeSpots = new Set();
let bits = [];
let floaters = [];
let flyers = [];
let banners = [];
const stageQueue = [];
let stageBusyUntil = 0;
let transition = null;
let now = 0; // giây
const cam = { x: W / 2, y: H / 2, z: 1, target: null, until: 0, queue: [] };

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
function rgb(hex, fallback = [255, 220, 150]) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------- Toạ độ nhân vật ----------------
const sceneScale = (y) => scene?.scaleAt?.(y) ?? 1;
const scaleOf = (c) => sceneScale(c.y) * (c.sm ?? 1);
const headTop = (c) => c.y - (FOOT_Y - (HEAD_Y - HEAD_R)) * scaleOf(c) - (c.jumpY || 0);
const chest = (c) => ({ x: c.x, y: c.y - 55 * scaleOf(c) - (c.jumpY || 0) });

// ---------------- API cho scene ----------------
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
    return [...chars.values()].filter((c) => !c.leaving);
  },
  get state() {
    return state;
  },
  get hasMedia() {
    return mediaReady();
  },
  scaleOf,
  headTop,
  chest,
  sourceOf: (c) => srcOf(c),

  /** Nhân vật của người xem (chưa có thì cho bước vào từ cửa). ms: thời gian hiện thẻ tên nổi bật. */
  charFor(user, ms = 5000) {
    let c = chars.get(user.id);
    if (!c || c.leaving) c = spawn(user, true);
    else applyUser(c, user);
    c.lastActive = now;
    c.busyUntil = Math.max(c.busyUntil, now + ms / 1000);
    return c;
  },
  moveTo(c, x, y) {
    c.tx = x;
    c.ty = y;
  },
  goHome(c) {
    c.path = null;
    c.tx = c.home.x;
    c.ty = c.home.y;
  },
  /** Tư thế tạm thời: 'cheer' (giơ tay), 'dance' (nhảy), 'wave' (vẫy). */
  pose(c, name, ms = 3000) {
    c.pose = name;
    c.poseUntil = now + ms / 1000;
  },
  /** Điệu nhảy cho nhân vật trong ms mili giây (vd. cả quán cùng nhảy tưng tưng). */
  dance(c, move, ms = 4000) {
    c.dance = { move, start: now, until: now + ms / 1000 };
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
  fly(e, from, to, { ms = 900, size = 64, arc = 160, onArrive } = {}) {
    flyers.push({ e, x0: from.x, y0: from.y, to, born: now, dur: ms / 1000, size, arc, onArrive });
  },
  hearts(x, y, { n = 5, e = null } = {}) {
    for (let i = 0; i < n; i++) {
      bits.push({ x, y, vx: rand(-60, 60), vy: rand(-260, -160), life: 0, max: rand(1, 1.6), e: e || ['❤️', '💖', '💕'][i % 3], size: rand(22, 32) });
    }
  },
  float(x, y, t, color = '#fff', size = 30) {
    floaters.push({ x, y, t, color, size, born: now, dur: 1.8 });
  },
  banner(t, { sub = '', color = '#ffca28', ms = 3500, big = false } = {}) {
    banners.push({ t, sub, color, big, born: now, dur: ms / 1000 });
    if (banners.length > 3) banners.shift();
  },
  /** Camera zoom vào nhân vật trong ms mili giây (xếp hàng nếu đang zoom người khác). */
  camera(c, ms = 4500) {
    cam.queue.push({ c, ms });
  },
};

// ---------------- Điệu nhảy của đám đông (tự đổi sau vài giây, khớp nhịp nhạc) ----------------
const DANCES = [
  ['bounce', 8],
  ['pump', 14],
  ['clap', 10],
  ['point', 12],
  ['roof', 9],
  ['wave2', 12],
  ['swing', 12],
  ['shuffle', 11],
  ['hop', 8],
];
const DANCE_SUM = DANCES.reduce((a, d) => a + d[1], 0);
function pickDance() {
  let r = Math.random() * DANCE_SUM;
  for (const d of DANCES) if ((r -= d[1]) <= 0) return d[0];
  return 'bounce';
}

/** Độ lệch thân + kiểu tay cho một nhân vật ở thời điểm hiện tại. */
function danceOf(c) {
  const beat = now * BEAT_HZ + (c.beatOff || 0);
  const b = Math.pow(Math.abs(Math.sin(Math.PI * beat)), 2);
  const m = { dx: 0, dy: 0, rot: 0, sx: 1, arms: null, beat };
  if (c.moving) {
    m.dy = Math.abs(Math.sin(now * 12 + c.seed * 9)) * 7;
    m.arms = c.path ? 'dance' : null;
    return m;
  }
  if (c.pose) {
    m.dy = b * 6;
    m.arms = c.pose;
    return m;
  }
  const move = c.dance?.move || 'bounce';
  m.arms = move;
  switch (move) {
    case 'pump':
      m.dy = b * 8;
      break;
    case 'clap':
      m.dy = b * 4;
      break;
    case 'point':
      m.rot = (Math.floor(beat) % 2 ? 1 : -1) * 0.07;
      m.dy = b * 4;
      break;
    case 'roof':
      m.dy = b * 7;
      break;
    case 'wave2':
      m.rot = Math.sin((Math.PI * beat) / 2) * 0.09;
      m.dy = b * 3;
      break;
    case 'swing':
      m.rot = Math.sin((Math.PI * beat) / 2) * 0.13;
      m.dy = b * 3;
      break;
    case 'shuffle':
      m.dx = Math.sin(Math.PI * beat) * 12;
      m.dy = b * 4;
      m.arms = 'swing';
      break;
    case 'hop':
      m.dy = b * 18;
      m.arms = 'pump';
      break;
    case 'spin': {
      const p = clamp((now - c.dance.start) / (c.dance.until - c.dance.start), 0, 1);
      m.sx = Math.cos(p * Math.PI * 2);
      m.dy = Math.sin(p * Math.PI) * 10;
      m.arms = 'cheer';
      break;
    }
    default:
      m.dy = b * 6;
      m.arms = null;
  }
  return m;
}

// ---------------- Đám đông ----------------
function maxChars() {
  return MAX_OVERRIDE || scene?.maxChars || DEFAULT_MAX;
}

function applyUser(c, user) {
  c.viewer = { id: user.id, name: user.name, avatar: user.avatar, tier: user.tier || { rank: 0 } };
  const look = user.look || c.look || { style: 0, scale: 1, wings: false };
  if (!c.look || c.look.style !== look.style) c.sprite = null;
  c.look = look;
  c.parts = partsOf(look.style);
}

function takeSpot() {
  if (!freeSpots.size) {
    const s = spots[Math.floor(Math.random() * spots.length)] || { x: W / 2, y: H * 0.7 };
    return { i: -1, x: s.x + rand(-20, 20), y: s.y + rand(-8, 8) };
  }
  const list = [...freeSpots];
  const i = list[Math.floor(Math.random() * list.length)];
  freeSpots.delete(i);
  return { i, ...spots[i] };
}

function spawn(user, walkIn) {
  const old = chars.get(user.id);
  if (old) {
    chars.delete(user.id);
    if (old.spotIndex >= 0) freeSpots.add(old.spotIndex);
  }
  if (chars.size >= maxChars()) evict();
  const s = takeSpot();
  const e = scene?.entrance || { x: W / 2, y: H + 60 };
  const c = {
    id: user.id,
    seed: Math.random(),
    spotIndex: s.i,
    home: { x: s.x, y: s.y },
    x: walkIn ? e.x + rand(-30, 30) : s.x,
    y: walkIn ? e.y : s.y,
    tx: s.x,
    ty: s.y,
    sm: 1,
    beatOff: (Math.random() - 0.5) * 0.15, // lệch nhịp chút xíu cho tự nhiên
    busyUntil: 0,
    lastActive: now,
  };
  applyUser(c, user);
  c.sm = c.look.scale || 1;
  chars.set(user.id, c);
  return c;
}

/** Quán đầy: mời người lâu không tương tác nhất (không đang diễn) ra về. */
function evict() {
  let victim = null;
  for (const c of chars.values()) {
    if (c.leaving || now < c.busyUntil) continue;
    if (!victim || c.lastActive < victim.lastActive) victim = c;
  }
  if (victim) leave(victim);
  // vẫn quá đông (toàn người đang diễn) thì xoá thẳng người cũ nhất
  if (chars.size >= maxChars() + 20) {
    const oldest = [...chars.values()].sort((a, b) => a.lastActive - b.lastActive)[0];
    removeChar(oldest);
  }
}
function leave(c) {
  c.leaving = now;
}
function removeChar(c) {
  if (!c) return;
  chars.delete(c.id);
  if (c.spotIndex >= 0) freeSpots.add(c.spotIndex);
}

function updateChars(dt) {
  for (const c of [...chars.values()]) {
    if (c.leaving && now - c.leaving > 0.6) {
      removeChar(c);
      continue;
    }
    if (!c.leaving && now - c.lastActive > IDLE_LEAVE_SEC) leave(c);
    // đi theo đường (lệnh "Đi vòng") rồi về chỗ
    if (c.path?.length && Math.hypot(c.tx - c.x, c.ty - c.y) < 4) {
      const p = c.path.shift();
      c.tx = p.x;
      c.ty = p.y;
      if (!c.path.length) c.path = null;
    }
    const dx = c.tx - c.x;
    const dy = c.ty - c.y;
    const d = Math.hypot(dx, dy);
    const sp = (c.path ? 330 : 240) * dt;
    c.moving = d > 2;
    if (d <= sp) {
      c.x = c.tx;
      c.y = c.ty;
    } else {
      c.x += (dx / d) * sp;
      c.y += (dy / d) * sp;
    }
    // to/nhỏ mượt theo ngoại hình
    const target = c.look?.scale || 1;
    c.sm += (target - c.sm) * Math.min(1, dt * 5);
    if (c.pose && now >= c.poseUntil) c.pose = null;
    // tự đổi điệu nhảy sau vài giây (thỉnh thoảng xoay một vòng)
    if (!c.dance || now > c.dance.until) {
      const spin = Math.random() < 0.05;
      c.dance = { move: spin ? 'spin' : pickDance(), start: now, until: now + (spin ? 1 : rand(4, 8)) };
    }
    // nhảy 1 cái
    c.jumpY = 0;
    c.spin = 0;
    if (c.jump) {
      const p = (now - c.jump) / 1.1;
      if (p >= 1) c.jump = 0;
      else {
        c.jumpY = Math.sin(Math.PI * p) * 150 * sceneScale(c.y);
        c.spin = p > 0.12 && p < 0.88 ? ((p - 0.12) / 0.76) * Math.PI * 2 : 0;
      }
    }
  }
}

function spriteOf(c) {
  const av = c.viewer?.avatar ? img(c.viewer.avatar) : null;
  const res = (c.look?.scale || 1) > 1.3 ? 2 : 1.25;
  const key = `${c.look.style}|${av ? 1 : 0}|${res}`;
  if (!c.sprite || c.spriteKey !== key) {
    c.sprite = renderChibi(c.parts, av, res);
    c.spriteKey = key;
  }
  return c.sprite;
}

function tagOf(c) {
  const v = c.viewer;
  const key = `${v.name}|${v.tier?.color}|${v.tier?.rank}|${c.look?.wings ? 1 : 0}`;
  if (!c.tag || c.tagKey !== key) {
    c.tag = renderTag(v.name, v.tier?.color || '#fff', v.tier?.rank || 0, Boolean(c.look?.wings), FONT);
    c.tagKey = key;
  }
  return c.tag;
}

function drawChar(c) {
  const s0 = sceneScale(c.y);
  const s = s0 * c.sm;
  const busy = now < c.busyUntil;
  const alpha = c.leaving ? clamp(1 - (now - c.leaving) / 0.6, 0, 1) : 1;
  const m = danceOf(c);
  const x = c.x + m.dx * s0;
  const y = c.y - m.dy * s0 - c.jumpY;
  ctx.globalAlpha = alpha;

  if (c.look?.wings) drawWings(ctx, x, y, s, now);
  if (busy && c.viewer?.tier?.rank >= 1) {
    // quầng sáng theo màu cấp VIP khi đang tương tác
    const col = rgb(c.viewer.tier.color);
    const g = ctx.createRadialGradient(x, y - 60 * s, 0, x, y - 60 * s, 90 * s);
    g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},0.45)`);
    g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - 90 * s, y - 150 * s, 180 * s, 180 * s);
  }

  const sp = spriteOf(c);
  const dw = SPRITE_W * s;
  const dh = SPRITE_H * s;
  ctx.save();
  if (c.spin) {
    // lộn một vòng (lệnh "Nhảy 1 cái")
    ctx.translate(x, y - dh / 2);
    ctx.rotate(c.spin);
    ctx.drawImage(sp, -dw / 2, -dh / 2, dw, dh);
  } else {
    ctx.translate(x, y);
    ctx.rotate(m.rot);
    ctx.scale(m.sx, 1);
    const squash = c.moving ? 0 : (m.dy / 18) * 0.05;
    ctx.drawImage(sp, (-dw * (1 + squash)) / 2, -dh * (1 - squash) - 2 * s, dw * (1 + squash), dh * (1 - squash));
    drawArms(ctx, 0, 0, s, c.parts, m.arms, now, c.seed, m.beat);
  }
  ctx.restore();
  if (c.item && now < c.item.until) emoji(c.item.e, x + 26 * s, y - 62 * s, 30 * s);
  ctx.globalAlpha = 1;
}

/** Thẻ tên, biểu cảm, bong bóng chat (vẽ sau cả đám đông để không bị người khác che). */
function drawOverlay(c, showTag) {
  if (c.leaving) return;
  const s = scaleOf(c);
  const top = headTop(c);
  let y = top - 6;
  if (showTag) {
    const tag = tagOf(c);
    const ts = clamp(sceneScale(c.y), 0.5, 1) * (now < c.busyUntil ? 1.05 : 0.8);
    const tw = tag.width * ts;
    const th = tag.height * ts;
    ctx.drawImage(tag, clamp(c.x - tw / 2, 4, W - tw - 4), y - th, tw, th);
    y -= th + 4;
  }
  if (c.emote && now < c.emote.until) emoji(c.emote.e, c.x + 30 * s, top + 10 * s, 28 * clamp(s, 0.6, 1.4));
  if (c.bubble && now < c.bubble.until) {
    const lines = wrap(c.bubble.text, 300, 24);
    let bw = 0;
    ctx.font = `600 24px ${FONT}`;
    for (const l of lines) bw = Math.max(bw, ctx.measureText(l).width);
    bw += 28;
    const bh = lines.length * 30 + 16;
    const bx = clamp(c.x - bw / 2, 8, W - bw - 8);
    const by = y - bh - 10;
    pill(bx, by, bw, bh, 'rgba(255,255,255,.95)', 15);
    ctx.fillStyle = 'rgba(255,255,255,.95)';
    ctx.beginPath();
    ctx.moveTo(c.x - 8, by + bh);
    ctx.lineTo(c.x + 8, by + bh);
    ctx.lineTo(c.x, by + bh + 10);
    ctx.fill();
    lines.forEach((l, i) => text(l, bx + bw / 2, by + 23 + i * 30, { size: 24, color: '#1a1a1a', weight: 600, stroke: null }));
  }
}

// ---------------- Hành động mặc định ----------------
const giftLabel = (a) => {
  const g = a.data?.gift;
  return g ? `${g.count > 1 ? `${g.count}× ` : ''}${g.name}` : '';
};
const itemOf = (a) => a.data?.params?.emoji || '🎁';
const labelOf = (a) => a.data?.params?.label || giftLabel(a);
const cmdLabel = (a) => (a.data?.cmd ? `${a.data.cmd.icon} ${a.data.cmd.label}` : giftLabel(a));
const srcOf = (c) => (typeof scene.source === 'function' ? scene.source(w, c) : scene.source);
const floorY = () => scene?.stageFloorY ?? 1500;
const tierRgb = (a) => rgb(a.user?.tier?.color);
const at = (c) => () => ({ x: c.x, y: c.y });

const defaults = {
  enter(w, a) {
    const c = w.charFor(a.user, 3000);
    if (a.user.isNew) w.emote(c, '🆕', 3000);
    else w.pose(c, 'wave', 1500);
    if (a.user.tier.rank >= 2) {
      w.charFor(a.user, 5000);
      w.fx.halo(at(c), { color: tierRgb(a) });
      w.banner(`${a.user.tier.name} ${a.user.name} đã đến`, { color: a.user.tier.color, ms: 2600 });
    }
  },
  cheer(w, a) {
    const c = w.charFor(a.user, 1500);
    w.hearts(c.x, headTop(c), { n: 3 });
  },
  follow(w, a) {
    const c = w.charFor(a.user, 3000);
    w.fx.sparkBurst(c.x, headTop(c), { n: 30, color: [255, 230, 140] });
    w.float(c.x, headTop(c) - 50, '+ Theo dõi', '#ffe082');
  },
  share(w, a) {
    const c = w.charFor(a.user, 3000);
    w.float(c.x, headTop(c) - 50, 'Đã chia sẻ', '#80deea');
  },
  chat(w, a) {
    const c = w.charFor(a.user, 4500);
    w.say(c, a.data.text);
  },
  crowd(w, a) {
    w.banner(`+${a.data.count} người vừa vào`, { color: '#b0bec5', ms: 2000 });
  },
  request_song(w, a) {
    w.charFor(a.user, 5000);
    w.fx.wash({ color: [170, 80, 255], ms: 2500 });
    w.banner(`🎵 ${a.user.name} chọn bài`, { sub: a.data.text, color: '#ce93d8', ms: 4500 });
  },

  // ---- Lệnh theo loại quà ----
  jump(w, a) {
    const c = w.charFor(a.user, 3500);
    c.jump = now;
    setTimeout(() => w.fx.sparkBurst(c.x, c.y, { n: 18, color: [255, 240, 200], speed: 260 }), 1050);
    w.float(c.x, headTop(c) - 40, cmdLabel(a), '#fff59d');
  },
  walk_around(w, a) {
    const c = w.charFor(a.user, 12000);
    const path = scene.walkPath || defaultWalkPath();
    // bắt đầu từ điểm gần nhất, đi hết một vòng rồi về chỗ
    let k = 0;
    path.forEach((p, i) => {
      if (Math.hypot(p.x - c.x, p.y - c.y) < Math.hypot(path[k].x - c.x, path[k].y - c.y)) k = i;
    });
    c.path = [...path.slice(k), ...path.slice(0, k), c.home];
    c.tx = c.x;
    c.ty = c.y;
    w.float(c.x, headTop(c) - 40, cmdLabel(a), '#fff59d');
  },
  grow(w, a) {
    const c = w.charFor(a.user, 4000);
    w.fx.sparkBurst(c.x, chest(c).y, { n: 40, color: [255, 220, 120] });
    w.float(c.x, headTop(c) - 50, '⬆ To lên!', '#ffe082');
  },
  shrink(w, a) {
    const c = w.charFor(a.user, 4000);
    w.fx.sparkBurst(c.x, chest(c).y, { n: 24, color: [160, 220, 255] });
    w.float(c.x, headTop(c) - 40, '⬇ Nhỏ lại!', '#80deea');
  },
  change_char(w, a) {
    const c = w.charFor(a.user, 4000);
    // phụt khói rồi mới đổi hình
    const p = chest(c);
    w.fx.custom(700, (cx, q) => {
      for (let i = 0; i < 7; i++) {
        const ang = (i / 7) * Math.PI * 2;
        const r = 30 + q * 60;
        const g = cx.createRadialGradient(p.x + Math.cos(ang) * r, p.y + Math.sin(ang) * r * 0.7, 0, p.x + Math.cos(ang) * r, p.y + Math.sin(ang) * r * 0.7, 40);
        g.addColorStop(0, `rgba(240,240,255,${0.8 * (1 - q)})`);
        g.addColorStop(1, 'rgba(240,240,255,0)');
        cx.fillStyle = g;
        cx.fillRect(p.x - 140, p.y - 140, 280, 280);
      }
    });
    w.float(c.x, headTop(c) - 40, '✨ Đổi nhân vật', '#e1bee7');
  },
  wings(w, a) {
    const c = w.charFor(a.user, 6000);
    w.fx.halo(at(c), { color: [120, 210, 255], ms: 2500 });
    w.fx.sparkBurst(c.x, chest(c).y, { n: 50, color: [140, 220, 255] });
    w.banner(`🪽 ${a.user.name} nhận huy hiệu + cánh!`, { color: '#81d4fa', ms: 3000 });
  },
  firework(w, a) {
    const c = w.charFor(a.user, 4000);
    w.fx.firework(c.x, headTop(c));
    setTimeout(() => w.fx.firework(c.x, headTop(c), { top: 420 }), 350);
    w.pose(c, 'cheer', 2000);
  },
  camera(w, a) {
    const c = w.charFor(a.user, 6000);
    w.camera(c, 4500);
    w.pose(c, 'wave', 4500);
  },

  // ---- Quà theo bậc xu ----
  gift_small(w, a) {
    const c = w.charFor(a.user, 4000);
    w.fly(itemOf(a), srcOf(c), chest(c), {
      size: 50,
      onArrive: () => {
        w.fx.sparkBurst(c.x, chest(c).y, { n: 26 });
        w.hold(c, itemOf(a), 3000);
      },
    });
    w.float(c.x, headTop(c) - 50, labelOf(a), '#fff59d');
  },
  gift_medium(w, a) {
    const c = w.charFor(a.user, 6000);
    w.fx.beam(at(c), { ms: 5000, color: tierRgb(a) });
    w.pose(c, 'dance', 5000);
    w.fly(itemOf(a), srcOf(c), chest(c), {
      size: 64,
      onArrive: () => {
        w.fx.sparkBurst(c.x, chest(c).y, { n: 50 });
        w.hold(c, itemOf(a), 4000);
      },
    });
    w.banner(a.say || `${a.user.name} tặng ${giftLabel(a)}`, { color: a.user.tier.color, ms: 3000 });
  },
  gift_big(w, a) {
    const c = w.charFor(a.user, 8000);
    w.fx.flash({ alpha: 0.35 });
    w.fx.beam(at(c), { ms: 6500, color: [255, 215, 120], width: 150 });
    w.fx.sparkFountain(110, floorY(), { ms: 4000 });
    w.fx.sparkFountain(W - 110, floorY(), { ms: 4000 });
    w.pose(c, 'cheer', 5000);
    w.camera(c, 3500);
    w.fly(itemOf(a), srcOf(c), chest(c), { size: 90, arc: 260, ms: 1200, onArrive: () => w.hold(c, itemOf(a), 6000) });
    w.banner(a.say || `${a.user.name} tặng ${giftLabel(a)}`, { sub: giftLabel(a), big: true, color: '#ffca28', ms: 5000 });
    return 5000;
  },
  gift_huge(w, a) {
    const c = w.charFor(a.user, 9500);
    const fy = floorY();
    w.fx.strobe({ ms: 1200 });
    w.fx.flash({ alpha: 0.6, ms: 700 });
    w.fx.laserFan({ ms: 7000, y: 380 });
    [W * 0.2, W * 0.8].forEach((x, i) => setTimeout(() => w.fx.co2Jet(x, fy, { ms: 1400 }), 400 + i * 150));
    setTimeout(() => [W * 0.35, W * 0.65].forEach((x) => w.fx.co2Jet(x, fy, { ms: 1200 })), 3500);
    [90, W * 0.33, W * 0.67, W - 90].forEach((x) => w.fx.sparkFountain(x, fy, { ms: 5500, height: 800 }));
    w.fx.confettiRain({ ms: 6500 });
    w.fx.beam(at(c), { ms: 8000, color: [255, 215, 120], width: 160 });
    for (const o of w.chars) w.pose(o, 'cheer', 6500);
    w.camera(c, 3000);
    w.banner(a.say || `Cảm ơn ${a.user.name}!`, { sub: giftLabel(a), big: true, color: '#ff8a65', ms: 7000 });
    return 7500;
  },
  tier_up(w, a) {
    const c = w.charFor(a.user, 5000);
    const col = rgb(a.data.to.color);
    w.fx.halo(at(c), { color: col, ms: 3000 });
    w.fx.beam(at(c), { ms: 3500, color: col });
    w.banner(`🎖️ ${a.user.name} lên ${a.data.to.name}!`, { color: a.data.to.color, big: true, ms: 3500 });
    return 3500;
  },
  unknown(w, a) {
    const c = a.user && w.charFor(a.user, 3000);
    if (c) w.float(c.x, headTop(c) - 40, a.data?.cmd?.label || a.action);
  },
};

function defaultWalkPath() {
  const xs = spots.map((s) => s.x);
  const ys = spots.map((s) => s.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  return [
    { x: x0, y: y1 },
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
  ];
}

// ---------------- Xử lý hành động ----------------
const deferred = []; // sự kiện đến lúc đang chuyển cảnh: diễn lại khi chuyển xong
function handle(a) {
  if (!scene || transition) {
    if ((a.priority || 0) >= 3) stageQueue.push(a);
    else if (deferred.length < 300) deferred.push(a);
    return;
  }
  if (!state.location && a.action.startsWith('gift')) {
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

// ---------------- Camera ----------------
function updateCamera(dt) {
  if ((!cam.target || now > cam.until) && cam.queue.length) {
    const next = cam.queue.shift();
    cam.target = next.c;
    cam.until = now + next.ms / 1000;
  }
  if (cam.target && (now > cam.until || !chars.has(cam.target.id))) cam.target = null;
  const tz = cam.target ? 2.1 : 1;
  const tx = cam.target ? cam.target.x : W / 2;
  // đặt đầu nhân vật hơi dưới giữa khung, chừa chỗ cho banner phía trên
  const ty = cam.target ? headTop(cam.target) - 40 / Math.max(cam.z, 1) : H / 2;
  const k = Math.min(1, dt * 3.5);
  cam.z += (tz - cam.z) * k;
  cam.x += (tx - cam.x) * k;
  cam.y += (ty - cam.y) * k;
  // không để lộ ra ngoài khung
  const hw = W / 2 / cam.z;
  const hh = H / 2 / cam.z;
  cam.x = clamp(cam.x, hw, W - hw);
  cam.y = clamp(cam.y, hh, H - hh);
}
function applyCamera() {
  ctx.translate(W / 2, H / 2);
  ctx.scale(cam.z, cam.z);
  ctx.translate(-cam.x, -cam.y);
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

// ---------------- HUD + menu lệnh quà ----------------
function drawHud() {
  const g = ctx.createLinearGradient(0, 0, 0, 200);
  g.addColorStop(0, 'rgba(0,0,0,.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, 200);
  const loc = state.location;
  text(state.worldName || '', 40, 62, { size: 32, color: '#ffe082', align: 'left' });
  text(loc ? `${loc.emoji} ${loc.name}` : '🌙 Đang nghỉ', 40, 110, { size: 48, align: 'left' });
  if (loc) {
    const n = w.chars.length;
    pill(W - 230, 40, 200, 52, 'rgba(0,0,0,.5)');
    text(`👥 ${n} người`, W - 130, 67, { size: 28, stroke: null });
  }
  if (!connected) {
    ctx.fillStyle = '#e53935';
    ctx.beginPath();
    ctx.arc(W - 30, 120, 10, 0, Math.PI * 2);
    ctx.fill();
  }
  if (cam.target && cam.z > 1.3) {
    const name = cam.target.viewer?.name || '';
    pill(W / 2 - 230, 210, 460, 60, 'rgba(229,57,53,.85)');
    text(`🎥 Camera: ${name}`, W / 2, 241, { size: 30, stroke: null, maxWidth: 430 });
  }
}

function drawMenu() {
  const cmds = state.location?.commands;
  if (!cmds?.length) return;
  const rowH = 50;
  const x = W - 300;
  const y0 = 1150;
  pill(x - 12, y0 - 52, 300, cmds.length * rowH + 66, 'rgba(10,8,20,.55)', 18);
  text('🎁 Tặng quà để:', x + 138, y0 - 24, { size: 26, color: '#ffe082', stroke: null });
  cmds.forEach((c, i) => {
    const y = y0 + 12 + i * rowH;
    emoji(c.icon, x + 22, y + 4, 30);
    text(c.label, x + 50, y + 4, { size: 26, align: 'left', stroke: 'rgba(0,0,0,.6)', maxWidth: 230 });
  });
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
  const k = Math.max(W / sw, H / sh);
  ctx.drawImage(el, (W - sw * k) / 2, (H - sh * k) / 2, sw * k, sh * k);
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
    // giữ đám đông khi đổi địa điểm: mọi người "đi theo" sang chỗ mới
    const people = [...chars.values()].filter((c) => !c.leaving).map((c) => ({ user: { ...c.viewer, look: c.look }, lastActive: c.lastActive }));
    chars.clear();
    spots = scene ? (typeof scene.spots === 'function' ? scene.spots(w) : scene.spots) || [] : [];
    freeSpots = new Set(spots.map((_, i) => i));
    if (scene) {
      const seed = people.length ? people.map((p) => p.user) : state.crowd || [];
      for (const u of seed.slice(0, maxChars())) spawn(u, false);
    }
    bits = [];
    flyers = [];
    fx.clear();
    cam.target = null;
    cam.queue = [];
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
  if (a <= 0 && t > 0.7) {
    transition = null;
    for (const d of deferred.splice(0)) handle(d);
  }
}

// ---------------- Vòng lặp ----------------
let last = performance.now();
function frame(ts) {
  const dt = Math.min(0.05, (ts - last) / 1000);
  last = ts;
  now += dt;
  ctx.clearRect(0, 0, W, H);

  if (scene && state.location) {
    updateChars(dt);
    scene.update?.(w, dt);
    updateCamera(dt);
    ctx.save();
    applyCamera();
    drawMedia();
    scene.background(ctx, w);
    fx.draw('under');
    const list = [...chars.values()].sort((a, b) => a.y - b.y);
    for (const c of list) drawChar(c);
    scene.foreground?.(ctx, w);
    const all = list.length <= SHOW_ALL_TAGS_UNDER;
    for (const c of list) {
      const show = all || now < c.busyUntil || c.viewer?.tier?.rank >= 2 || c.look?.wings || c === cam.target;
      if (show || c.bubble || c.emote) drawOverlay(c, show);
    }
    fx.update(dt);
    fx.draw('over');
    updateDraw(dt);
    ctx.restore();
    drawMenu();
  } else {
    drawClosed();
    fx.update(dt);
    fx.draw('over');
    updateDraw(dt);
  }

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
      const c = chars.get(String(msg.userId));
      if (c) removeChar(c);
    }
  };
}
connect();

// Cho phép thử nhanh trên trình duyệt: window.world
window.world = { w, handle, cam, get state() { return state; }, get media() { return media; } };
