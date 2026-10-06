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
function fillSilhouette(ctx, x, y, s, seed) {
  const sh = 40 + seed * 10; // nửa bề rộng vai
  const hipW = 30 + seed * 8;
  const hy = y - 186 * s; // tâm đầu
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
  ctx.ellipse(x, hy, 21 * s, 25 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  // kiểu tóc theo seed
  if (seed > 0.66) {
    // tóc dài xoã vai
    ctx.beginPath();
    ctx.moveTo(x - 23 * s, hy - 4 * s);
    ctx.quadraticCurveTo(x - 30 * s, y - 150 * s, x - 22 * s, y - 138 * s);
    ctx.lineTo(x + 22 * s, y - 138 * s);
    ctx.quadraticCurveTo(x + 30 * s, y - 150 * s, x + 23 * s, hy - 4 * s);
    ctx.closePath();
    ctx.fill();
  } else if (seed > 0.4) {
    // búi tóc
    ctx.beginPath();
    ctx.arc(x, hy - 26 * s, 10 * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Vẽ bóng người ngược sáng: phóng to nhẹ một bản màu sáng phía sau rồi phủ bản tối lên trên,
 * chỉ còn lại một viền sáng mỏng quanh rìa giống ảnh chụp ngược sáng thật.
 */
function drawSilhouette(ctx, x, y, s, seed, rim, rimAlpha, extra) {
  const cy = y - 110 * s;
  ctx.save();
  ctx.translate(x, cy);
  ctx.scale(1.045, 1.025);
  ctx.translate(-x, -cy);
  ctx.fillStyle = `rgba(${rim[0]},${rim[1]},${rim[2]},${rimAlpha})`;
  ctx.strokeStyle = ctx.fillStyle;
  extra?.();
  fillSilhouette(ctx, x, y - 2 * s, s, seed);
  ctx.restore();
  const body = ctx.createLinearGradient(0, y - 210 * s, 0, y);
  body.addColorStop(0, '#140d1a');
  body.addColorStop(1, '#030205');
  ctx.fillStyle = body;
  ctx.strokeStyle = body;
  extra?.();
  fillSilhouette(ctx, x, y, s, seed);
}

/** Cánh tay giơ lên (cổ vũ) hoặc cầm ly trước ngực. */
function arms(ctx, x, y, s, pose, holding, t, seed) {
  ctx.lineCap = 'round';
  ctx.lineWidth = 15 * s;
  ctx.beginPath();
  if (pose === 'cheer') {
    const wave = Math.sin(t * 6 + seed * 9) * 10 * s;
    ctx.moveTo(x - 34 * s, y - 140 * s);
    ctx.lineTo(x - 52 * s + wave, y - 250 * s);
    ctx.moveTo(x + 34 * s, y - 140 * s);
    ctx.lineTo(x + 50 * s - wave, y - 255 * s);
  } else if (holding) {
    ctx.moveTo(x + 34 * s, y - 138 * s);
    ctx.lineTo(x + 46 * s, y - 92 * s);
    ctx.lineTo(x + 30 * s, y - 112 * s);
  } else return;
  ctx.stroke();
}

export default {
  maxChars: 24,
  charHeight: 212,
  stageFloorY: 1620,
  spots: SPOTS,
  source: { x: 540, y: COUNTER_Y - 30 },
  scaleAt: (y) => 0.62 + ((y - FAR_Y) / (NEAR_Y - FAR_Y)) * 0.58,
  wander: () => null,

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
      ctx.fillText('Neon Lounge', W / 2, 360);
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

    // Đèn trần quét chậm + làn khói mờ (cả hai chế độ)
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const ox = 150 + i * 260;
      const a = Math.sin(t * 0.35 + i * 1.7) * 0.5;
      const col = i % 2 ? MAGENTA : AMBER;
      const ex = ox + Math.sin(a) * 900;
      const g = ctx.createLinearGradient(ox, 200, ex, H);
      g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${0.16 + beat * 0.06})`);
      g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(ox - 8, 200);
      ctx.lineTo(ox + 8, 200);
      ctx.lineTo(ex + 160, H);
      ctx.lineTo(ex - 160, H);
      ctx.closePath();
      ctx.fill();
      glow(ctx, ox, 200, 26, col, 0.6);
    }
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
    const holding = c.item && w.t < c.item.until;
    const rim = lit ? w.rgb(lit) : c.seed > 0.5 ? [255, 170, 110] : [230, 120, 220];
    drawSilhouette(ctx, x, y, s, c.seed, rim, lit ? 0.95 : 0.22, () => arms(ctx, x, y, s, c.pose, holding, w.t, c.seed));
  },

  // Mép bàn phía trước + ánh nến: tạo chiều sâu
  foreground(ctx, w) {
    const { W, H } = w;
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
