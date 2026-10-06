// THƯ VIỆN HIỆU ỨNG kiểu sân khấu / quán bar thật: pháo sáng lạnh, laser, khói CO2, đèn rọi,
// đèn chớp, mưa kim tuyến, vầng sáng... Dùng chung cho mọi bối cảnh qua w.fx.
// Hiệu ứng ánh sáng vẽ bằng chế độ cộng màu ('lighter') nên trông như phát sáng thật.

const MAX_PARTICLES = 1600; // giới hạn để điện thoại không bị giật

export function createFx({ ctx, W, H, clock }) {
  const rand = (a, b) => a + Math.random() * (b - a);
  let parts = []; // hạt: tia lửa, khói, kim tuyến
  let emitters = []; // nguồn phát liên tục (vòi pháo sáng, vòi khói)
  let layers = []; // hiệu ứng vẽ theo thời gian: { born, dur, layer, draw(ctx, p, t) }

  const now = () => clock();
  const add = (p) => {
    if (parts.length < MAX_PARTICLES) parts.push(p);
  };
  const timed = (ms, layer, draw) => layers.push({ born: now(), dur: ms / 1000, layer, draw });

  // Hình tròn phát sáng mềm (dùng cho đốm sáng, khói, quầng đèn)
  function glow(x, y, r, color, alpha) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color.replace('ALPHA', alpha));
    g.addColorStop(1, color.replace('ALPHA', 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  const fx = {
    /** Pháo sáng lạnh: tia vàng phun lên liên tục từ (x, y). */
    sparkFountain(x, y, { ms = 4000, height = 700, color = [255, 200, 90], rate = 110 } = {}) {
      const v0 = Math.sqrt(2 * 1400 * height);
      emitters.push({
        until: now() + ms / 1000,
        tick(dt) {
          const n = rate * dt;
          for (let i = 0; i < n; i++) {
            add({ k: 'spark', x: x + rand(-6, 6), y, vx: rand(-90, 90), vy: -v0 * rand(0.75, 1), g: 1400, life: 0, max: rand(0.6, 1.1), c: color, s: rand(2, 4) });
          }
        },
        draw() {
          glow(x, y, 90, `rgba(${color[0]},${color[1]},${color[2]},ALPHA)`, 0.45 + Math.random() * 0.2);
        },
      });
    },

    /** Bùng tia lửa nhỏ tại một điểm (cụng ly, chạm quà). */
    sparkBurst(x, y, { n = 40, color = [255, 215, 120], speed = 420 } = {}) {
      for (let i = 0; i < n; i++) {
        const a = rand(0, Math.PI * 2);
        const v = rand(0.3, 1) * speed;
        add({ k: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, g: 700, life: 0, max: rand(0.4, 0.9), c: color, s: rand(1.5, 3.5) });
      }
    },

    /** Pháo hoa: quả pháo bay lên từ (x, y) rồi nổ bung nhiều màu ở độ cao top. */
    firework(x, y, { top = 520, colors = [[255, 90, 90], [255, 220, 90], [120, 220, 255], [200, 120, 255], [120, 255, 160]] } = {}) {
      const tx = x + rand(-120, 120);
      const ty = top + rand(-80, 80);
      const dur = 0.8;
      const born = now();
      const col = colors[Math.floor(Math.random() * colors.length)];
      emitters.push({
        until: born + dur,
        tick() {
          const p = (now() - born) / dur;
          const e = 1 - Math.pow(1 - p, 2);
          const px = x + (tx - x) * e;
          const py = y + (ty - y) * e;
          add({ k: 'spark', x: px, y: py, vx: rand(-30, 30), vy: rand(40, 120), g: 200, life: 0, max: 0.4, c: [255, 230, 180], s: 2.5 });
        },
      });
      setTimeout(() => {
        for (let i = 0; i < 70; i++) {
          const a = (i / 70) * Math.PI * 2;
          const v = rand(220, 380);
          const c = Math.random() < 0.7 ? col : [255, 255, 255];
          add({ k: 'spark', x: tx, y: ty, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 260, drag: 1.2, life: 0, max: rand(1, 1.6), c, s: rand(2, 3.5) });
        }
        timed(400, 'over', (c, p) => {
          c.globalCompositeOperation = 'lighter';
          glowAt(c, tx, ty, 160, col, 0.5 * (1 - p));
        });
      }, dur * 1000);
    },

    /** Khói CO2: cột khói trắng phun mạnh từ dưới lên. */
    co2Jet(x, y, { ms = 1600, height = 900 } = {}) {
      emitters.push({
        until: now() + ms / 1000,
        tick(dt) {
          const n = 70 * dt;
          for (let i = 0; i < n; i++) {
            add({ k: 'smoke', x: x + rand(-10, 10), y, vx: rand(-40, 40), vy: -rand(height * 1.2, height * 1.7), g: -0, drag: 2.2, life: 0, max: rand(1.4, 2.2), r0: rand(20, 40), r1: rand(140, 220) });
          }
        },
      });
    },

    /** Mưa kim tuyến kim loại lấp lánh rơi từ trên xuống. */
    confettiRain({ ms = 4000, colors = [[255, 210, 90], [235, 235, 245], [255, 170, 60]], rate = 160 } = {}) {
      emitters.push({
        until: now() + ms / 1000,
        tick(dt) {
          const n = rate * dt;
          for (let i = 0; i < n; i++) {
            add({ k: 'foil', x: rand(-20, W + 20), y: rand(-80, -10), vx: rand(-30, 30), vy: rand(160, 260), g: 0, life: 0, max: rand(5, 7), c: colors[Math.floor(Math.random() * colors.length)], rot: rand(0, 6), vr: rand(-7, 7), sw: rand(1, 3), s: rand(10, 18) });
          }
        },
      });
    },

    /** Laser: chùm tia quét hình quạt từ một điểm. */
    laserFan({ ms = 4000, x = W / 2, y = 420, beams = 9, colors = [[0, 255, 140], [80, 160, 255], [255, 60, 200]] } = {}) {
      timed(ms, 'over', (c, p, t) => {
        const fade = Math.min(1, p * 8, (1 - p) * 6);
        c.globalCompositeOperation = 'lighter';
        for (let i = 0; i < beams; i++) {
          const col = colors[i % colors.length];
          const a = Math.PI / 2 + Math.sin(t * 1.6 + i * 0.35) * 0.9 + (i - beams / 2) * 0.09;
          const ex = x + Math.cos(a) * 2400;
          const ey = y + Math.sin(a) * 2400;
          c.lineCap = 'round';
          c.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.12 * fade})`;
          c.lineWidth = 14;
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(ex, ey);
          c.stroke();
          c.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.8 * fade})`;
          c.lineWidth = 2.5;
          c.stroke();
        }
        glowAt(c, x, y, 40, [255, 255, 255], 0.8 * fade);
        c.globalCompositeOperation = 'source-over';
      });
    },

    /** Đèn chớp trắng (strobe). */
    strobe({ ms = 1500, hz = 7 } = {}) {
      timed(ms, 'over', (c, p, t) => {
        if (Math.floor(t * hz * 2) % 2) return;
        c.fillStyle = 'rgba(255,255,255,0.18)';
        c.fillRect(0, 0, W, H);
      });
    },

    /** Loé sáng cả màn hình một lần. */
    flash({ ms = 500, color = [255, 245, 220], alpha = 0.5 } = {}) {
      timed(ms, 'over', (c, p) => {
        c.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${alpha * (1 - p)})`;
        c.fillRect(0, 0, W, H);
      });
    },

    /** Phủ màu không khí cả quán (nhịp đèn theo màu). */
    wash({ ms = 2000, color = [255, 60, 180], alpha = 0.18 } = {}) {
      timed(ms, 'under', (c, p) => {
        c.globalCompositeOperation = 'lighter';
        c.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${alpha * Math.sin(Math.PI * p)})`;
        c.fillRect(0, 0, W, H);
        c.globalCompositeOperation = 'source-over';
      });
    },

    /**
     * Đèn rọi (moving head): luồng sáng từ đèn trên trần quét tới mục tiêu rồi khoá theo.
     * target: () => {x, y} để đèn đuổi theo người đang di chuyển.
     */
    beam(target, { ms = 4000, from = { x: W / 2, y: 260 }, color = [255, 245, 220], width = 120 } = {}) {
      const start = { x: from.x + rand(-300, 300), y: from.y };
      const sweepFrom = { x: rand(100, W - 100), y: target().y };
      timed(ms, 'under', (c, p) => {
        const tg = target();
        const k = Math.min(1, p * 4); // 25% đầu: quét tới
        const ease = 1 - Math.pow(1 - k, 3);
        const tx = sweepFrom.x + (tg.x - sweepFrom.x) * ease;
        const ty = sweepFrom.y + (tg.y - sweepFrom.y) * ease;
        const fade = Math.min(1, p * 10, (1 - p) * 5);
        c.globalCompositeOperation = 'lighter';
        const g = c.createLinearGradient(start.x, start.y, tx, ty);
        g.addColorStop(0, `rgba(${color[0]},${color[1]},${color[2]},${0.55 * fade})`);
        g.addColorStop(1, `rgba(${color[0]},${color[1]},${color[2]},${0.12 * fade})`);
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(start.x - 14, start.y);
        c.lineTo(start.x + 14, start.y);
        c.lineTo(tx + width, ty);
        c.lineTo(tx - width, ty);
        c.closePath();
        c.fill();
        // vũng sáng dưới chân
        c.save();
        c.translate(tx, ty);
        c.scale(1, 0.28);
        glowAt(c, 0, 0, width * 1.3, color, 0.7 * fade);
        c.restore();
        glowAt(c, start.x, start.y, 34, [255, 255, 255], 0.9 * fade);
        c.globalCompositeOperation = 'source-over';
      });
    },

    /** Vòng hào quang bay lên quanh một điểm (lên cấp VIP). */
    halo(target, { ms = 2500, color = [255, 215, 90] } = {}) {
      timed(ms, 'over', (c, p) => {
        const tg = target();
        c.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 3; i++) {
          const q = (p * 1.4 + i * 0.25) % 1;
          c.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},${(1 - q) * 0.9})`;
          c.lineWidth = 5;
          c.beginPath();
          c.ellipse(tg.x, tg.y - q * 220, 70 + q * 30, 18 + q * 8, 0, 0, Math.PI * 2);
          c.stroke();
        }
        c.globalCompositeOperation = 'source-over';
      });
    },

    /** Hiệu ứng tuỳ ý: draw(ctx, tiến độ 0..1, giây đã trôi). */
    custom(ms, draw, layer = 'over') {
      timed(ms, layer, draw);
    },

    // ---- engine gọi mỗi khung hình ----
    update(dt) {
      const t = now();
      emitters = emitters.filter((e) => {
        if (t > e.until) return false;
        e.tick(dt);
        return true;
      });
      parts = parts.filter((p) => (p.life += dt) < p.max);
      for (const p of parts) {
        if (p.drag) {
          const k = Math.exp(-p.drag * dt);
          p.vx *= k;
          p.vy *= k;
        }
        p.vy += p.g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.k === 'foil') {
          p.rot += p.vr * dt;
          p.x += Math.sin(p.life * 3 + p.sw) * 40 * dt;
        }
      }
    },

    draw(layer) {
      const t = now();
      layers = layers.filter((l) => {
        const p = (t - l.born) / l.dur;
        if (p >= 1) return false;
        if (l.layer === layer) {
          ctx.save();
          l.draw(ctx, p, t - l.born);
          ctx.restore();
        }
        return true;
      });
      if (layer !== 'over') return;

      ctx.save();
      // khói (vẽ thường, màu trắng mờ)
      for (const p of parts) {
        if (p.k !== 'smoke') continue;
        const q = p.life / p.max;
        glow(p.x, p.y, p.r0 + (p.r1 - p.r0) * q, 'rgba(235,240,255,ALPHA)', 0.22 * (1 - q));
      }
      // kim tuyến: độ sáng đổi theo góc xoay -> lấp lánh
      for (const p of parts) {
        if (p.k !== 'foil') continue;
        const shine = 0.35 + 0.65 * Math.abs(Math.cos(p.rot));
        const fade = Math.min(1, (p.max - p.life) * 2);
        ctx.fillStyle = `rgba(${Math.round(p.c[0] * shine)},${Math.round(p.c[1] * shine)},${Math.round(p.c[2] * shine)},${fade})`;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.s / 2, -p.s * 0.2 * Math.abs(Math.sin(p.rot * 1.3)) - 1, p.s, p.s * 0.4 * Math.abs(Math.sin(p.rot * 1.3)) + 2);
        ctx.restore();
      }
      // tia lửa (cộng màu -> phát sáng)
      ctx.globalCompositeOperation = 'lighter';
      for (const e of emitters) e.draw?.();
      for (const p of parts) {
        if (p.k !== 'spark') continue;
        const q = 1 - p.life / p.max;
        ctx.strokeStyle = `rgba(${p.c[0]},${p.c[1]},${p.c[2]},${q})`;
        ctx.lineWidth = p.s;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.025, p.y - p.vy * 0.025);
        ctx.stroke();
      }
      ctx.restore();
    },

    clear() {
      parts = [];
      emitters = [];
      layers = [];
    },
  };

  function glowAt(c, x, y, r, col, a) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${a})`);
    g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }

  return fx;
}
