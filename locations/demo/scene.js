// 🧪 DEMO — cảnh tối giản để kiểm tra luồng. Dùng toàn bộ hiệu ứng mặc định của engine.
// Làm địa điểm mới: sao chép thư mục này, đổi nền và (tuỳ chọn) thêm actions riêng.

const SPOTS = [];
for (let y = 1060; y <= 1700; y += 55) {
  for (let x = 70; x <= 1010; x += 75) SPOTS.push({ x: x + (Math.random() - 0.5) * 30, y: y + (Math.random() - 0.5) * 10 });
}

export default {
  maxChars: 120,
  source: { x: 540, y: 900 },
  spots: SPOTS,
  entrance: { x: 540, y: 1980 },
  scaleAt: (y) => 0.7 + ((y - 1060) / 640) * 0.4,

  background(ctx, w) {
    const g = ctx.createLinearGradient(0, 0, 0, w.H);
    g.addColorStop(0, '#263238');
    g.addColorStop(1, '#37474f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w.W, w.H);
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
    w.emoji('🎁', 540, 900, 64);
  },
};
