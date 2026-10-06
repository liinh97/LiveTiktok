// 🧪 DEMO — cảnh tối giản để kiểm tra luồng. Dùng toàn bộ hiệu ứng mặc định của engine.
// Làm địa điểm mới: sao chép thư mục này, đổi nền và (tuỳ chọn) thêm actions riêng.

export default {
  maxChars: 30,
  entrance: { x: 540, y: 1980 },
  source: { x: 540, y: 900 },

  spot: (w) => ({ x: w.rand(100, w.W - 100), y: w.rand(1050, 1700) }),
  wander: (w, c) => (Math.random() < 0.5 ? { x: w.clamp(c.x + w.rand(-160, 160), 100, w.W - 100), y: w.clamp(c.y + w.rand(-80, 80), 1050, 1700) } : null),

  background(ctx, w) {
    const g = ctx.createLinearGradient(0, 0, 0, w.H);
    g.addColorStop(0, '#263238');
    g.addColorStop(1, '#37474f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w.W, w.H);
    // Lưới sàn
    ctx.strokeStyle = 'rgba(255,255,255,.06)';
    ctx.lineWidth = 2;
    for (let x = 0; x <= w.W; x += 90) {
      ctx.beginPath();
      ctx.moveTo(x, 960);
      ctx.lineTo(x, w.H);
      ctx.stroke();
    }
    for (let y = 960; y <= w.H; y += 90) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w.W, y);
      ctx.stroke();
    }
    // Điểm quà bay ra
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.beginPath();
    ctx.arc(540, 900, 70, 0, Math.PI * 2);
    ctx.fill();
    w.emoji('🎁', 540, 900, 64);
  },
};
