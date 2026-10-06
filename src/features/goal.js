// MỤC TIÊU CHUNG: mọi quà trong quán cộng dồn vào thanh tiến trình; đủ thì mở thưởng cho CẢ QUÁN
// (vd. tháp ly, mưa bánh) rồi sang mục tiêu mới (lớn dần).
//
// cfg: { label, target, growBy?, reward? }

export class Goal {
  constructor(cfg, env) {
    this.env = env;
    this.label = cfg.label || 'Mục tiêu cả quán';
    this.base = cfg.target || 300;
    this.growBy = cfg.growBy ?? 0.25;
    this.reward = cfg.reward || 'tower';
    this.target = this.base;
    this.progress = 0;
    this.round = 1;
    this.top = new Map(); // ai góp nhiều nhất vòng này
  }

  afterGift(ctx) {
    const coins = ctx.coins || 0;
    if (coins <= 0) return [];
    this.progress += coins;
    this.top.set(ctx.user.name, (this.top.get(ctx.user.name) || 0) + coins);
    const out = [];
    if (this.progress >= this.target) {
      const best = [...this.top.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ctx.user.name;
      out.push(
        this.env.make(ctx.user, 'goal_reached', { label: this.label, reward: this.reward, round: this.round, best }, { priority: 4, say: `Cả quán đã đạt ${this.label}! Cảm ơn mọi người!` }),
      );
      this.progress -= this.target;
      this.round++;
      this.target = Math.round(this.base * (1 + this.growBy * (this.round - 1)));
      this.top.clear();
    }
    this.env.changed();
    return out;
  }

  publicState() {
    return { label: this.label, progress: this.progress, target: this.target, round: this.round };
  }
}
