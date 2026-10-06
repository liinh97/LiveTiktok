// GỌI ĐỒ: "!goi tra sua" -> đơn vào hàng chờ, pha xong bồi bàn mang tới tận nhân vật.
// Mỗi món có "hiệu ứng" hài (mặt đỏ phun lửa, nấc trân châu...) do scene diễn theo item.effect.
// Tặng quà rồi gõ "!moi <tên>" để mời người khác, hoặc "!nem <tên>" để ném bánh kem vào người đó.
//
// cfg: { menu: [{ id, name, emoji, effect, aliases? }], cooldownSec, prepSec, maxQueue,
//        creditSec, treatItem: { name, emoji, effect } }

import { norm } from './norm.js';

export class Orders {
  constructor(cfg, env) {
    this.env = env;
    this.menu = (cfg.menu || []).map((m) => ({ ...m, keys: [m.id, m.name, ...(m.aliases || [])].map(norm).filter(Boolean) }));
    this.cooldownMs = (cfg.cooldownSec ?? 180) * 1000;
    this.prepMs = (cfg.prepSec ?? 4) * 1000;
    this.maxQueue = cfg.maxQueue ?? 12;
    this.creditMs = (cfg.creditSec ?? 90) * 1000;
    this.treatItem = cfg.treatItem || { name: 'Ly đặc biệt', emoji: '🍹', effect: 'sparkle' };
    this.queue = [];
    this.last = new Map(); // id người xem -> lần gọi gần nhất
    this.credits = new Map(); // id người xem -> hạn được mời/ném sau khi tặng quà
    this.seq = 0;
  }

  findItem(text) {
    const t = norm(text);
    if (!t) return null;
    return this.menu.find((m) => m.keys.some((k) => t === k)) || this.menu.find((m) => m.keys.some((k) => t.startsWith(k) || k.startsWith(t))) || null;
  }

  pub(item) {
    return { id: item.id, name: item.name, emoji: item.emoji, effect: item.effect };
  }

  onChat(ctx) {
    const t = ctx.text.trim();
    let m = /^!(?:goi|gọi|order)\s+(.{1,40})$/iu.exec(t);
    if (m) return this.order(ctx, m[1]);
    m = /^!(?:moi|mời)\s+(.{1,40})$/iu.exec(t);
    if (m) return this.social(ctx, m[1], 'treat');
    m = /^!(?:nem|ném)\s+(.{1,40})$/iu.exec(t);
    if (m) return this.social(ctx, m[1], 'pie');
    if (/^!(?:menu|thucdon|thực đơn)$/iu.test(t)) return [this.env.make(ctx.user, 'order_menu', { menu: this.menu.map((x) => this.pub(x)) })];
    return null;
  }

  order(ctx, what) {
    const { env } = this;
    const now = ctx.now;
    const item = this.findItem(what);
    if (!item) return [env.make(ctx.user, 'order_menu', { text: what, menu: this.menu.map((x) => this.pub(x)) })];
    const cd = ctx.user.tier?.rank >= 2 ? this.cooldownMs / 2 : this.cooldownMs; // VIP gọi nhanh hơn
    const wait = cd - (now - (this.last.get(ctx.user.id) || 0));
    if (wait > 0) return [env.make(ctx.user, 'order_wait', { item: this.pub(item), waitSec: Math.ceil(wait / 1000) })];
    if (this.queue.length >= this.maxQueue) return [env.make(ctx.user, 'order_busy', { item: this.pub(item) })];
    this.last.set(ctx.user.id, now);
    const prevReady = this.queue.length ? this.queue[this.queue.length - 1].readyAt : now;
    this.queue.push({ id: ++this.seq, user: ctx.user, item, readyAt: Math.max(now, prevReady) + this.prepMs });
    env.changed();
    return [env.make(ctx.user, 'order_placed', { item: this.pub(item), position: this.queue.length })];
  }

  /** Mời đồ uống / ném bánh kem vào người khác: cần tặng quà trước (trong creditSec giây). */
  social(ctx, targetName, kind) {
    const { env } = this;
    const credit = this.credits.get(ctx.user.id);
    if (!credit || ctx.now > credit.until) return [env.make(ctx.user, 'social_hint', { kind })];
    const target = env.findUser(targetName, ctx.user.id);
    if (!target) return [env.make(ctx.user, 'social_notfound', { kind, text: targetName })];
    this.credits.delete(ctx.user.id);
    if (kind === 'pie') {
      return [env.make(ctx.user, 'throw_pie', { to: target }, { priority: 2, say: `${ctx.user.name} ném bánh kem vào mặt ${target.name}!` })];
    }
    return [env.make(ctx.user, 'treat', { to: target, item: this.treatItem }, { priority: 2, say: `${ctx.user.name} mời ${target.name} một ${this.treatItem.name}!` })];
  }

  afterGift(ctx) {
    this.credits.set(ctx.user.id, { until: ctx.now + this.creditMs });
    return [];
  }

  tick(now) {
    let changed = false;
    while (this.queue.length && this.queue[0].readyAt <= now) {
      const o = this.queue.shift();
      changed = true;
      this.env.emit(this.env.make(o.user, 'order_ready', { item: this.pub(o.item) }, { say: `${o.item.name} của ${o.user.name} đây!` }));
    }
    if (changed) this.env.changed();
  }

  publicState() {
    const now = this.env.now();
    return {
      menu: this.menu.map((x) => this.pub(x)),
      queue: this.queue.slice(0, 5).map((o) => ({ name: o.user.name, item: o.item.name, emoji: o.item.emoji, readyIn: Math.max(0, Math.ceil((o.readyAt - now) / 1000)) })),
      waiting: this.queue.length,
    };
  }
}
