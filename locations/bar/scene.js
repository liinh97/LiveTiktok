// 🍸 BAR / LOUNGE — phong cách gần đời thực: phòng tối, quầy bar sáng phía sau,
// đám đông là bóng người ngược sáng. Có video/ảnh nền thật (assets/background.*) thì dùng làm nền,
// không có thì tự vẽ nền lounge.

const COUNTER_Y = 960; // mép trên quầy bar
const FAR_Y = 1060; // hàng người xa nhất
const NEAR_Y = 1560; // hàng người gần nhất

// Chỗ đứng cố định: 5 hàng, xa -> gần, so le để không che nhau hoàn toàn
const SPOTS = [];
[
  [FAR_Y, 7],
  [1170, 6],
  [1290, 6],
  [1420, 5],
  [NEAR_Y, 4],
].forEach(([y, n], row) => {
  const margin = 110 - row * 8;
  for (let i = 0; i < n; i++) {
    const x = margin + ((1080 - margin * 2) * (i + (row % 2 ? 0.5 : 0.25))) / (n - (row % 2 ? 0 : 0.5));
    SPOTS.push({ x: Math.min(1020, x + (Math.random() - 0.5) * 40), y: y + (Math.random() - 0.5) * 24 });
  }
});

// Đốm sáng mờ (bokeh) của đèn phía sau, tạo một lần
const BOKEH = Array.from({ length: 34 }, () => ({
  x: Math.random() * 1080,
  y: 260 + Math.random() * 620,
  r: 18 + Math.random() * 46,
  hue: [28, 38, 320, 280, 200][Math.floor(Math.random() * 5)],
  ph: Math.random() * 6,
  sp: 0.2 + Math.random() * 0.5,
}));

const AMBER = [255, 170, 80];
const MAGENTA = [255, 60, 190];

function glow(ctx, x, y, r, c, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${a})`);
  g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/**
 * Tô một bóng người (thân, đầu, tóc) bằng fillStyle hiện tại, toạ độ chân tại (x, y), tỉ lệ s.
 * Mỗi phần tô riêng để chỗ chồng nhau (đầu + búi tóc...) không bị thủng lỗ.
 */
function fillSilhouette(ctx, x, y, s, seed, hdx = 0, hdy = 0) {
  const sh = 40 + seed * 10; // nửa bề rộng vai
  const hipW = 30 + seed * 8;
  const hy = y - 186 * s + hdy * s; // tâm đầu
  const hx = x + hdx * s;
  // thân + vai + cổ
  ctx.beginPath();
  ctx.moveTo(x - hipW * s, y);
  ctx.lineTo(x - (sh - 2) * s, y - 120 * s);
  ctx.quadraticCurveTo(x - sh * s, y - 150 * s, x - 18 * s, y - 156 * s);
  ctx.lineTo(x - 9 * s, y - 168 * s);
  ctx.lineTo(x + 9 * s, y - 168 * s);
  ctx.lineTo(x + 18 * s, y - 156 * s);
  ctx.quadraticCurveTo(x + sh * s, y - 150 * s, x + (sh - 2) * s, y - 120 * s);
  ctx.lineTo(x + hipW * s, y);
  ctx.closePath();
  ctx.fill();
  // đầu
  ctx.beginPath();
  ctx.ellipse(hx, hy, 21 * s, 25 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  // kiểu tóc theo seed
  if (seed > 0.66) {
    // tóc dài xoã vai
    ctx.beginPath();
    ctx.moveTo(hx - 23 * s, hy - 4 * s);
    ctx.quadraticCurveTo(hx - 30 * s, y - 150 * s, x - 22 * s, y - 138 * s);
    ctx.lineTo(x + 22 * s, y - 138 * s);
    ctx.quadraticCurveTo(hx + 30 * s, y - 150 * s, hx + 23 * s, hy - 4 * s);
    ctx.closePath();
    ctx.fill();
  } else if (seed > 0.4) {
    // búi tóc
    ctx.beginPath();
    ctx.arc(hx, hy - 26 * s, 10 * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Vẽ bóng người ngược sáng: phóng to nhẹ một bản màu sáng phía sau rồi phủ bản tối lên trên,
 * chỉ còn lại một viền sáng mỏng quanh rìa giống ảnh chụp ngược sáng thật.
 */
function drawSilhouette(ctx, x, y, s, seed, rim, rimAlpha, extra, hdx = 0, hdy = 0) {
  const cy = y - 110 * s;
  ctx.save();
  ctx.translate(x, cy);
  ctx.scale(1.045, 1.025);
  ctx.translate(-x, -cy);
  ctx.fillStyle = `rgba(${rim[0]},${rim[1]},${rim[2]},${rimAlpha})`;
  ctx.strokeStyle = ctx.fillStyle;
  extra?.();
  fillSilhouette(ctx, x, y - 2 * s, s, seed, hdx, hdy);
  ctx.restore();
  const body = ctx.createLinearGradient(0, y - 210 * s, 0, y);
  body.addColorStop(0, '#140d1a');
  body.addColorStop(1, '#030205');
  ctx.fillStyle = body;
  ctx.strokeStyle = body;
  extra?.();
  fillSilhouette(ctx, x, y, s, seed, hdx, hdy);
}

// ---------------- Đèn trần: giàn đèn tròn, moving head, quả cầu gương ----------------
const TRUSS = { x: 540, y: 205, rx: 430, ry: 62 };
const HEADS = Array.from({ length: 8 }, (_, i) => (i / 8) * Math.PI * 2 + 0.2);
const PALETTE = [[255, 60, 190], [80, 140, 255], [0, 230, 170], [255, 170, 60], [170, 80, 255]];
const BALL = { x: 540, y: 300, r: 42 };
const DOTS = Array.from({ length: 80 }, () => ({ lon: Math.random() * Math.PI * 2, lat: Math.random(), warm: Math.random() < 0.25 }));

function drawTruss(ctx, w, beat) {
  const t = w.t;
  // khung giàn (phía sau rồi phía trước)
  ctx.strokeStyle = 'rgba(150,150,165,0.55)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.ellipse(TRUSS.x, TRUSS.y, TRUSS.rx, TRUSS.ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(90,90,105,0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(TRUSS.x, TRUSS.y + 10, TRUSS.rx, TRUSS.ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const x = TRUSS.x + Math.cos(a) * TRUSS.rx;
    const y = TRUSS.y + Math.sin(a) * TRUSS.ry;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 6, y + 10);
    ctx.stroke();
  }
  // moving head: đổi màu theo đoạn nhạc, quét theo nhịp
  const scene = Math.floor(t / 8); // mỗi 8 giây đổi màu/kiểu quét
  ctx.globalCompositeOperation = 'lighter';
  HEADS.forEach((a0, i) => {
    const hx = TRUSS.x + Math.cos(a0) * TRUSS.rx;
    const hy = TRUSS.y + Math.sin(a0) * TRUSS.ry + 12;
    const col = PALETTE[(scene + (scene % 2 ? i : i % 2)) % PALETTE.length];
    const mode = scene % 3;
    const ang =
      mode === 0
        ? Math.sin(t * 0.9 + i * 0.8) * 0.55 // quét lệch pha
        : mode === 1
          ? Math.sin(t * 0.9) * 0.5 * (i % 2 ? 1 : -1) // bắt chéo
          : (hx - TRUSS.x) / -900 + Math.sin(t * 2.2 + i) * 0.12; // chụm vào giữa
    const len = 1700;
    const ex = hx + Math.sin(ang) * len;
    const ey = hy + Math.cos(ang) * len;
    const g = ctx.createLinearGradient(hx, hy, ex, ey);
    g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${0.3 + beat * 0.15})`);
    g.addColorStop(0.6, `rgba(${col[0]},${col[1]},${col[2]},0.05)`);
    g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
    ctx.fillStyle = g;
    const px = Math.cos(ang) * 70;
    const py = -Math.sin(ang) * 70;
    ctx.beginPath();
    ctx.moveTo(hx - px * 0.08, hy - py * 0.08);
    ctx.lineTo(hx + px * 0.08, hy + py * 0.08);
    ctx.lineTo(ex + px, ey + py);
    ctx.lineTo(ex - px, ey - py);
    ctx.closePath();
    ctx.fill();
    glow(ctx, hx, hy, 22, col, 0.9);
  });
  ctx.globalCompositeOperation = 'source-over';
  // thân đèn
  HEADS.forEach((a0) => {
    const hx = TRUSS.x + Math.cos(a0) * TRUSS.rx;
    const hy = TRUSS.y + Math.sin(a0) * TRUSS.ry;
    ctx.fillStyle = '#1b1b22';
    ctx.fillRect(hx - 9, hy, 18, 14);
  });
}

function drawMirrorBall(ctx, w) {
  const t = w.t;
  const rot = t * 0.7;
  ctx.strokeStyle = 'rgba(170,170,180,0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(BALL.x, 0);
  ctx.lineTo(BALL.x, BALL.y - BALL.r);
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.arc(BALL.x, BALL.y, BALL.r, 0, Math.PI * 2);
  ctx.clip();
  const base = ctx.createRadialGradient(BALL.x - 14, BALL.y - 14, 4, BALL.x, BALL.y, BALL.r);
  base.addColorStop(0, '#d8d8e0');
  base.addColorStop(1, '#2a2a34');
  ctx.fillStyle = base;
  ctx.fillRect(BALL.x - BALL.r, BALL.y - BALL.r, BALL.r * 2, BALL.r * 2);
  // các mảnh gương xoay
  for (let la = -5; la <= 5; la++) {
    const phi = (la / 6) * (Math.PI / 2);
    const ry = BALL.y + Math.sin(phi) * BALL.r;
    const rr = Math.cos(phi) * BALL.r;
    const n = Math.max(5, Math.round(18 * Math.cos(phi)));
    for (let k = 0; k < n; k++) {
      const th = (k / n) * Math.PI * 2 + rot;
      const cz = Math.cos(th);
      if (cz <= 0) continue;
      const tx = BALL.x + Math.sin(th) * rr;
      const flick = Math.sin(k * 12.9 + la * 7.3 + t * 5) > 0.92;
      const v = flick ? 255 : Math.round(90 + 110 * cz);
      ctx.fillStyle = `rgb(${v},${v},${Math.min(255, v + 15)})`;
      ctx.fillRect(tx - 3.2 * cz, ry - 3.2, 6.4 * cz, 6.4);
    }
  }
  ctx.restore();
  ctx.globalCompositeOperation = 'lighter';
  glow(ctx, BALL.x - 12, BALL.y - 12, 26 + Math.sin(t * 7) * 4, [255, 255, 255], 0.55);
  ctx.globalCompositeOperation = 'source-over';
}

/** Đốm sáng từ quả cầu gương trượt ngang khắp phòng khi quả cầu xoay. */
function drawMirrorDots(ctx, w) {
  const rot = w.t * 0.7;
  ctx.globalCompositeOperation = 'lighter';
  for (const d of DOTS) {
    const th = d.lon + rot;
    const cz = Math.cos(th);
    if (cz < 0.15) continue;
    const x = BALL.x + Math.sin(th) * 1150;
    const y = 520 + d.lat * 1250;
    if (x < -20 || x > w.W + 20) continue;
    const r = 5 + 6 * cz;
    const a = 0.45 * cz;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2);
    const c = d.warm ? '255,210,160' : '235,240,255';
    g.addColorStop(0, `rgba(${c},${a})`);
    g.addColorStop(0.45, `rgba(${c},${a * 0.6})`);
    g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 2.2, r * 1.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

// ---------------- Chuyển động của đám đông ----------------
const BPM = 120;
const beatPhase = (t) => (t * BPM) / 60; // số nhịp đã trôi
const pulse = (t, off = 0) => Math.pow(Math.max(0, Math.cos((beatPhase(t) + off) * Math.PI * 2)), 4); // 1 đúng nhịp

// Cử chỉ ngẫu nhiên khi rảnh: [tên, trọng số, thời lượng giây]
const GESTURES = [
  ['sip', 30, [2.5, 4]],
  ['lean', 25, [3, 6]],
  ['fist', 14, [2, 3.5]],
  ['wave', 8, [1.8, 3]],
  ['shuffle', 13, [2, 3]],
  ['handsUp', 10, [2, 3.5]],
];
const GESTURE_SUM = GESTURES.reduce((a, g) => a + g[1], 0);
function randomGesture() {
  let r = Math.random() * GESTURE_SUM;
  for (const g of GESTURES) if ((r -= g[1]) <= 0) return g;
  return GESTURES[0];
}

let nextDrop = 25 + Math.random() * 15; // "drop nhạc": cả quán giơ tay thành làn sóng
let lastT = 0;

/** Trạng thái chuyển động hiện tại của một người: lắc lư, nhún, đầu, tay. */
function motion(c, t) {
  c.style ??= Math.floor(Math.random() * 4); // 0 lắc lư · 1 nhún · 2 gật gù · 3 nhẹ nhàng
  c.energy ??= 0.5 + Math.random() * 0.7;
  c.ph ??= Math.random();
  const e = c.energy;
  const p = pulse(t, c.ph * 0.3);
  const m = { sway: 0, dy: 0, hdx: 0, hdy: 0, left: null, right: null, glass: false };

  if (c.style === 0) m.sway = Math.sin((beatPhase(t) / 2 + c.ph) * Math.PI * 2) * 0.05 * e;
  else if (c.style === 1) m.dy = p * 7 * e;
  else if (c.style === 2) m.hdy = p * 4 * e;
  else m.sway = Math.sin(t * 0.8 + c.ph * 6) * 0.015;

  // Tư thế do hành động đặt (quà, mời cả quán) được ưu tiên
  let g = c.pose ? { type: c.pose === 'cheer' ? 'handsUp' : c.pose, start: 0 } : c.gesture && t < c.gesture.until && t >= c.gesture.start ? c.gesture : null;
  const holding = c.item && t < c.item.until;
  const k = g ? Math.min(1, (t - (g.start || 0)) * 4, g.until ? (g.until - t) * 4 : 1) : 0; // vào/ra mượt
  const up = (side, amp = 1) => {
    const sx = side * 34;
    const sw = Math.sin((beatPhase(t) + c.ph) * Math.PI) * 10 * amp;
    return [[sx + side * 10, -142 - 50 * k], [sx + side * 16 + sw * side, -142 - 112 * k]];
  };
  switch (g?.type) {
    case 'handsUp':
      m.left = up(-1);
      m.right = up(1);
      m.dy += p * 5;
      break;
    case 'dance':
      m.dy += p * 9;
      m.sway += Math.sin(beatPhase(t) * Math.PI) * 0.07;
      if (Math.floor(beatPhase(t)) % 2) m.left = up(-1, 0.6);
      else m.right = up(1, 0.6);
      break;
    case 'fist': {
      const pump = p * 22;
      m.right = [[44, -150 - 40 * k], [40, -150 - (85 + pump) * k]];
      break;
    }
    case 'wave': {
      const osc = Math.sin(t * 9) * 16;
      m.right = [[44, -150 - 40 * k], [50 + osc * k, -150 - 98 * k]];
      break;
    }
    case 'sip': {
      // nâng ly lên miệng rồi hạ xuống
      const lift = Math.sin(Math.min(1, (t - g.start) / (g.until - g.start)) * Math.PI);
      m.right = [[42, -100 - 10 * lift], [26 - 12 * lift, -112 - 58 * lift]];
      m.hdy -= lift * 3;
      m.glass = true;
      break;
    }
    case 'lean':
      m.sway += (c.leanDir || 1) * 0.06 * k;
      m.hdx = (c.leanDir || 1) * 6 * k;
      break;
  }
  if (!m.right && holding) {
    m.right = [[46, -95], [30, -115]];
    m.glass = !c.item.e; // có emoji thì engine tự vẽ đồ cầm
  }
  return m;
}

function drawArm(ctx, x, y, s, side, arm) {
  ctx.moveTo(x + side * 34 * s, y - 142 * s);
  ctx.lineTo(x + arm[0][0] * s, y + arm[0][1] * s);
  ctx.lineTo(x + arm[1][0] * s, y + arm[1][1] * s);
}

/** Ly cocktail dạng bóng tối ở tay phải. */
function drawGlass(ctx, x, y, s, arm) {
  const gx = x + arm[1][0] * s;
  const gy = y + arm[1][1] * s - 6 * s;
  ctx.beginPath();
  ctx.moveTo(gx - 10 * s, gy - 14 * s);
  ctx.lineTo(gx + 10 * s, gy - 14 * s);
  ctx.lineTo(gx, gy - 2 * s);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(gx - 1 * s, gy - 2 * s, 2 * s, 9 * s);
}

export default {
  maxChars: 24,
  charHeight: 212,
  stageFloorY: 1620,
  spots: SPOTS,
  source: { x: 540, y: COUNTER_Y - 30 },
  scaleAt: (y) => 0.62 + ((y - FAR_Y) / (NEAR_Y - FAR_Y)) * 0.58,
  wander: () => null,

  /** Engine gọi mỗi khung hình: cho đám đông tự cử động khi không ai tương tác. */
  update(w, dt) {
    const t = w.t;
    if (t < lastT) nextDrop = t + 25 + Math.random() * 15; // vừa vào cảnh lại
    lastT = t;
    for (const c of w.chars) {
      if (c.gesture && t > c.gesture.until) {
        if (c.gesture.type === 'shuffle') w.goHome(c);
        c.gesture = null;
      }
      if (c.gesture || c.pose || c.viewer) continue;
      if (Math.random() < dt * 0.07) {
        const [type, , [a, b]] = randomGesture();
        c.gesture = { type, start: t, until: t + a + Math.random() * (b - a) };
        if (type === 'lean') c.leanDir = Math.random() < 0.5 ? -1 : 1;
        if (type === 'shuffle') w.moveTo(c, c.home.x + (Math.random() - 0.5) * 50, c.home.y + (Math.random() - 0.5) * 16);
      }
    }
    // Drop nhạc: giơ tay lan từ trái sang phải, đèn loé theo
    if (t > nextDrop) {
      nextDrop = t + 35 + Math.random() * 20;
      for (const c of w.chars) {
        if (c.pose) continue;
        const start = t + (c.x / w.W) * 1.2;
        c.gesture = { type: 'handsUp', start, until: start + 3.5 + Math.random() };
      }
      w.fx.flash({ alpha: 0.18, ms: 400 });
      w.fx.wash({ color: MAGENTA, ms: 4000, alpha: 0.14 });
    }
  },

  background(ctx, w) {
    const { W, H } = w;
    const t = w.t;
    const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2)), 8); // nhịp ~120 BPM

    if (!w.hasMedia) {
      // Tường tối
      const wall = ctx.createLinearGradient(0, 0, 0, H);
      wall.addColorStop(0, '#07050c');
      wall.addColorStop(0.4, '#1a0f22');
      wall.addColorStop(0.55, '#140b1a');
      wall.addColorStop(1, '#050307');
      ctx.fillStyle = wall;
      ctx.fillRect(0, 0, W, H);

      // Kệ rượu sau quầy: đèn LED hổ phách hắt từ dưới kệ
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 3; k++) {
        const sy = 560 + k * 120;
        const led = ctx.createLinearGradient(0, sy - 90, 0, sy);
        led.addColorStop(0, 'rgba(255,150,60,0)');
        led.addColorStop(1, 'rgba(255,150,60,0.28)');
        ctx.fillStyle = led;
        ctx.fillRect(90, sy - 90, W - 180, 90);
        ctx.fillStyle = 'rgba(255,190,120,0.55)';
        ctx.fillRect(90, sy, W - 180, 3);
      }
      ctx.globalCompositeOperation = 'source-over';
      // chai rượu (bóng tối, viền sáng)
      for (let k = 0; k < 3; k++) {
        const sy = 560 + k * 120;
        for (let i = 0; i < 15; i++) {
          const bx = 115 + i * 58 + (k % 2) * 18;
          const bh = 54 + ((i * 7 + k * 3) % 5) * 7;
          ctx.fillStyle = '#0b0710';
          ctx.beginPath();
          ctx.roundRect(bx, sy - bh, 22, bh, [6, 6, 2, 2]);
          ctx.fill();
          ctx.fillRect(bx + 7, sy - bh - 16, 8, 18);
          ctx.fillStyle = `hsla(${(i * 37 + k * 50) % 360},70%,60%,0.35)`;
          ctx.fillRect(bx + 3, sy - bh + 8, 3, bh - 14);
        }
      }

      // Đốm sáng mờ phía sau (bokeh)
      ctx.globalCompositeOperation = 'lighter';
      for (const b of BOKEH) {
        const a = 0.1 + 0.08 * Math.sin(t * b.sp + b.ph);
        const g = ctx.createRadialGradient(b.x, b.y, b.r * 0.55, b.x, b.y, b.r);
        g.addColorStop(0, `hsla(${b.hue},90%,65%,${a})`);
        g.addColorStop(0.85, `hsla(${b.hue},90%,65%,${a * 0.9})`);
        g.addColorStop(1, `hsla(${b.hue},90%,65%,0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(b.x + Math.sin(t * 0.1 + b.ph) * 8, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      // Biển neon
      const flicker = Math.sin(t * 17) > 0.985 ? 0.35 : 1;
      ctx.save();
      ctx.shadowColor = 'rgb(255,60,190)';
      ctx.shadowBlur = 38 * flicker;
      ctx.font = 'italic 300 104px "Segoe Script", "Brush Script MT", "Snell Roundhand", cursive';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(255,150,225,${flicker})`;
      ctx.fillText('Neon Lounge', W / 2, 415);
      ctx.restore();

      // Bartender đứng sau quầy (quầy che nửa người dưới)
      drawSilhouette(ctx, 540 + Math.sin(t * 0.7) * 60, COUNTER_Y + 120, 0.82, 0.2, [255, 170, 80], 0.5);

      // Quầy bar: mặt quầy bóng loáng + đèn hắt dưới mép
      const top = ctx.createLinearGradient(0, COUNTER_Y - 14, 0, COUNTER_Y + 10);
      top.addColorStop(0, '#2a1c16');
      top.addColorStop(1, '#0d0806');
      ctx.fillStyle = top;
      ctx.fillRect(0, COUNTER_Y - 14, W, 24);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,190,120,0.5)';
      ctx.fillRect(0, COUNTER_Y - 14, W, 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#08050a';
      ctx.fillRect(0, COUNTER_Y + 10, W, 120);

      // Sàn tối phản chiếu ánh đèn
      const floor = ctx.createLinearGradient(0, COUNTER_Y + 130, 0, H);
      floor.addColorStop(0, '#0e0814');
      floor.addColorStop(1, '#020103');
      ctx.fillStyle = floor;
      ctx.fillRect(0, COUNTER_Y + 130, W, H);
    } else {
      // Có video/ảnh thật: phủ tối dần xuống dưới để bóng người và chữ nổi bật
      const shade = ctx.createLinearGradient(0, 0, 0, H);
      shade.addColorStop(0, 'rgba(0,0,0,0.15)');
      shade.addColorStop(0.5, 'rgba(0,0,0,0.25)');
      shade.addColorStop(1, 'rgba(0,0,0,0.75)');
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, W, H);
    }

    // Giàn đèn tròn trên trần + đèn moving head quét + quả cầu gương xoay (cả hai chế độ)
    drawTruss(ctx, w, beat);
    drawMirrorBall(ctx, w);
    ctx.globalCompositeOperation = 'lighter';
    const haze = ctx.createLinearGradient(0, 700, 0, 1500);
    haze.addColorStop(0, 'rgba(120,80,160,0)');
    haze.addColorStop(0.5, `rgba(120,80,160,${0.07 + beat * 0.03})`);
    haze.addColorStop(1, 'rgba(120,80,160,0)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, 700, W, 800);
    ctx.globalCompositeOperation = 'source-over';
  },

  /** Bóng người ngược sáng; đang diễn cho người xem thì viền sáng theo màu cấp VIP. */
  drawBody(ctx, w, c, { x, y, s, lit }) {
    if (lit) {
      ctx.globalCompositeOperation = 'lighter';
      glow(ctx, x, y - 120 * s, 130 * s, w.rgb(lit), 0.35);
      ctx.globalCompositeOperation = 'source-over';
    }
    const m = motion(c, w.t);
    const fy = y - m.dy * s;
    const rim = lit ? w.rgb(lit) : c.seed > 0.5 ? [255, 170, 110] : [230, 120, 220];
    const extra = () => {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 14 * s;
      ctx.beginPath();
      if (m.left) drawArm(ctx, x, fy, s, -1, m.left);
      if (m.right) drawArm(ctx, x, fy, s, 1, m.right);
      ctx.stroke();
      if (m.glass && m.right) drawGlass(ctx, x, fy, s, m.right);
    };
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(m.sway);
    ctx.translate(-x, -y);
    drawSilhouette(ctx, x, fy, s, c.seed, rim, lit ? 0.95 : 0.22, extra, m.hdx, m.hdy);
    ctx.restore();
  },

  // Mép bàn phía trước + ánh nến: tạo chiều sâu
  foreground(ctx, w) {
    const { W, H } = w;
    drawMirrorDots(ctx, w); // đốm sáng từ quả cầu gương rơi lên cả người đứng
    const g = ctx.createLinearGradient(0, 1700, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.4, 'rgba(0,0,0,0.85)');
    g.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 1700, W, H - 1700);
    ctx.globalCompositeOperation = 'lighter';
    for (const [x, ph] of [
      [170, 0],
      [880, 2],
    ]) {
      glow(ctx, x, 1800, 70 + Math.sin(w.t * 9 + ph) * 4, AMBER, 0.35);
    }
    ctx.globalCompositeOperation = 'source-over';
  },

  actions: {
    // Quà vừa: đèn rọi + nhảy (mặc định) + phủ màu cả quán theo màu cấp
    gift_medium(w, a, d) {
      d.gift_medium(w, a);
      w.fx.wash({ color: w.rgb(a.user.tier.color, MAGENTA), ms: 2500, alpha: 0.12 });
    },

    // Quà lớn: "bottle service" — chai rượu cắm pháo sáng được mang từ quầy tới người tặng
    gift_big(w, a, d) {
      const c = w.charFor(a.user, 9000);
      if (!c) return;
      const from = { x: 540, y: COUNTER_Y - 40 };
      const dur = 2200;
      w.fx.custom(dur, (ctx, p) => {
        const e = w.ease(p);
        const to = w.chest(c);
        const x = from.x + (to.x - from.x) * e;
        const y = from.y + (to.y - 60 - from.y) * e - Math.sin(Math.PI * p) * 120;
        w.emoji('🍾', x, y, 64);
        w.fx.sparkBurst(x, y - 34, { n: 5, speed: 260, color: [255, 225, 150] });
      });
      setTimeout(() => d.gift_big(w, a), dur - 300);
      return 7000;
    },

    // Quà khủng: mặc định (laser, khói CO2, pháo sáng, kim tuyến) + cả quán nâng ly
    gift_huge(w, a, d) {
      const dur = d.gift_huge(w, a);
      for (const o of w.chars) w.hold(o, '🥂', 7000);
      return dur;
    },

    // Chọn nhạc: cột sóng nhạc nháy trên tường
    request_song(w, a, d) {
      d.request_song(w, a);
      w.fx.custom(4500, (ctx, p, t) => {
        ctx.globalCompositeOperation = 'lighter';
        const fade = Math.min(1, p * 6, (1 - p) * 4);
        for (let i = 0; i < 24; i++) {
          const h = (0.3 + 0.7 * Math.abs(Math.sin(t * 7 + i * 0.6) * Math.cos(t * 3 + i))) * 120;
          ctx.fillStyle = `hsla(${280 + i * 3},90%,60%,${0.55 * fade})`;
          ctx.fillRect(160 + i * 32, 470 - h, 22, h);
        }
        ctx.globalCompositeOperation = 'source-over';
      }, 'under');
    },
  },
};
