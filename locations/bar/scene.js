// 🍸 BAR / LOUNGE — phong cách gần đời thực: phòng tối, quầy bar sáng phía sau,
// đám đông là bóng người ngược sáng. Có video/ảnh nền thật (assets/background.*) thì dùng làm nền,
// không có thì tự vẽ nền lounge.

const COUNTER_Y = 960; // mép trên quầy bar
const FAR_Y = 1050; // hàng người xa nhất
const NEAR_Y = 1720; // hàng người gần nhất
const scaleAt = (y) => 0.5 + ((y - FAR_Y) / (NEAR_Y - FAR_Y)) * 0.55;

// Chỗ đứng cho đám đông chibi: lưới so le, xa thì dày + nhỏ, gần thì thưa + to (~320 chỗ)
const SPOTS = [];
for (let y = FAR_Y, row = 0; y <= NEAR_Y; row++) {
  const s = scaleAt(y);
  const gap = 58 * s;
  for (let x = 40 + (row % 2) * gap * 0.5; x <= 1040; x += gap) {
    SPOTS.push({ x: x + (Math.random() - 0.5) * gap * 0.4, y: y + (Math.random() - 0.5) * 8 });
  }
  y += 34 * s;
}

// Đường đi vòng quanh quán (lệnh "Đi vòng")
const WALK = [
  { x: 70, y: 1700 },
  { x: 70, y: 1080 },
  { x: 540, y: 1040 },
  { x: 1010, y: 1080 },
  { x: 1010, y: 1700 },
  { x: 540, y: 1740 },
];

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

// ---------------- Màn LED sau quầy: nhạc đang phát, hàng chờ, quầy pha chế, chữ chạy hướng dẫn ----------------
const LED = { x: 100, y: 590, w: 880, h: 220 };

function drawLed(ctx, w, beat) {
  const { x, y, w: lw, h } = LED;
  const f = w.features;
  ctx.save();
  ctx.fillStyle = 'rgba(6,4,14,0.92)';
  ctx.beginPath();
  ctx.roundRect(x, y, lw, h, 14);
  ctx.fill();
  ctx.shadowColor = 'rgb(255,60,190)';
  ctx.shadowBlur = 16 + beat * 10;
  ctx.strokeStyle = 'rgba(255,90,200,0.9)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
  // vân điểm ảnh của màn LED
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  for (let yy = y + 6; yy < y + h; yy += 6) ctx.fillRect(x + 4, yy, lw - 8, 1);

  const led = (t, tx, ty, size, color, align = 'left', maxWidth) =>
    w.text(t, tx, ty, { size, color, align, stroke: null, weight: 800, maxWidth });

  // Bên trái: nhạc
  const m = f.music;
  const mx = x + 22;
  led('♪ ĐANG PHÁT', mx, y + 26, 20, '#ce93d8');
  // cột sóng nhạc nháy theo nhịp
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 10; i++) {
    const hh = 6 + Math.abs(Math.sin(w.beat * Math.PI + i * 0.9)) * 18 * (0.5 + beat * 0.5);
    ctx.fillStyle = `hsla(${280 + i * 8},90%,65%,0.8)`;
    ctx.fillRect(mx + 150 + i * 9, y + 34 - hh, 6, hh);
  }
  ctx.globalCompositeOperation = 'source-over';
  if (m?.now) {
    led(m.now.title, mx, y + 64, 32, '#fff', 'left', 420);
    led(m.now.by ? `do ${m.now.by} chọn` : m.now.artist || '', mx, y + 96, 20, '#b39ddb', 'left', 420);
    (m.queue || []).slice(0, 2).forEach((q, i) => {
      led(`${q.priority ? '⏩' : `${i + 1}.`} ${q.title}  👍${q.votes}`, mx, y + 128 + i * 28, 20, '#e1bee7', 'left', 420);
    });
    if (!m.queue?.length) led('Gõ !nhac <số> để chọn bài', mx, y + 128, 20, '#9575cd');
  } else {
    led('Chưa có nhạc', mx, y + 64, 28, '#9e9e9e');
  }

  // Bên phải: quầy pha chế
  const o = f.orders;
  const ox = x + lw / 2 + 20;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(x + lw / 2, y + 14, 2, h - 52);
  led('🧋 QUẦY PHA CHẾ', ox, y + 26, 20, '#ffcc80');
  if (o?.queue?.length) {
    o.queue.slice(0, 4).forEach((q, i) => led(`${q.emoji} ${q.name}`, ox, y + 60 + i * 30, 22, i ? '#ffe0b2' : '#fff', 'left', 380));
    if (o.waiting > 4) led(`+${o.waiting - 4} đơn nữa`, ox, y + 180, 18, '#bcaaa4');
  } else if (o) {
    led('Gõ !goi <món> nha', ox, y + 60, 22, '#ffe0b2');
    led(o.menu.slice(0, 6).map((m2) => m2.emoji).join(' '), ox, y + 98, 26, '#fff');
  }

  // Chữ chạy hướng dẫn
  const dancerCmd = (w.state.location?.commands || []).find((c) => /dancer/i.test(c.label));
  const tips = [
    '🧋 !goi <món> gọi đồ',
    '🎵 !nhac <số> chọn bài · !vote <số>',
    '🥧 Tặng quà rồi !nem <tên> ném bánh kem',
    '🍹 Tặng quà rồi !moi <tên> mời nước',
    '🤡 !troll <tên> + tặng quà: quà càng to troll càng nặng',
    '🛡️ !khien + tặng quà: chống troll, dội ngược',
    '🕺 !nhay ga · sau · tpose · ngao · deo (miễn phí)',
    dancerCmd ? `🐔 Tặng ${dancerCmd.gift} để gọi dancer` : null,
  ].filter(Boolean);
  const msg = tips.join('     ★     ') + '     ★     ';
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 8, y + h - 34, lw - 16, 30);
  ctx.clip();
  ctx.font = `800 20px "Segoe UI", Arial, sans-serif`;
  const mw = ctx.measureText(msg).width;
  const off = (w.t * 90) % mw;
  for (let k = 0; k < 3; k++) led(msg, x + 12 - off + k * mw, y + h - 19, 20, '#80deea');
  ctx.restore();
}

// Bồi bàn: mang đồ từ quầy tới tận người gọi (2 người, đông quá thì cho đồ bay thẳng)
const deliveries = [];
const busyWaiters = new Set();
function deliver(target, emoji, onHand) {
  deliveries.push({ target, emoji, onHand });
}
function runWaiters(w) {
  for (const id of ['waiter1', 'waiter2']) {
    if (busyWaiters.has(id) || !deliveries.length) continue;
    const wt = w.npc(id);
    if (!wt) return;
    const d = deliveries.shift();
    if (!w.chars.includes(d.target)) continue;
    busyWaiters.add(id);
    wt.item = { e: d.emoji, until: Infinity };
    const s = w.scaleOf(d.target);
    w.walk(wt, [{ x: w.clamp(d.target.x + (wt.home.x < 540 ? -50 : 50) * s, 40, w.W - 40), y: d.target.y + 8 }], {
      speed: 1.7,
      onDone: () => {
        wt.item = null;
        d.onHand();
        setTimeout(() => w.walk(wt, [wt.home], { speed: 1.7, onDone: () => busyWaiters.delete(id) }), 500);
      },
    });
  }
  // quá đông: đồ bay thẳng tới, không chờ bồi bàn
  while (deliveries.length > 6) {
    const d = deliveries.shift();
    w.fly(d.emoji, { x: 540, y: COUNTER_Y - 30 }, w.chest(d.target), { size: 48, onArrive: d.onHand });
  }
}

const DANCER_SPOTS = [
  { x: 330, y: COUNTER_Y - 4 },
  { x: 760, y: COUNTER_Y - 4 },
  { x: 960, y: COUNTER_Y - 4 },
];

// "Drop nhạc": khoảng 35-55 giây một lần cả quán cùng làm một động tác
// (giơ tay thành làn sóng trái sang phải, nhảy tưng tưng, hoặc vỗ tay trên đầu)
let nextDrop = 25 + Math.random() * 15;
let lastT = 0;

export default {
  maxChars: 250,
  stageFloorY: 1640,
  bannerY: 830, // dưới màn LED
  spots: SPOTS,
  entrance: { x: 1140, y: 1500 },
  walkPath: WALK,
  source: { x: 540, y: COUNTER_Y - 30 },
  scaleAt,
  // Điểm nhấn cho camera tự lia: bàn DJ, giàn đèn trần, quầy bar, giữa đám đông
  camPoints: {
    dj: { x: 190, y: COUNTER_Y - 70 },
    ceiling: { x: 540, y: 300 },
    stage: { x: 540, y: COUNTER_Y - 40 },
    crowd: { x: 540, y: 1360 },
  },

  /** Nhân vật phụ: bartender, DJ, 2 bồi bàn, các dancer linh vật nhảy trên quầy. */
  setup(w) {
    deliveries.length = 0;
    busyWaiters.clear();
    const behind = { clipY: COUNTER_Y - 2 };
    w.npc('bartender', { x: 560, y: COUNTER_Y + 22, scale: 2.1, style: 77, label: 'Bartender', labelColor: '#ffcc80', ...behind,
      parts: { outfit: '#212121', outfit2: '#fafafa', shirt: 'collar', bowtie: '#e53935', hairStyle: 'short', accessory: 'none', face: 'happy' } });
    w.npc('dj', { x: 190, y: COUNTER_Y + 22, scale: 2.1, style: 31, label: '🎧 DJ', labelColor: '#ce93d8', ...behind,
      parts: { outfit: '#6a1b9a', outfit2: '#ffd54f', hairStyle: 'cap', accessory: 'headphones', face: 'wink' } });
    w.npc('waiter1', { x: 1010, y: 1060, label: 'Bồi bàn', labelColor: '#b2dfdb',
      parts: { outfit: '#fafafa', outfit2: '#212121', shirt: 'collar', bowtie: '#212121', accessory: 'none' } });
    w.npc('waiter2', { x: 70, y: 1060, label: 'Bồi bàn', labelColor: '#b2dfdb',
      parts: { outfit: '#fafafa', outfit2: '#212121', shirt: 'collar', bowtie: '#212121', accessory: 'none' } });
    (w.features.dancers?.list || []).slice(0, DANCER_SPOTS.length).forEach((d, i) => {
      w.npc(`dancer:${d.id}`, { ...DANCER_SPOTS[i], size: 0.95, style: 500 + i, costume: d.costume, label: d.name, labelColor: '#80cbc4',
        parts: { outfit: { chicken: '#fff8e1', dino: '#43a047', bear: '#8d5a2b' }[d.costume] || '#ff7043', pants: '#5d4037' } });
    });
  },

  /** Engine gọi mỗi khung hình: bồi bàn đi giao đồ; thỉnh thoảng "drop nhạc", cả quán cùng làm một động tác. */
  update(w) {
    runWaiters(w);
    const t = w.t;
    if (t < lastT) nextDrop = t + 25 + Math.random() * 15;
    lastT = t;
    if (t > nextDrop) {
      nextDrop = t + 35 + Math.random() * 20;
      const kind = ['wave', 'hop', 'clap', 'spin', 'heli', 'hiphop'][Math.floor(Math.random() * 6)];
      for (const c of w.chars) {
        if (kind === 'wave') setTimeout(() => w.pose(c, 'cheer', 3500), (c.x / w.W) * 1200); // làn sóng giơ tay
        else if (kind === 'hiphop') w.hiphop(c, 4500); // mỗi người một động tác hip-hop
        else w.dance(c, kind, 4000); // cả quán nhảy tưng tưng / vỗ tay / xoay chong chóng cùng nhịp
      }
      w.fx.flash({ alpha: 0.18, ms: 400 });
      w.fx.wash({ color: MAGENTA, ms: 4000, alpha: 0.14 });
    }
  },

  background(ctx, w) {
    const { W, H } = w;
    const t = w.t;
    const beat = Math.pow(Math.abs(Math.sin(w.beat * Math.PI)), 8); // nháy theo nhịp bài đang phát

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
      for (let k = 0; k < 1; k++) {
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
      for (let k = 0; k < 1; k++) {
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

    drawLed(ctx, w, beat);

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

  // Mép bàn phía trước + ánh nến: tạo chiều sâu
  foreground(ctx, w) {
    const { W, H } = w;
    drawMirrorDots(ctx, w); // đốm sáng từ quả cầu gương rơi lên cả người đứng
    // bàn DJ đặt trên quầy, che bụng DJ
    ctx.fillStyle = '#15121c';
    ctx.beginPath();
    ctx.roundRect(110, COUNTER_Y - 36, 160, 34, 6);
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 8; i++) {
      const on = Math.sin(w.beat * Math.PI * 2 + i) > 0.3;
      ctx.fillStyle = on ? `hsla(${i * 40},100%,60%,0.9)` : 'rgba(255,255,255,0.15)';
      ctx.fillRect(122 + i * 18, COUNTER_Y - 26, 10, 6);
    }
    ctx.globalCompositeOperation = 'source-over';
    w.emoji('💿', 140, COUNTER_Y - 12, 22);
    w.emoji('💿', 240, COUNTER_Y - 12, 22);
    const g = ctx.createLinearGradient(0, 1760, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.8)');
    g.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 1760, W, H - 1760);
    ctx.globalCompositeOperation = 'lighter';
    for (const [x, ph] of [
      [170, 0],
      [880, 2],
    ]) {
      glow(ctx, x, 1850, 70 + Math.sin(w.t * 9 + ph) * 4, AMBER, 0.35);
    }
    ctx.globalCompositeOperation = 'source-over';
  },

  actions: {
    // Đơn pha xong: bồi bàn bưng tới tận nơi, uống xong là "lên cơn"
    order_ready(w, a) {
      const c = w.charFor(a.user, 12000);
      const it = a.data.item;
      deliver(c, it.emoji, () => {
        w.hold(c, it.emoji, 4000);
        w.drinkEffect(c, it.effect);
      });
    },
    // Mời nước người khác: tim bay từ người mời, bồi bàn mang ly tới người được mời
    treat(w, a) {
      const from = w.charFor(a.user, 8000);
      const to = w.charFor(a.data.to, 12000);
      w.fly('💕', w.chest(from), w.chest(to), { size: 50, arc: 220, ms: 1200 });
      deliver(to, a.data.item.emoji, () => {
        w.hold(to, a.data.item.emoji, 5000);
        w.drinkEffect(to, a.data.item.effect || 'hearts');
        w.emote(from, '😏', 3000);
      });
      w.banner(`🥰 ${a.user.name} mời ${a.data.to.name}`, { sub: `${a.data.item.emoji} ${a.data.item.name}`, color: '#f48fb1', ms: 4000 });
    },
    song_change(w, a, d) {
      d.song_change(w, a);
      const dj = w.npc('dj');
      if (dj) w.pose(dj, 'cheer', 3500);
    },
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
