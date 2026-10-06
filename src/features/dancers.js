// GỌI DANCER: lệnh quà "call_dancer" -> một dancer (linh vật hài: gà, khủng long, gấu...) chạy tới
// nhảy lố lăng trước nhân vật người gọi trong visitSec giây. Dancer bận hết thì xếp hàng.
// Gõ "!dancer ga" TRƯỚC khi tặng quà để chọn dancer mình thích (nếu dancer đó rảnh).
//
// cfg: { list: [{ id, name, costume, aliases? }], visitSec }

import { norm } from './norm.js';

export class Dancers {
  constructor(cfg, env) {
    this.env = env;
    this.list = (cfg.list || []).map((d) => ({ ...d, busyUntil: 0, with: null, keys: [d.id, d.name, ...(d.aliases || [])].map(norm) }));
    this.visitMs = (cfg.visitSec ?? 20) * 1000;
    this.waiting = []; // { user, want }
    this.wants = new Map(); // id người xem -> dancer muốn chọn (gõ !dancer trước khi tặng)
  }

  pub(d) {
    return { id: d.id, name: d.name, costume: d.costume };
  }

  onChat(ctx) {
    const m = /^!dancer\s+(.{1,30})$/iu.exec(ctx.text.trim());
    if (!m) return null;
    const k = norm(m[1]);
    const d = this.list.find((x) => x.keys.some((key) => key === k || key.startsWith(k)));
    if (!d) return [this.env.make(ctx.user, 'dancer_list', { list: this.list.map((x) => this.pub(x)) })];
    this.wants.set(ctx.user.id, { id: d.id, until: ctx.now + 120_000 });
    return [this.env.make(ctx.user, 'dancer_pick', { dancer: this.pub(d) })];
  }

  transform(action, ctx) {
    if (action.action !== 'call_dancer') return null;
    const want = this.wants.get(ctx.user.id);
    const wantId = want && ctx.now <= want.until ? want.id : null;
    this.wants.delete(ctx.user.id);
    const d = this.free(ctx.now, wantId);
    if (!d) {
      this.waiting.push({ user: ctx.user, want: wantId });
      this.env.changed();
      return [this.env.make(ctx.user, 'dancer_queued', { position: this.waiting.length })];
    }
    return [this.visit(d, ctx.user, ctx.now)];
  }

  free(now, wantId) {
    const free = this.list.filter((d) => d.busyUntil <= now);
    return free.find((d) => d.id === wantId) || free[Math.floor(Math.random() * free.length)] || null;
  }

  visit(d, user, now) {
    d.busyUntil = now + this.visitMs;
    d.with = user.name;
    this.env.changed();
    return this.env.make(user, 'dancer_visit', { dancer: this.pub(d), sec: this.visitMs / 1000 }, { priority: 2, say: `${d.name} tới nhảy cho ${user.name}!` });
  }

  tick(now) {
    let changed = false;
    for (const d of this.list) {
      if (d.with && d.busyUntil <= now) {
        d.with = null;
        changed = true;
      }
    }
    while (this.waiting.length) {
      const w = this.waiting[0];
      const d = this.free(now, w.want);
      if (!d) break;
      this.waiting.shift();
      this.env.emit(this.visit(d, w.user, now));
      changed = true;
    }
    if (changed) this.env.changed();
  }

  publicState() {
    return { list: this.list.map((d) => ({ ...this.pub(d), with: d.with })), waiting: this.waiting.length };
  }
}
