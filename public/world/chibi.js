// NHÂN VẬT CHIBI tự sinh: từ một con số "style" ra kiểu tóc, màu tóc, áo, quần, phụ kiện, nét mặt.
// Có ảnh đại diện TikTok thì dùng làm khuôn mặt. Mỗi nhân vật được vẽ sẵn thành ảnh một lần (sprite),
// mỗi khung hình chỉ dán ảnh nên vẽ được hàng trăm nhân vật cùng lúc.
//
// Toạ độ sprite: rộng 100, cao 140 (đơn vị gốc), chân ở (50, 138).

export const SPRITE_W = 100;
export const SPRITE_H = 140;
export const FOOT_Y = 138;
export const SHOULDER_Y = 84; // vai (để vẽ tay mỗi khung hình)
export const HEAD_Y = 46; // tâm đầu
export const HEAD_R = 31;

const SKIN = ['#ffe3cf', '#f8d2b4', '#efbd96', '#d39a72', '#a8704c'];
const HAIR = ['#1d1b20', '#2b2421', '#4a2c1c', '#7a4a28', '#c89448', '#efd9a6', '#b8382d', '#3d5da8', '#d667a8', '#9aa0a6', '#5ec2b5'];
const OUTFIT = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#00897b', '#039be5', '#3949ab', '#8e24aa', '#d81b60', '#f4f4f4', '#263238', '#795548'];
const PANTS = ['#263238', '#37474f', '#1a237e', '#4e342e', '#424242', '#283593'];
const HAIRSTYLES = ['short', 'spiky', 'long', 'bun', 'twin', 'bowl', 'cap', 'mohawk'];
const ACCESSORY = ['none', 'none', 'none', 'glasses', 'headphones', 'bow', 'shades'];
const FACES = ['dot', 'happy', 'wink', 'cat', 'surprised'];

function rng(seed) {
  let a = (seed | 0) + 0x6d2b79f5;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pickFrom = (r, list) => list[Math.floor(r() * list.length)];

/** Các bộ phận của nhân vật từ số style (cùng style -> cùng nhân vật). */
export function partsOf(style) {
  const r = rng(style);
  return {
    skin: pickFrom(r, SKIN),
    hair: pickFrom(r, HAIR),
    hairStyle: pickFrom(r, HAIRSTYLES),
    outfit: pickFrom(r, OUTFIT),
    outfit2: pickFrom(r, OUTFIT),
    pants: pickFrom(r, PANTS),
    accessory: pickFrom(r, ACCESSORY),
    face: pickFrom(r, FACES),
    shirt: pickFrom(r, ['plain', 'stripe', 'collar', 'heart']),
  };
}

/** Vẽ sẵn nhân vật thành ảnh. res: độ nét (1 = 100x140 px). avatar: ảnh đại diện đã tải (hoặc null). */
export function renderChibi(parts, avatar, res = 1.25) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(SPRITE_W * res);
  c.height = Math.ceil(SPRITE_H * res);
  const g = c.getContext('2d');
  g.scale(res, res);
  const hx = 50;
  const hy = HEAD_Y;

  // bóng dưới chân
  g.fillStyle = 'rgba(0,0,0,.35)';
  g.beginPath();
  g.ellipse(50, 136, 20, 4, 0, 0, Math.PI * 2);
  g.fill();

  // chân + giày
  g.fillStyle = parts.pants;
  g.beginPath();
  g.roundRect(38, 108, 10, 24, 4);
  g.roundRect(52, 108, 10, 24, 4);
  g.fill();
  g.fillStyle = '#f5f5f5';
  g.beginPath();
  g.ellipse(42, 133, 8, 4.5, 0, 0, Math.PI * 2);
  g.ellipse(58, 133, 8, 4.5, 0, 0, Math.PI * 2);
  g.fill();

  // thân áo
  g.fillStyle = parts.outfit;
  g.beginPath();
  g.roundRect(31, 74, 38, 40, [14, 14, 8, 8]);
  g.fill();
  g.fillStyle = parts.outfit2;
  if (parts.shirt === 'stripe') {
    g.fillRect(31, 88, 38, 5);
    g.fillRect(31, 99, 38, 5);
  } else if (parts.shirt === 'collar') {
    g.beginPath();
    g.moveTo(42, 74);
    g.lineTo(50, 84);
    g.lineTo(58, 74);
    g.closePath();
    g.fill();
  } else if (parts.shirt === 'heart') {
    g.font = '14px sans-serif';
    g.textAlign = 'center';
    g.fillText('♥', 50, 98);
  }

  // tóc phía sau đầu
  g.fillStyle = parts.hair;
  hairBack(g, parts.hairStyle, hx, hy);

  // đầu
  g.fillStyle = parts.skin;
  g.beginPath();
  g.arc(hx, hy, HEAD_R, 0, Math.PI * 2);
  g.fill();

  if (avatar) {
    // ảnh đại diện làm khuôn mặt, viền da + tóc ôm phía trên
    g.save();
    g.beginPath();
    g.arc(hx, hy + 2, HEAD_R - 4, 0, Math.PI * 2);
    g.clip();
    g.drawImage(avatar, hx - HEAD_R + 4, hy + 2 - HEAD_R + 4, (HEAD_R - 4) * 2, (HEAD_R - 4) * 2);
    g.restore();
    g.fillStyle = parts.hair;
    g.beginPath();
    g.arc(hx, hy, HEAD_R + 1, Math.PI * 1.08, Math.PI * 1.92);
    g.arc(hx, hy + 2, HEAD_R - 4, Math.PI * 1.9, Math.PI * 1.1, true);
    g.closePath();
    g.fill();
  } else {
    face(g, parts, hx, hy);
    g.fillStyle = parts.hair;
    hairFront(g, parts.hairStyle, hx, hy);
  }
  accessory(g, parts, hx, hy, Boolean(avatar));
  return c;
}

function hairBack(g, style, x, y) {
  g.beginPath();
  if (style === 'long') {
    g.roundRect(x - 35, y - 20, 70, 62, 22);
  } else if (style === 'twin') {
    g.arc(x - 34, y + 6, 12, 0, Math.PI * 2);
    g.arc(x + 34, y + 6, 12, 0, Math.PI * 2);
  } else if (style === 'bun') {
    g.arc(x, y - 34, 13, 0, Math.PI * 2);
  }
  g.fill();
  g.beginPath();
  g.arc(x, y - 2, HEAD_R + 3, Math.PI, 0);
  g.fill();
}

function hairFront(g, style, x, y) {
  g.beginPath();
  if (style === 'spiky') {
    g.moveTo(x - 33, y - 4);
    for (let i = 0; i <= 6; i++) g.lineTo(x - 33 + i * 11, y - (i % 2 ? 44 : 22));
    g.lineTo(x + 33, y - 4);
  } else if (style === 'bowl') {
    g.arc(x, y - 2, HEAD_R + 3, Math.PI, 0);
    g.lineTo(x + 33, y + 2);
    g.lineTo(x - 33, y + 2);
  } else if (style === 'mohawk') {
    g.roundRect(x - 7, y - 46, 14, 26, 6);
    g.arc(x, y - 6, HEAD_R + 1, Math.PI * 1.15, Math.PI * 1.85);
  } else if (style === 'cap') {
    g.arc(x, y - 6, HEAD_R + 3, Math.PI, 0);
    g.closePath();
    g.fill();
    g.beginPath();
    g.ellipse(x + 14, y - 7, 26, 6, 0, 0, Math.PI * 2);
  } else {
    // mái ngang
    g.arc(x, y - 4, HEAD_R + 2, Math.PI * 1.02, Math.PI * 1.98);
    g.quadraticCurveTo(x + 10, y - 10, x - 2, y - 16);
    g.quadraticCurveTo(x - 14, y - 6, x - 32, y - 2);
  }
  g.closePath();
  g.fill();
}

function face(g, parts, x, y) {
  const ey = y + 4;
  g.fillStyle = '#2b2b2b';
  g.strokeStyle = '#2b2b2b';
  g.lineWidth = 2.4;
  g.lineCap = 'round';
  if (parts.face === 'happy' || parts.face === 'cat') {
    g.beginPath();
    g.arc(x - 11, ey + 2, 5, Math.PI * 1.15, Math.PI * 1.85);
    g.moveTo(x + 16, ey);
    g.arc(x + 11, ey + 2, 5, Math.PI * 1.15, Math.PI * 1.85);
    g.stroke();
  } else if (parts.face === 'wink') {
    g.beginPath();
    g.arc(x - 11, ey, 4, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(x + 6, ey);
    g.lineTo(x + 16, ey);
    g.stroke();
  } else {
    g.beginPath();
    g.arc(x - 11, ey, 4.2, 0, Math.PI * 2);
    g.arc(x + 11, ey, 4.2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(x - 9.8, ey - 1.4, 1.4, 0, Math.PI * 2);
    g.arc(x + 12.2, ey - 1.4, 1.4, 0, Math.PI * 2);
    g.fill();
  }
  // má hồng
  g.fillStyle = 'rgba(255,120,140,.45)';
  g.beginPath();
  g.ellipse(x - 18, ey + 9, 5, 3, 0, 0, Math.PI * 2);
  g.ellipse(x + 18, ey + 9, 5, 3, 0, 0, Math.PI * 2);
  g.fill();
  // miệng
  g.strokeStyle = '#7a2b2b';
  g.beginPath();
  if (parts.face === 'surprised') {
    g.fillStyle = '#7a2b2b';
    g.ellipse(x, ey + 13, 3.5, 4.5, 0, 0, Math.PI * 2);
    g.fill();
  } else if (parts.face === 'cat') {
    g.moveTo(x - 6, ey + 11);
    g.quadraticCurveTo(x - 3, ey + 15, x, ey + 11);
    g.quadraticCurveTo(x + 3, ey + 15, x + 6, ey + 11);
    g.stroke();
  } else {
    g.arc(x, ey + 9, 6, Math.PI * 0.15, Math.PI * 0.85);
    g.stroke();
  }
}

function accessory(g, parts, x, y, hasAvatar) {
  const a = parts.accessory;
  if (a === 'headphones') {
    g.strokeStyle = '#222';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(x, y - 2, HEAD_R + 3, Math.PI * 1.05, Math.PI * 1.95);
    g.stroke();
    g.fillStyle = parts.outfit2;
    g.beginPath();
    g.roundRect(x - HEAD_R - 6, y - 6, 9, 16, 4);
    g.roundRect(x + HEAD_R - 3, y - 6, 9, 16, 4);
    g.fill();
  } else if (a === 'bow') {
    g.fillStyle = '#ff4f9a';
    g.beginPath();
    g.moveTo(x + 18, y - 26);
    g.lineTo(x + 8, y - 34);
    g.lineTo(x + 8, y - 18);
    g.closePath();
    g.moveTo(x + 18, y - 26);
    g.lineTo(x + 28, y - 34);
    g.lineTo(x + 28, y - 18);
    g.closePath();
    g.fill();
  } else if (!hasAvatar && (a === 'glasses' || a === 'shades')) {
    g.strokeStyle = '#222';
    g.lineWidth = 2;
    g.fillStyle = a === 'shades' ? '#111' : 'rgba(255,255,255,0.15)';
    g.beginPath();
    g.roundRect(x - 19, y - 2, 15, 11, 4);
    g.roundRect(x + 4, y - 2, 15, 11, 4);
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(x - 4, y + 2);
    g.lineTo(x + 4, y + 2);
    g.stroke();
  }
}

/** Tay vẽ mỗi khung hình (để giơ tay, vẫy, nhảy). x, y: chân nhân vật; s: tỉ lệ. */
export function drawArms(ctx, x, y, s, parts, pose, t, seed) {
  const sy = y - (FOOT_Y - SHOULDER_Y) * s;
  const lx = x - 17 * s;
  const rx = x + 17 * s;
  let L;
  let R;
  if (pose === 'cheer') {
    const w = Math.sin(t * 8 + seed * 6) * 6 * s;
    L = [lx - 12 * s + w, sy - 40 * s];
    R = [rx + 12 * s - w, sy - 40 * s];
  } else if (pose === 'dance') {
    const k = Math.sin(t * 6 + seed * 6);
    L = [lx - 16 * s, sy - (k > 0 ? 34 : 4) * s];
    R = [rx + 16 * s, sy - (k > 0 ? 4 : 34) * s];
  } else if (pose === 'wave') {
    L = [lx - 6 * s, sy + 26 * s];
    R = [rx + 14 * s + Math.sin(t * 10) * 7 * s, sy - 36 * s];
  } else {
    const k = Math.sin(t * 4 + seed * 6) * 2 * s;
    L = [lx - 6 * s, sy + 24 * s + k];
    R = [rx + 6 * s, sy + 24 * s - k];
  }
  ctx.lineCap = 'round';
  ctx.strokeStyle = parts.outfit;
  ctx.lineWidth = 8 * s;
  ctx.beginPath();
  ctx.moveTo(lx, sy);
  ctx.lineTo(L[0], L[1]);
  ctx.moveTo(rx, sy);
  ctx.lineTo(R[0], R[1]);
  ctx.stroke();
  ctx.fillStyle = parts.skin;
  ctx.beginPath();
  ctx.arc(L[0], L[1], 4.5 * s, 0, Math.PI * 2);
  ctx.arc(R[0], R[1], 4.5 * s, 0, Math.PI * 2);
  ctx.fill();
}

/** Đôi cánh thiên thần phát sáng xanh (lệnh "Huy hiệu + cánh"). */
export function drawWings(ctx, x, y, s, t) {
  const cy = y - 80 * s;
  const flap = Math.sin(t * 6) * 0.18;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(x + side * 10 * s, cy);
    ctx.rotate(side * (0.15 + flap));
    ctx.scale(side * s, s);
    const g = ctx.createLinearGradient(0, -40, 70, 20);
    g.addColorStop(0, 'rgba(120,220,255,0.95)');
    g.addColorStop(1, 'rgba(40,120,255,0.15)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(30, -55, 78, -42);
    ctx.quadraticCurveTo(62, -28, 72, -18);
    ctx.quadraticCurveTo(52, -10, 62, 2);
    ctx.quadraticCurveTo(40, 4, 46, 16);
    ctx.quadraticCurveTo(20, 14, 0, 10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/** Thẻ tên vẽ sẵn: [huy hiệu] tên, viền màu cấp VIP. */
export function renderTag(name, color, rank, badge, font) {
  const size = 22;
  const c = document.createElement('canvas');
  const g0 = c.getContext('2d');
  g0.font = `700 ${size}px ${font}`;
  const tw = Math.min(g0.measureText(name).width, 240);
  const pad = badge ? 34 : 12;
  c.width = Math.ceil(tw + pad + 14);
  c.height = 34;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(8,8,16,.72)';
  g.beginPath();
  g.roundRect(1, 1, c.width - 2, 32, 16);
  g.fill();
  if (rank >= 1) {
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.stroke();
  }
  if (badge) {
    g.font = `20px ${font}`;
    g.textBaseline = 'middle';
    g.fillText('🏅', 8, 18);
  }
  g.font = `700 ${size}px ${font}`;
  g.textBaseline = 'middle';
  g.fillStyle = rank >= 1 ? color : '#fff';
  g.fillText(name, pad, 18, 240);
  return c;
}
