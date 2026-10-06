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
//     setup?(w)                   tạo nhân vật phụ (w.npc) khi vào cảnh
//     update?(w, dt)              gọi mỗi khung hình
//     stageFloorY?: number        độ cao sàn để đặt pháo sáng / khói (mặc định 1500)
//     bannerY?: number            độ cao dòng thông báo đầu tiên (mặc định 600)
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
const DEFAULT_BPM = 120;
const VOLUME = clampNum(Number(params.get('vol') ?? 0.8), 0, 1);
function clampNum(v, a, b) {
  return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : b;
}

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
let beatPos = 0; // số nhịp nhạc đã trôi (theo bpm bài đang phát)
let clockOffset = 0; // giờ máy chủ - giờ máy này (ms)
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
    return [...chars.values()].filter((c) => !c.leaving && !c.npc);
  },
  get state() {
    return state;
  },
  get hasMedia() {
    return mediaReady();
  },
  /** Số nhịp nhạc đã trôi (dùng cho đèn nháy theo nhạc). */
  get beat() {
    return beatPos;
  },
  /** Trạng thái tính năng tương tác (nhạc, đơn, dancer, mục tiêu) từ máy chủ. */
  get features() {
    return state.features || {};
  },
  /**
   * Nhân vật phụ (bartender, DJ, bồi bàn, dancer...) do scene tạo; không tính vào đám đông.
   * opts: { x, y, style, label, labelColor, scale, size (cố định, bỏ qua xa gần), parts: {...ghi đè bộ phận}, costume, clipY }
   */
  npc(id, opts) {
    const key = `npc:${id}`;
    let c = chars.get(key);
    if (!c && opts) {
      c = {
        id: key,
        npc: true,
        seed: Math.random(),
        spotIndex: -1,
        home: { x: opts.x, y: opts.y },
        x: opts.x,
        y: opts.y,
        tx: opts.x,
        ty: opts.y,
        sm: opts.scale || 1,
        size: opts.size || null, // kích thước cố định trên màn hình (không to/nhỏ theo xa gần)
        look: { style: opts.style ?? 0, scale: opts.scale || 1 },
        beatOff: (Math.random() - 0.5) * 0.1,
        busyUntil: 0,
        lastActive: Infinity,
        label: opts.label || null,
        labelColor: opts.labelColor || '#ffe082',
        clipY: opts.clipY ?? null,
        viewer: null,
      };
      c.parts = { ...partsOf(c.look.style), ...(opts.parts || {}), costume: opts.costume || null };
      chars.set(key, c);
    }
    return c || null;
  },
  /** Đi theo một chuỗi điểm (đến nơi gọi onDone). */
  walk(c, points, { speed = 1, onDone } = {}) {
    c.path = [...points];
    c.speedMul = speed;
    c.onArrive = onDone || null;
    c.tx = c.x;
    c.ty = c.y;
  },
  /**
   * Hiệu ứng "bựa" trên nhân vật. Đồ uống: hiccup | fire | zoom | freeze | rocket | sour | hearts | pie.
   * Troll: derp | banana | potato | tpose | worm | chicken | noodle | fart | coffin. opts: { costume, sec }
   */
  drinkEffect(c, effect, opts) {
    applyEffect(c, effect, opts);
  },
  /** Khiêng quan tài: 4 người mặc vest ra khiêng nhân vật đi một vòng quán. */
  coffinDance(c) {
    coffinDance(c);
  },
  removeNpc(c) {
    if (c?.npc) removeChar(c);
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
  const beat = beatPos + (c.beatOff || 0);
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
  if (viewerCount() >= maxChars()) evict();
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
function viewerCount() {
  let n = 0;
  for (const c of chars.values()) if (!c.npc) n++;
  return n;
}
function evict() {
  let victim = null;
  for (const c of chars.values()) {
    if (c.npc || c.leaving || now < c.busyUntil) continue;
    if (!victim || c.lastActive < victim.lastActive) victim = c;
  }
  if (victim) leave(victim);
  // vẫn quá đông (toàn người đang diễn) thì xoá thẳng người cũ nhất
  if (viewerCount() >= maxChars() + 20) {
    const oldest = [...chars.values()].filter((c) => !c.npc).sort((a, b) => a.lastActive - b.lastActive)[0];
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
    if (!c.npc && !c.leaving && now - c.lastActive > IDLE_LEAVE_SEC) leave(c);
    // đi theo đường (lệnh "Đi vòng", bồi bàn, dancer...) rồi gọi onArrive
    if (c.path && Math.hypot(c.tx - c.x, c.ty - c.y) < 4) {
      if (c.path.length) {
        const p = c.path.shift();
        c.tx = p.x;
        c.ty = p.y;
      } else {
        c.path = null;
        c.speedMul = 1;
        const done = c.onArrive;
        c.onArrive = null;
        done?.(c);
      }
    }
    const dx = c.tx - c.x;
    const dy = c.ty - c.y;
    const d = Math.hypot(dx, dy);
    const sp = (c.path ? 330 : 240) * (c.speedMul || 1) * dt;
    c.moving = d > 2;
    if (d <= sp) {
      c.x = c.tx;
      c.y = c.ty;
    } else {
      c.x += (dx / d) * sp;
      c.y += (dy / d) * sp;
    }
    if (c.effect && now > c.effect.until) c.effect = null;
    // to/nhỏ mượt theo ngoại hình
    const target = (c.size ? c.size / sceneScale(c.y) : c.look?.scale || 1) * (c.effect?.grow || 1);
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
    updateEffect(c, dt);
  }
}

function spriteOf(c) {
  const av = c.viewer?.avatar ? img(c.viewer.avatar) : null;
  const res = (c.look?.scale || 1) > 1.3 ? 2 : 1.25;
  const costume = c.effect?.costume || c.parts.costume || '';
  const key = `${c.look.style}|${costume}|${av ? 1 : 0}|${res}`;
  if (!c.sprite || c.spriteKey !== key) {
    c.sprite = renderChibi(costume === (c.parts.costume || '') ? c.parts : { ...c.parts, costume }, av, res);
    c.spriteKey = key;
  }
  return c.sprite;
}

function tagOf(c) {
  if (c.npc) {
    if (!c.tag) c.tag = renderTag(c.label, c.labelColor, 1, false, FONT);
    return c.tag;
  }
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
  const ef = effectPose(c);
  const m = ef.still ? { dx: 0, dy: 0, rot: 0, sx: 1, arms: null, beat: beatPos } : danceOf(c);
  const x = c.x + m.dx * s0;
  const y = c.y - m.dy * s0 - c.jumpY;
  ctx.globalAlpha = alpha;
  drawEffectWorld(c, x, y, s);

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
  if (c.clipY != null) {
    // đứng sau quầy: che phần dưới
    ctx.beginPath();
    ctx.rect(0, 0, W, c.clipY);
    ctx.clip();
  }
  if (c.spin) {
    // lộn một vòng (lệnh "Nhảy 1 cái")
    ctx.translate(x, y - dh / 2);
    ctx.rotate(c.spin);
    ctx.drawImage(sp, -dw / 2, -dh / 2, dw, dh);
  } else {
    ctx.translate(x + ef.dx * s, y - ef.dy * s);
    ctx.rotate(m.rot + ef.rot);
    ctx.scale(m.sx * ef.sx, ef.sy);
    if (ef.potato) drawPotato(s, m.dy);
    else {
      if (ef.coffin) drawCoffin(s);
      const squash = c.moving ? 0 : (m.dy / 18) * 0.05;
      ctx.drawImage(sp, (-dw * (1 + squash)) / 2, -dh * (1 - squash) - 2 * s, dw * (1 + squash), dh * (1 - squash));
      drawArms(ctx, 0, 0, s, c.parts, ef.arms || m.arms, now, c.seed, m.beat);
      drawEffectOverlay(c, s);
    }
  }
  ctx.restore();
  if (c.shieldUntil > now) drawShield(c, x, y, s);
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
  if (c.viewer && c.viewer.id === trollLeader()?.id) emoji('🤡', c.x - 30 * s, top + 8 * s, 30 * clamp(s, 0.6, 1.4)); // nạn nhân của đêm
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

// ---------------- Hiệu ứng "bựa" trên nhân vật (đồ uống, bánh kem) ----------------
const EFFECT_SEC = {
  hiccup: 4, fire: 3.5, zoom: 4, freeze: 4, rocket: 2.6, sour: 3, hearts: 3, pie: 7,
  derp: 8, banana: 4.5, potato: 9, tpose: 6, worm: 6, chicken: 10, noodle: 7, fart: 4.6, coffin: 45,
};

function applyEffect(c, effect, opts = {}) {
  const dur = opts.sec || EFFECT_SEC[effect] || 3;
  c.effect = { type: effect, start: now, until: now + dur, last: 0, costume: opts.costume || null, dir: Math.random() < 0.5 ? -1 : 1 };
  const top = () => headTop(c);
  const s = scaleOf(c);
  switch (effect) {
    case 'derp':
      w.float(c.x, top() - 50, 'Ơ kìa... 🤪', '#fff59d', 32);
      break;
    case 'banana':
      w.float(c.x, top() - 50, 'Á Á Á!!! 🍌', '#ffee58', 34);
      break;
    case 'potato':
      w.float(c.x, top() - 50, 'BỤP! Thành khoai 🥔', '#d7b98a', 32);
      fx.sparkBurst(c.x, c.y - 60 * s, { n: 30, color: [230, 200, 140], speed: 260 });
      for (let i = 0; i < 6; i++) bits.push({ x: c.x + rand(-40, 40) * s, y: c.y - rand(20, 110) * s, vx: rand(-60, 60), vy: rand(-80, -20), life: 0, max: 0.8, e: '💨', size: 30 * s });
      break;
    case 'tpose':
      w.float(c.x, top() - 50, '🧍 T-POSE!', '#80deea', 34);
      break;
    case 'worm':
      w.float(c.x, top() - 50, 'Bò như sâu đo 🪱', '#c5e1a5', 30);
      break;
    case 'chicken':
      w.float(c.x, top() - 50, 'Cục ta cục tác! 🐔', '#ffe082', 32);
      if (opts.costume) fx.sparkBurst(c.x, c.y - 60 * s, { n: 24, color: [255, 245, 220], speed: 240 });
      break;
    case 'noodle':
      w.float(c.x, top() - 50, 'Tay dẻo như mì 🍜', '#ffcc80', 30);
      break;
    case 'fart': {
      w.float(c.x, top() - 60, 'PỤT!!! 💨', '#b2ff59', 46);
      // người đứng gần bịt mũi bỏ chạy
      for (const o of w.chars) {
        if (o === c || Math.hypot(o.x - c.x, o.y - c.y) > 190 * sceneScale(c.y)) continue;
        w.emote(o, '🤢', 3000);
        w.pose(o, 'cheer', 2200);
        const away = o.x >= c.x ? 1 : -1;
        w.moveTo(o, clamp(o.x + away * rand(80, 130), 30, W - 30), o.y);
        setTimeout(() => !o.path && w.goHome(o), 2800);
      }
      break;
    }
    case 'fire':
      w.float(c.x, top() - 50, 'CAY QUÁ!!! 🔥', '#ff7043', 34);
      break;
    case 'hiccup':
      w.float(c.x, top() - 50, 'Hức! 🫧', '#e1bee7');
      break;
    case 'zoom': {
      w.float(c.x, top() - 50, '⚡ TĂNG LỰC! ⚡', '#ffee58', 34);
      const path = scene.walkPath || defaultWalkPath();
      w.walk(c, [...path, c.home], { speed: 2.6 });
      break;
    }
    case 'freeze':
      w.float(c.x, top() - 50, 'Lạnh quá trời 🥶', '#81d4fa');
      break;
    case 'rocket':
      w.float(c.x, top() - 50, 'Ợ Ợ Ợ ỢỢỢ!!! 🚀', '#fff59d', 34);
      break;
    case 'sour':
      w.float(c.x, top() - 50, 'Chuaaaa 😖', '#dce775');
      w.emote(c, '😖', 3000);
      break;
    case 'hearts':
      w.hearts(c.x, top(), { n: 8 });
      w.emote(c, '🥰', 3000);
      break;
    case 'pie':
      w.float(c.x, top() - 40, 'BỘP!!! 🥧', '#fff', 38);
      w.emote(c, '😵', 3500);
      fx.sparkBurst(c.x, top() + 20, { n: 30, color: [255, 250, 240], speed: 300 });
      break;
  }
}

/** Độ lệch thân + tay theo hiệu ứng đang chạy. still: tạm dừng điệu nhảy thường. */
function effectPose(c) {
  const e = c.effect;
  const out = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, arms: null, still: false, potato: false, coffin: false };
  if (!e) return out;
  const t = now - e.start;
  const dur = e.until - e.start;
  const p = t / dur;
  const fadeOut = (sec) => 1 - ease(clamp((t - (dur - sec)) / sec, 0, 1));
  switch (e.type) {
    case 'derp':
      out.rot = Math.sin(t * 7) * 0.2;
      out.sy = 1 + Math.sin(t * 14) * 0.05;
      out.arms = 'noodle';
      break;
    case 'noodle':
      out.rot = Math.sin(t * 5) * 0.16;
      out.sx = 1 + Math.sin(t * 10) * 0.07;
      out.dy = Math.abs(Math.sin(t * 5)) * 8;
      out.arms = 'noodle';
      out.still = true;
      break;
    case 'banana': {
      // loạng choạng -> bật lên ngã ngửa -> nằm chổng vó -> lồm cồm bò dậy
      const fall = clamp((t - 0.3) / 0.35, 0, 1);
      const k = ease(fall) * fadeOut(0.7);
      out.rot = k * 1.5 * e.dir;
      out.dx = t < 0.3 ? Math.sin(t * 50) * 5 : 0;
      out.dy = fall > 0 && fall < 1 ? Math.sin(fall * Math.PI) * 40 : 0;
      out.arms = k > 0.6 ? 'tpose' : 'cheer';
      out.still = true;
      break;
    }
    case 'potato':
      out.potato = true;
      break;
    case 'tpose':
      // cứng đơ, bay lơ lửng, xoay chầm chậm
      out.dy = Math.sin(clamp(p, 0, 1) * Math.PI) * 170;
      out.dx = Math.sin(t * 1.6) * 45;
      out.rot = Math.sin(t * 1.2) * 0.3;
      out.arms = 'tpose';
      out.still = true;
      break;
    case 'worm': {
      // nằm sấp, uốn người bò tới bò lui
      const k = ease(Math.min(1, t / 0.4)) * fadeOut(0.5);
      const wv = Math.sin(t * 9);
      out.rot = (Math.PI / 2) * e.dir * k;
      out.sy = 1 + wv * 0.13 * k;
      out.dy = Math.max(0, wv) * 10 * k;
      out.dx = Math.sin(t * 1.4) * 50 * k;
      out.still = true;
      break;
    }
    case 'chicken': {
      // mổ thóc: cúi gập người theo nhịp + đập cánh
      const peck = Math.pow(Math.abs(Math.sin(t * 5)), 6);
      out.rot = peck * 0.5 * e.dir;
      out.dy = Math.abs(Math.sin(t * 2.5)) * 8;
      out.dx = Math.sin(t * 1.3) * 30;
      out.arms = 'flap';
      out.still = true;
      break;
    }
    case 'fart':
      // gồng... rồi phụt bay lên trần như tên lửa
      if (t < 0.9) {
        out.dx = Math.sin(t * 70) * 3;
        out.sy = 1 - 0.1 * Math.abs(Math.sin(t * 18));
      } else out.dy = Math.sin(Math.min(1, (t - 0.9) / (dur - 0.9)) * Math.PI) * 650;
      out.rot = t > 0.9 ? Math.sin(t * 20) * 0.15 : 0;
      out.arms = 'cheer';
      out.still = true;
      break;
    case 'coffin': {
      // nằm thẳng trong quan tài, được khiêng trên vai
      const k = ease(Math.min(1, t / 0.6));
      out.rot = (-Math.PI / 2) * k;
      out.dy = 172 * k; // giơ cao qua đầu đội khiêng
      out.dx = 70 * k;
      out.coffin = true;
      out.still = true;
      break;
    }
    case 'hiccup': {
      const k = (t % 0.9) / 0.9;
      out.dy = k < 0.25 ? Math.sin((k / 0.25) * Math.PI) * 16 : 0;
      break;
    }
    case 'fire':
      out.dx = Math.sin(t * 40) * 2;
      out.arms = 'cheer';
      break;
    case 'freeze':
      out.dx = Math.sin(t * 70) * 2.5;
      out.sy = 0.96;
      break;
    case 'rocket': {
      // rung rung rồi phụt bay lên trời, rơi xuống
      if (t < 0.5) out.dx = Math.sin(t * 60) * 3;
      else out.dy = Math.sin(Math.min(1, (t - 0.5) / (e.until - e.start - 0.5)) * Math.PI) * 520;
      out.arms = 'cheer';
      break;
    }
    case 'sour':
      out.sx = 1 - 0.12 * Math.abs(Math.sin(t * 9));
      break;
    case 'pie':
      out.dx = p < 0.08 ? Math.sin(t * 80) * 4 : 0;
      break;
  }
  return out;
}

/** Hạt/khói theo hiệu ứng (gọi mỗi khung hình). */
function updateEffect(c, dt) {
  const e = c.effect;
  if (!e) return;
  const t = now - e.start;
  const s = scaleOf(c);
  const mouth = { x: c.x + 8 * s, y: c.y - (FOOT_Y - HEAD_Y - 10) * s - (c.jumpY || 0) };
  e.last += dt;
  if (e.type === 'fire' && e.last > 0.05) {
    e.last = 0;
    for (let i = 0; i < 4; i++) {
      bits.push({ x: mouth.x, y: mouth.y, vx: rand(120, 260) * (Math.random() < 0.5 ? -1 : 1), vy: rand(-60, 20), life: 0, max: 0.5, e: '🔥', size: rand(18, 30) * s * 1.4 });
    }
  } else if (e.type === 'hiccup' && e.last > 0.9) {
    e.last = 0;
    w.float(c.x + 20 * s, headTop(c) - 20, 'hic!', '#e1bee7', 26);
    for (let i = 0; i < 3; i++) bits.push({ x: mouth.x, y: mouth.y, vx: rand(-40, 40), vy: rand(-160, -90), life: 0, max: 1.2, e: '⚫', size: 12 * s * 1.4 });
  } else if (e.type === 'freeze' && e.last > 0.15) {
    e.last = 0;
    bits.push({ x: c.x + rand(-50, 50) * s, y: headTop(c) - 30, vx: rand(-20, 20), vy: rand(40, 90), life: 0, max: 1.4, e: '❄️', size: 20 * s * 1.3 });
  } else if (((e.type === 'rocket' && t > 0.5) || (e.type === 'fart' && t > 0.9)) && e.last > 0.04) {
    e.last = 0;
    const fy = c.y - effectPose(c).dy * s;
    bits.push({ x: c.x + rand(-10, 10) * s, y: fy, vx: rand(-40, 40), vy: rand(80, 180), life: 0, max: 0.7, e: '💨', size: 26 * s * 1.3 });
  } else if (e.type === 'chicken' && e.last > 0.5) {
    e.last = 0;
    bits.push({ x: c.x + rand(-30, 30) * s, y: c.y - 70 * s, vx: rand(-50, 50), vy: rand(-90, -30), life: 0, max: 1.1, e: '🪶', size: 20 * s * 1.3 });
  } else if (e.type === 'derp' && e.last > 1.2) {
    e.last = 0;
    w.float(c.x + rand(-30, 30) * s, headTop(c) - 20, ['hơ hơ', 'ơ?', 'é é', 'hihi 🤪'][Math.floor(rand(0, 4))], '#fff59d', 24);
  }
}

/** Mắt lồi kiểu đồ chơi, con ngươi lắc lư (lác hoặc đảo lung tung). */
function googly(x, y, r, cross) {
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#222';
  ctx.lineWidth = Math.max(1, r * 0.18);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const a = now * 11 + x;
  const px = x + (cross * 0.45 + Math.sin(a) * 0.2) * r;
  const py = y + (0.15 + Math.cos(a * 1.3) * 0.25) * r;
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(px, py, r * 0.45, 0, Math.PI * 2);
  ctx.fill();
}

/** Củ khoai tây có mắt (trò troll "Hoá khoai tây"), vẫn nhún theo nhạc. */
function drawPotato(s, bounce) {
  const sq = (bounce / 18) * 0.08;
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath();
  ctx.ellipse(0, -2 * s, 26 * s, 5 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.scale(1 + sq, 1 - sq);
  ctx.fillStyle = '#c99a5b';
  ctx.strokeStyle = '#8a6232';
  ctx.lineWidth = 2.5 * s;
  ctx.beginPath();
  ctx.ellipse(0, -50 * s, 32 * s, 46 * s, 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(120,80,35,.55)';
  for (const [dx, dy, r] of [[-14, -78, 3], [12, -28, 3.5], [16, -66, 2.5], [-10, -22, 2.5], [-20, -48, 2]]) {
    ctx.beginPath();
    ctx.arc(dx * s, dy * s, r * s, 0, Math.PI * 2);
    ctx.fill();
  }
  googly(-10 * s, -62 * s, 9 * s, 1);
  googly(11 * s, -60 * s, 9 * s, -1);
  ctx.strokeStyle = '#5d3a17';
  ctx.lineWidth = 2.5 * s;
  ctx.beginPath();
  ctx.arc(0, -42 * s, 7 * s, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  ctx.restore();
}

/** Quan tài (vẽ dưới nhân vật đang nằm). */
function drawCoffin(s) {
  ctx.fillStyle = '#4e342e';
  ctx.strokeStyle = '#a1887f';
  ctx.lineWidth = 3 * s;
  ctx.beginPath();
  ctx.moveTo(-26 * s, 4 * s);
  ctx.lineTo(26 * s, 4 * s);
  ctx.lineTo(40 * s, -100 * s);
  ctx.lineTo(28 * s, -150 * s);
  ctx.lineTo(-28 * s, -150 * s);
  ctx.lineTo(-40 * s, -100 * s);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffd54f';
  ctx.fillRect(-2 * s, -128 * s, 4 * s, 22 * s);
  ctx.fillRect(-9 * s, -121 * s, 18 * s, 4 * s);
}

/** Khiên chống troll: bong bóng xanh bao quanh nhân vật. */
function drawShield(c, x, y, s) {
  const r = 82 * s;
  const cy = y - 62 * s;
  const pulse = 1 + Math.sin(now * 4) * 0.03;
  const g = ctx.createRadialGradient(x, cy, r * 0.6, x, cy, r * pulse);
  g.addColorStop(0, 'rgba(100,220,255,0)');
  g.addColorStop(1, 'rgba(100,220,255,0.35)');
  ctx.fillStyle = g;
  ctx.strokeStyle = `rgba(160,240,255,${0.6 + Math.sin(now * 6) * 0.2})`;
  ctx.lineWidth = 3 * s;
  ctx.beginPath();
  ctx.arc(x, cy, r * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.4, cy - r * 0.45, r * 0.18, r * 0.09, -0.6, 0, Math.PI * 2);
  ctx.fill();
}

/** Vẽ theo toạ độ thật (không xoay theo người): vỏ chuối dưới chân, mây xì hơi. */
function drawEffectWorld(c, x, y, s) {
  const e = c.effect;
  if (!e) return;
  const t = now - e.start;
  if (e.type === 'banana') {
    emoji('🍌', c.x - e.dir * 34 * s, c.y - 6 * s, 34 * s);
  } else if (e.type === 'fart') {
    const a = clamp(1 - t / (e.until - e.start), 0, 1);
    ctx.save();
    ctx.globalAlpha *= a * 0.55;
    ctx.fillStyle = '#9ccc65';
    for (let i = 0; i < 7; i++) {
      const ang = (i / 7) * Math.PI * 2 + c.seed * 5;
      const rr = (30 + Math.min(1, t / 1.2) * 90) * s;
      ctx.beginPath();
      ctx.arc(c.x + Math.cos(ang) * rr * 0.9, c.y - 30 * s + Math.sin(ang) * rr * 0.35, (26 + i * 3) * s * (0.6 + Math.min(1, t)), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

/** Vẽ đè lên nhân vật (toạ độ đã dời về chân nhân vật). */
function drawEffectOverlay(c, s) {
  const e = c.effect;
  if (!e) return;
  const hy = -(FOOT_Y - HEAD_Y) * s;
  if (e.type === 'derp') {
    // mắt lồi lác + thè lưỡi (dán đè lên cả ảnh đại diện)
    googly(-11 * s, hy - 2 * s, 10 * s, 1);
    googly(11 * s, hy - 2 * s, 10 * s, -1);
    ctx.fillStyle = '#ff6f91';
    ctx.strokeStyle = '#c2185b';
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath();
    ctx.roundRect(-5 * s + Math.sin(now * 9) * 3 * s, hy + 13 * s, 10 * s, (13 + Math.sin(now * 6) * 3) * s, [2 * s, 2 * s, 6 * s, 6 * s]);
    ctx.fill();
    ctx.stroke();
    return;
  }
  if (e.type === 'fire') {
    ctx.fillStyle = `rgba(255,40,20,${0.35 + 0.15 * Math.sin(now * 20)})`;
    ctx.beginPath();
    ctx.arc(0, hy, HEAD_R * s, 0, Math.PI * 2);
    ctx.fill();
  } else if (e.type === 'freeze') {
    ctx.fillStyle = 'rgba(120,200,255,0.35)';
    ctx.beginPath();
    ctx.roundRect(-34 * s, hy - HEAD_R * s, 68 * s, (FOOT_Y - HEAD_Y + HEAD_R) * s, 18 * s);
    ctx.fill();
  } else if (e.type === 'pie') {
    // kem dính đầy mặt, chảy xuống
    const a = clamp((e.until - now) / 1, 0, 1);
    ctx.globalAlpha *= a;
    ctx.fillStyle = '#fffaf2';
    ctx.beginPath();
    ctx.arc(0, hy + 2 * s, (HEAD_R - 2) * s, 0, Math.PI * 2);
    for (const [dx, dy, r] of [[-14, 10, 9], [10, 14, 10], [0, -16, 11], [-20, -6, 8], [18, -4, 8]]) {
      ctx.moveTo(dx * s + r * s, hy + dy * s);
      ctx.arc(dx * s, hy + dy * s, r * s, 0, Math.PI * 2);
    }
    ctx.fill();
    const drip = Math.min(1, (now - e.start) / 2) * 18 * s;
    ctx.fillRect(-12 * s, hy + 20 * s, 6 * s, drip);
    ctx.fillRect(8 * s, hy + 18 * s, 5 * s, drip * 0.7);
    ctx.fillStyle = '#e53935';
    ctx.beginPath();
    ctx.arc(2 * s, hy - 20 * s, 4 * s, 0, Math.PI * 2); // quả cherry
    ctx.fill();
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
  // ---- Gọi đồ, mời, ném bánh ----
  order_placed(w, a) {
    const c = w.charFor(a.user, 3500);
    w.say(c, `Cho mình 1 ${a.data.item.emoji} ${a.data.item.name}!`, 3000);
    w.emote(c, '⏳', 3000);
  },
  order_wait(w, a) {
    const c = w.charFor(a.user, 2500);
    w.float(c.x, headTop(c) - 40, `⏳ Đợi ${a.data.waitSec}s nữa nha`, '#b0bec5', 24);
  },
  order_busy(w, a) {
    const c = w.charFor(a.user, 2500);
    w.float(c.x, headTop(c) - 40, 'Quầy đang đông, thử lại sau 🙏', '#b0bec5', 24);
  },
  order_menu(w, a) {
    w.charFor(a.user, 2500);
    w.banner('📋 Gõ !goi <món>', { sub: a.data.menu.map((m) => `${m.emoji} ${m.name}`).join(' · '), color: '#ffe082', ms: 5000 });
  },
  order_ready(w, a) {
    const c = w.charFor(a.user, 5000);
    const it = a.data.item;
    w.fly(it.emoji, srcOf(c), chest(c), { size: 54, onArrive: () => {
      w.hold(c, it.emoji, 4000);
      w.drinkEffect(c, it.effect);
    } });
  },
  treat(w, a) {
    const from = w.charFor(a.user, 6000);
    const to = w.charFor(a.data.to, 6000);
    w.fly('💕', chest(from), chest(to), { size: 50, arc: 220, ms: 1200 });
    w.fly(a.data.item.emoji, srcOf(to), chest(to), { size: 60, ms: 1300, onArrive: () => {
      w.hold(to, a.data.item.emoji, 5000);
      w.drinkEffect(to, a.data.item.effect || 'hearts');
    } });
    w.banner(`🥰 ${a.user.name} mời ${a.data.to.name}`, { sub: `${a.data.item.emoji} ${a.data.item.name}`, color: '#f48fb1', ms: 4000 });
  },
  throw_pie(w, a) {
    const from = w.charFor(a.user, 6000);
    const to = w.charFor(a.data.to, 8000);
    w.pose(from, 'cheer', 1200);
    w.fly('🥧', chest(from), { x: to.x, y: headTop(to) + 25 * scaleOf(to) }, { size: 64, arc: 260, ms: 900, onArrive: () => {
      w.drinkEffect(to, 'pie');
      w.emote(from, '😂', 3000);
    } });
    w.banner(`🥧 ${a.user.name} ném bánh kem vào ${a.data.to.name}!`, { color: '#ffcc80', ms: 3500 });
  },
  social_hint(w, a) {
    const c = w.charFor(a.user, 3000);
    w.float(c.x, headTop(c) - 40, a.data.kind === 'pie' ? 'Tặng quà trước rồi !nem <tên> 🥧' : 'Tặng quà trước rồi !moi <tên> 🍹', '#ffe082', 24);
  },
  social_notfound(w, a) {
    const c = w.charFor(a.user, 3000);
    w.float(c.x, headTop(c) - 40, `Không thấy "${a.data.text}" trong quán 🤔`, '#b0bec5', 24);
  },

  // ---- Nhạc ----
  music_list(w, a) {
    if (a.user) w.charFor(a.user, 2500);
    const list = (a.data.list || []).slice(0, 8).map((s) => `${s.id}. ${s.title}`).join(' · ');
    w.banner('🎵 Gõ !nhac <số> để chọn bài', { sub: list, color: '#ce93d8', ms: 6000 });
  },
  song_requested(w, a) {
    const c = w.charFor(a.user, 4000);
    if (a.data.priority) w.banner(`⏩ ${a.user.name} chen bài`, { sub: `🎵 ${a.data.song.title}`, color: '#ce93d8', ms: 3500 });
    else w.float(c.x, headTop(c) - 40, `🎵 ${a.data.song.title} (#${a.data.position})`, '#ce93d8', 26);
  },
  song_voted(w, a) {
    const c = w.charFor(a.user, 2500);
    w.float(c.x, headTop(c) - 40, `👍 ${a.data.song.title} (${a.data.votes} phiếu)`, '#ce93d8', 24);
  },
  song_wait(w, a) {
    const c = w.charFor(a.user, 2500);
    w.float(c.x, headTop(c) - 40, `⏳ ${a.data.waitSec}s nữa mới chọn tiếp được`, '#b0bec5', 24);
  },
  song_playing(w, a) {
    const c = w.charFor(a.user, 2500);
    w.float(c.x, headTop(c) - 40, '🎶 Bài này đang phát mà!', '#ce93d8', 24);
  },
  song_change(w, a) {
    w.banner(`🎵 ${a.data.song.title}`, { sub: a.user ? `do ${a.user.name} chọn` : a.data.song.artist || '', color: '#ce93d8', ms: 3500 });
    w.fx.wash({ color: [170, 80, 255], ms: 2500, alpha: 0.15 });
    if (a.user) w.pose(w.charFor(a.user, 4000), 'cheer', 3000);
    if (scene.soloOnSong !== false && state.features?.troll) setTimeout(soloTroll, 4000);
  },

  // ---- Dancer ----
  dancer_visit(w, a) {
    const c = w.charFor(a.user, (a.data.sec || 20) * 1000);
    const d = w.npc(`dancer:${a.data.dancer.id}`);
    w.banner(`${a.data.dancer.name} tới nhảy cho ${a.user.name}!`, { color: '#80cbc4', ms: 3500 });
    if (!d) return;
    const spot = { x: clamp(c.x + 55 * scaleOf(c), 40, W - 40), y: c.y + 12 };
    w.walk(d, [spot], {
      speed: 1.8,
      onDone: () => {
        d.dance = { move: 'hop', start: now, until: now + (a.data.sec || 20) };
        w.fx.beam(() => ({ x: (d.x + c.x) / 2, y: c.y }), { ms: (a.data.sec || 20) * 1000, color: [120, 255, 220], width: 150 });
        setTimeout(() => w.walk(d, [d.home], { speed: 1.5 }), (a.data.sec || 20) * 1000);
      },
    });
  },
  dancer_queued(w, a) {
    const c = w.charFor(a.user, 3000);
    w.float(c.x, headTop(c) - 40, `💃 Dancer đang bận, bạn xếp hàng #${a.data.position}`, '#80cbc4', 24);
  },
  dancer_pick(w, a) {
    const c = w.charFor(a.user, 3000);
    w.float(c.x, headTop(c) - 40, `💃 Đã chọn ${a.data.dancer.name}, tặng quà để gọi!`, '#80cbc4', 24);
  },
  dancer_list(w, a) {
    w.banner('💃 Gõ !dancer <tên> rồi tặng quà', { sub: a.data.list.map((d) => d.name).join(' · '), color: '#80cbc4', ms: 4500 });
  },

  // ---- Mục tiêu chung ----
  goal_reached(w, a) {
    const fy = floorY();
    w.fx.flash({ alpha: 0.5, ms: 600 });
    w.fx.confettiRain({ ms: 6000 });
    [120, W - 120].forEach((x) => w.fx.sparkFountain(x, fy, { ms: 5000 }));
    for (const o of w.chars) {
      w.pose(o, 'cheer', 6000);
      setTimeout(() => w.fly('🧋', srcOf(o), chest(o), { size: 40, onArrive: () => w.hold(o, '🧋', 8000) }), rand(0, 2000));
    }
    // tháp ly trên quầy
    const sx = srcOf(w.chars[0] || { x: W / 2, y: 900 });
    w.fx.custom(8000, (cx, p) => {
      const rows = 5;
      const k = Math.min(1, p * 6);
      for (let r = 0; r < rows; r++) {
        if (r / rows > k) break;
        for (let i = 0; i <= r; i++) emoji('🧋', sx.x + (i - r / 2) * 46, sx.y - 40 - (rows - r) * 40 + 40 * rows - 200, 40);
      }
    });
    w.banner(`🧋 ${a.data.label}!`, { sub: `Cảm ơn mọi người · góp nhiều nhất: ${a.data.best}`, big: true, color: '#ffca28', ms: 6500 });
    return 7000;
  },

  // ---- Troll bạn bè ----
  troll(w, a) {
    const trick = a.data.trick;
    const from = w.charFor(a.user, 7000);
    const hit = (c) => {
      w.charFor(c.viewer, 9000);
      if (trick.id === 'coffin') return w.coffinDance(c);
      w.drinkEffect(c, trick.id, { costume: trick.id === 'chicken' ? 'chicken' : null });
      w.emote(c, '😵', 2500);
    };
    if (a.data.bounced) {
      // khiên dội ngược: đồ troll bay tới, bật lại trúng chính người troll
      const sh = w.charFor(a.data.shield, 7000);
      w.banner(`🛡️ ${a.data.shield.name} dội ngược!`, { sub: `${a.user.name} tự dính ${trick.emoji} ${trick.name} 😂`, color: '#80deea', ms: 4000 });
      w.fly(trick.emoji, chest(from), chest(sh), { size: 60, arc: 200, ms: 900, onArrive: () => {
        fx.sparkBurst(chest(sh).x, chest(sh).y, { n: 36, color: [140, 230, 255], speed: 380 });
        w.float(sh.x, headTop(sh) - 40, '🛡️ BOING!', '#80deea', 34);
        w.emote(sh, '😎', 3000);
        w.fly(trick.emoji, chest(sh), chest(from), { size: 60, arc: 160, ms: 800, onArrive: () => hit(from) });
      } });
      return 4000;
    }
    const to = w.charFor(a.data.to, 9000);
    w.pose(from, 'point', 1500);
    w.emote(from, '😈', 3000);
    w.banner(`🤡 ${a.user.name} troll ${a.data.to.name}`, { sub: `${trick.emoji} ${trick.name}`, color: '#ff8a65', ms: 3800, big: trick.id === 'coffin' });
    if (trick.id === 'coffin') hit(to);
    else w.fly(trick.emoji, chest(from), { x: to.x, y: trick.id === 'banana' ? to.y : chest(to).y }, { size: 60, arc: 240, ms: 900, onArrive: () => hit(to) });
    return trick.id === 'coffin' ? 9000 : 4000;
  },
  troll_shield(w, a) {
    const c = w.charFor(a.user, 4000);
    c.shieldUntil = now + (a.data.sec || 120);
    w.fx.halo(at(c), { color: [120, 220, 255] });
    w.float(c.x, headTop(c) - 40, `🛡️ Khiên chống troll ${a.data.sec}s`, '#80deea', 28);
  },
  troll_armed(w, a) {
    const c = w.charFor(a.user, 3500);
    w.float(c.x, headTop(c) - 40, `🎯 Nhắm ${a.data.to.name} rồi, tặng quà để troll!`, '#ff8a65', 24);
    w.emote(c, '😏', 3000);
  },
  troll_hint(w, a) {
    const c = w.charFor(a.user, 3000);
    w.float(c.x, headTop(c) - 40, a.data.kind === 'shield' ? 'Tặng quà để bật khiên 🛡️' : 'Tặng quà rồi !troll <tên> 🤡', '#80deea', 24);
  },
  troll_notfound(w, a) {
    const c = w.charFor(a.user, 3000);
    w.float(c.x, headTop(c) - 40, `Không thấy "${a.data.text}" trong quán 🤔`, '#b0bec5', 24);
  },
  troll_help(w, a) {
    if (a.user) w.charFor(a.user, 2500);
    const list = (a.data.tricks || []).map((t) => `${t.emoji} ${t.name}`).join(' · ');
    w.banner('🤡 !troll <tên> rồi tặng quà (quà càng to càng nặng)', { sub: list, color: '#ff8a65', ms: 6000 });
  },
  troll_dance(w, a) {
    const c = w.charFor(a.user, 6000);
    w.drinkEffect(c, a.data.dance.effect || a.data.dance.id);
  },
  troll_dance_list(w, a) {
    if (a.user) w.charFor(a.user, 2500);
    w.banner('🕺 Gõ !nhay <điệu> (miễn phí)', { sub: (a.data.list || []).map((d) => `${d.emoji} ${d.id}`).join(' · '), color: '#ffcc80', ms: 5000 });
  },
  troll_wait(w, a) {
    const c = w.charFor(a.user, 2500);
    w.float(c.x, headTop(c) - 40, `⏳ ${a.data.waitSec}s nữa mới nhảy tiếp được`, '#b0bec5', 24);
  },
  troll_top(w, a) {
    const c = w.charFor(a.user, 6000);
    w.emote(c, '🤡', 5000);
    w.fx.beam(at(c), { ms: 4000, color: [255, 120, 90] });
    w.banner(`🤡 Nạn nhân của đêm: ${a.user.name}`, { sub: `Bị troll ${a.data.n} lần rồi 😂`, color: '#ff8a65', ms: 4500 });
  },

  unknown(w, a) {
    const c = a.user && w.charFor(a.user, 3000);
    if (c) w.float(c.x, headTop(c) - 40, a.data?.cmd?.label || a.action);
  },
};

/** Người đứng đầu bảng "Nạn nhân của đêm" (bị troll từ 2 lần). */
function trollLeader() {
  const v = state.features?.troll?.top?.[0];
  return v && v.n >= 2 ? v : null;
}

// Đội khiêng quan tài: 4 người vest đen kính râm ra tận nơi, khiêng nạn nhân đi một vòng quán rồi trả về chỗ.
let bearerSeq = 0;
const SUIT = { outfit: '#16161c', outfit2: '#f5f5f5', shirt: 'collar', bowtie: '#16161c', accessory: 'shades', pants: '#16161c', hairStyle: 'short' };
function coffinDance(c) {
  if (c.effect?.type === 'coffin') return; // đang được khiêng rồi
  const id = ++bearerSeq;
  const ent = scene.entrance || { x: W / 2, y: H + 60 };
  // diễu ở giữa sàn phía trước (scene có thể đặt paradePath riêng), to hơn người thường cho dễ thấy
  const fy = Math.min(floorY() - 60, H - 260);
  const route = scene.paradePath || [
    { x: W * 0.5, y: fy },
    { x: W * 0.24, y: fy - 30 },
    { x: W * 0.36, y: fy - 150 },
    { x: W * 0.6, y: fy - 170 },
    { x: W * 0.68, y: fy - 40 },
    { x: W * 0.4, y: fy + 20 },
    { x: W * 0.5, y: fy },
  ];
  const GROW = 1.45;
  const k = sceneScale(fy) * GROW;
  const offs = [-84, -30, 30, 84].map((d) => d * k);
  const bearers = offs.map((dx, i) =>
    w.npc(`bearer:${id}:${i}`, { x: ent.x + i * 40, y: ent.y, scale: GROW, style: 900 + i, parts: SUIT }),
  );
  c.busyUntil = now + 40;
  w.emote(c, '😱', 4000);
  w.say(c, 'Ơ ơ... tôi còn sống mà!!!', 3500);
  const dismiss = () => {
    for (const b of bearers) {
      if (!chars.has(b.id)) continue;
      b.pose = null;
      w.walk(b, [ent], { speed: 1.5, onDone: () => removeChar(b) });
    }
  };
  let arrived = 0;
  const start = () => {
    applyEffect(c, 'coffin');
    c.effect.grow = GROW;
    w.fx.wash({ color: [40, 40, 60], ms: 3000, alpha: 0.25 });
    w.camera(c, 6000);
    for (const b of bearers) w.pose(b, 'carry', 60000);
    const pts = route.slice(1);
    w.walk(c, pts, { speed: 0.36, onDone: () => {
      c.effect = null;
      w.pose(c, 'cheer', 2500);
      w.float(c.x, headTop(c) - 40, 'Sống lại rồi!!! 😂', '#fff', 30);
      dismiss();
      setTimeout(() => !c.path && w.goHome(c), 2500);
    } });
    // cùng tốc độ + đường đi dời đúng một khoảng -> luôn đi khít dưới quan tài
    bearers.forEach((b, i) => w.walk(b, pts.map((p) => ({ x: p.x + offs[i], y: p.y + 6 })), { speed: 0.36 }));
  };
  // cả nạn nhân lẫn đội khiêng ra giữa sàn, đủ mặt thì nhấc lên
  const meet = () => ++arrived === bearers.length + 1 && start();
  w.walk(c, [route[0]], { speed: 1.2, onDone: meet });
  bearers.forEach((b, i) => w.walk(b, [{ x: route[0].x + offs[i], y: route[0].y + 6 }], { speed: 1.7, onDone: meet }));
  setTimeout(() => {
    // phòng khi nạn nhân rời quán giữa chừng
    if (c.effect?.type === 'coffin') c.effect = null;
    dismiss();
  }, 50000);
}

/** Đổi bài: đèn rọi một người ngẫu nhiên lên "solo" một điệu troll. */
function soloTroll() {
  const free = w.chars.filter((c) => !c.effect && now >= c.busyUntil);
  const c = free[Math.floor(Math.random() * free.length)];
  if (!c) return;
  const moves = ['chicken', 'worm', 'tpose', 'derp', 'noodle'];
  const move = moves[Math.floor(Math.random() * moves.length)];
  w.charFor(c.viewer, 6000);
  applyEffect(c, move, { sec: 6 });
  w.fx.beam(at(c), { ms: 6000, color: [255, 240, 200], width: 170 });
  w.banner(`🎤 Solo troll: ${c.viewer.name}!`, { color: '#ffcc80', ms: 3500 });
}

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

// ---------------- Nhạc ----------------
const audio = new Audio();
audio.preload = 'auto';
audio.volume = VOLUME;
let audioSong = null; // { id, startedAt }
let audioBlocked = false;
audio.addEventListener('loadedmetadata', () => sendWorld({ type: 'song_meta', songId: audioSong?.id, duration: audio.duration }));
audio.addEventListener('ended', () => sendWorld({ type: 'song_end', songId: audioSong?.id }));

function currentSong() {
  return state.features?.music?.now || null;
}
function syncMusic() {
  const song = currentSong();
  if (!song || !song.file || !sceneId) {
    if (audioSong) audio.pause();
    audioSong = null;
    return;
  }
  if (audioSong?.id === song.id && audioSong.startedAt === song.startedAt) return;
  audioSong = { id: song.id, startedAt: song.startedAt };
  audio.src = `/locations/${sceneId}/${song.file}`;
  const pos = Math.max(0, (Date.now() + clockOffset - song.startedAt) / 1000);
  audio.addEventListener('loadedmetadata', () => {
    if (pos < audio.duration - 1) audio.currentTime = pos;
  }, { once: true });
  audio.play()
    .then(() => (audioBlocked = false))
    .catch((err) => (audioBlocked = err?.name === 'NotAllowedError')); // chỉ khi trình duyệt chặn tự phát
}
// Trình duyệt thường chặn tự phát nhạc có tiếng: bấm vào trang một lần để bật (OBS không bị chặn)
// Trên điện thoại (live bằng chia sẻ màn hình): chạm một lần thì vào toàn màn hình, ẩn thanh địa chỉ
const isTouch = matchMedia('(pointer: coarse)').matches;
const canFullscreen = isTouch && !!document.documentElement.requestFullscreen;
const needFullscreen = () => canFullscreen && !document.fullscreenElement;
addEventListener('pointerdown', () => {
  if (audioBlocked && audioSong) audio.play().then(() => (audioBlocked = false)).catch(() => {});
  if (needFullscreen()) {
    document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      .then(() => screen.orientation?.lock?.('portrait').catch(() => {}))
      .catch(() => {});
  }
});

let ws = null;
function sendWorld(msg) {
  if (ws?.readyState === 1 && msg.songId != null) ws.send(JSON.stringify(msg));
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
  let y = scene?.bannerY ?? 600;
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
  drawGoal();
  const lead = state.location && trollLeader();
  if (lead) {
    pill(40, 202, 470, 46, 'rgba(0,0,0,.55)');
    text(`🤡 Nạn nhân của đêm: ${lead.name} (${lead.n})`, 58, 226, { size: 24, align: 'left', color: '#ffab91', stroke: null, maxWidth: 440 });
  }
  if ((audioBlocked && audioSong) || needFullscreen()) {
    const msg = audioBlocked && audioSong ? '🔇 Bấm vào màn hình để bật nhạc' : '📱 Chạm để xem toàn màn hình';
    pill(W / 2 - 250, 1840, 500, 54, 'rgba(0,0,0,.7)');
    text(msg, W / 2, 1867, { size: 26, stroke: null });
  }
  if (cam.target && cam.z > 1.3) {
    const name = cam.target.viewer?.name || '';
    pill(W / 2 - 230, 262, 460, 60, 'rgba(229,57,53,.85)');
    text(`🎥 Camera: ${name}`, W / 2, 293, { size: 30, stroke: null, maxWidth: 430 });
  }
}

/** Thanh mục tiêu chung (vd. "Tháp trà sữa cả quán"). */
function drawGoal() {
  const g = state.features?.goal;
  if (!g || !state.location) return;
  const x = 40;
  const y = 150;
  const wdt = W - 80;
  const k = clamp(g.progress / g.target, 0, 1);
  pill(x, y, wdt, 40, 'rgba(0,0,0,.55)');
  const grad = ctx.createLinearGradient(x, 0, x + wdt, 0);
  grad.addColorStop(0, '#ff8a65');
  grad.addColorStop(1, '#ffd54f');
  if (k > 0) pill(x + 3, y + 3, Math.max(34, (wdt - 6) * k), 34, grad);
  text(`🎯 ${g.label}: ${g.progress}/${g.target} xu`, W / 2, y + 21, { size: 24, stroke: 'rgba(0,0,0,.6)' });
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
    const people = [...chars.values()].filter((c) => !c.leaving && !c.npc).map((c) => ({ user: { ...c.viewer, look: c.look }, lastActive: c.lastActive }));
    chars.clear();
    spots = scene ? (typeof scene.spots === 'function' ? scene.spots(w) : scene.spots) || [] : [];
    freeSpots = new Set(spots.map((_, i) => i));
    if (scene) {
      const seed = people.length ? people.map((p) => p.user) : state.crowd || [];
      for (const u of seed.slice(0, maxChars())) spawn(u, false);
      scene.setup?.(w); // nhân vật phụ của địa điểm (bartender, DJ, dancer...)
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
  beatPos += dt * ((currentSong()?.bpm || DEFAULT_BPM) / 60);
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
      const show = c.npc ? Boolean(c.label) : all || now < c.busyUntil || c.viewer?.tier?.rank >= 2 || c.look?.wings || c === cam.target || c.viewer?.id === trollLeader()?.id;
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
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?role=world`);
  ws.onopen = () => (connected = true);
  ws.onclose = () => {
    connected = false;
    setTimeout(connect, 2000);
  };
  ws.onerror = () => ws.close();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.type === 'hello' || msg.type === 'state') applyState(msg.state).then(onFeatures);
    else if (msg.type === 'action') handle(msg.action);
    else if (msg.type === 'boards') state = { ...state, leaderboard: msg.leaderboard };
    else if (msg.type === 'features') {
      state = { ...state, features: msg.features };
      onFeatures();
    }
    else if (msg.type === 'paused') state.paused = msg.paused;
    else if (msg.type === 'remove') {
      const c = chars.get(String(msg.userId));
      if (c && !c.npc) removeChar(c);
    }
  };
}
connect();

function onFeatures() {
  const m = state.features?.music?.now;
  if (m?.serverNow) clockOffset = m.serverNow - Date.now();
  syncMusic();
}

// Cho phép thử nhanh trên trình duyệt: window.world
window.world = { w, handle, cam, get state() { return state; }, get media() { return media; } };
