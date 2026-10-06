// TROLL BẠN BÈ: "!troll <tên>" + tặng quà -> nhân vật người đó dính trò (vỏ chuối, hoá khoai tây,
// xì hơi tên lửa, khiêng quan tài...). Quà càng to trò càng nặng. Gõ trước rồi tặng, hay tặng trước
// rồi gõ (trong creditSec giây) đều được. Mỗi lần tặng = 1 lần troll.
// "!khien" + tặng quà: khiên chống troll shieldSec giây; ai troll vào sẽ bị DỘI NGƯỢC lại chính mình.
// "!nhay <điệu>" (miễn phí): tự nhảy điệu troll (gà, sâu đo, T-pose...), mỗi người 1 lần / selfCooldownSec.
// Đếm "Nạn nhân của đêm": ai bị troll nhiều nhất trong ngày được đội vương miện hề 🤡.
//
// cfg: { creditSec, shieldSec, selfCooldownSec, timeZone,
//        tricks: [{ id, name, emoji, minCoins }], dances: [{ id, name, emoji, effect, aliases? }] }

import { norm } from './norm.js';

export class Troll {
  constructor(cfg, env) {
    this.env = env;
    this.tricks = (cfg.tricks || []).map((t) => ({ ...t, minCoins: t.minCoins ?? 1 })).sort((a, b) => a.minCoins - b.minCoins);
    this.dances = (cfg.dances || []).map((d) => ({ ...d, keys: [d.id, d.name, ...(d.aliases || [])].map(norm).filter(Boolean) }));
    this.creditMs = (cfg.creditSec ?? 90) * 1000;
    this.shieldMs = (cfg.shieldSec ?? 120) * 1000;
    this.selfMs = (cfg.selfCooldownSec ?? 45) * 1000;
    this.dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: cfg.timeZone || 'Asia/Ho_Chi_Minh' });
    this.credits = new Map(); // id -> { coins, until } (xu đã tặng, chưa dùng)
    this.pending = new Map(); // id -> { kind: 'troll'|'shield', target?, until } (gõ lệnh trước khi tặng)
    this.shields = new Map(); // id -> hết hạn
    this.lastDance = new Map(); // id -> lần !nhay gần nhất
    this.day = null;
    this.victims = new Map(); // id -> { id, name, n } trong ngày
    this.crowned = null; // người đang giữ "Nạn nhân của đêm" (đã thông báo)
  }

  pubTrick(t) {
    return { id: t.id, name: t.name, emoji: t.emoji };
  }

  pubDance(d) {
    return { id: d.id, name: d.name, emoji: d.emoji, effect: d.effect || d.id };
  }

  onChat(ctx) {
    const t = ctx.text.trim();
    let m = /^!troll(?:\s+(.{1,40}))?$/iu.exec(t);
    if (m) return m[1] ? this.aim(ctx, m[1]) : [this.helpAction(ctx)];
    if (/^!(?:khien|khiên|shield)$/iu.test(t)) return this.useOrWait(ctx, { kind: 'shield' });
    m = /^!(?:nhay|nhảy)(?:\s+(.{1,30}))?$/iu.exec(t);
    if (m) return this.selfDance(ctx, m[1]);
    return null;
  }

  helpAction(ctx) {
    return this.env.make(ctx.user, 'troll_help', { tricks: this.tricks.map((x) => ({ ...this.pubTrick(x), minCoins: x.minCoins })) });
  }

  aim(ctx, name) {
    const target = this.env.findUser(name, ctx.user.id);
    if (!target) return [this.env.make(ctx.user, 'troll_notfound', { text: name })];
    return this.useOrWait(ctx, { kind: 'troll', target });
  }

  /** Có xu tặng sẵn thì làm luôn, chưa thì nhớ lệnh chờ quà. */
  useOrWait(ctx, want) {
    const credit = this.credits.get(ctx.user.id);
    if (credit && ctx.now <= credit.until) {
      this.credits.delete(ctx.user.id);
      return this.perform(ctx.user, want, credit.coins, ctx.now);
    }
    this.pending.set(ctx.user.id, { ...want, until: ctx.now + this.creditMs });
    return [this.env.make(ctx.user, want.kind === 'shield' ? 'troll_hint' : 'troll_armed', { kind: want.kind, to: want.target || null })];
  }

  afterGift(ctx) {
    const coins = ctx.coins || 0;
    if (coins <= 0) return [];
    const want = this.pending.get(ctx.user.id);
    if (want && ctx.now <= want.until) {
      this.pending.delete(ctx.user.id);
      return this.perform(ctx.user, want, coins, ctx.now);
    }
    this.pending.delete(ctx.user.id);
    const old = this.credits.get(ctx.user.id);
    const keep = old && ctx.now <= old.until ? old.coins : 0; // combo quà nhỏ liên tiếp được cộng dồn
    this.credits.set(ctx.user.id, { coins: keep + coins, until: ctx.now + this.creditMs });
    return [];
  }

  /** Trò theo số xu: lấy nhóm trò nặng nhất mà số xu đủ, bốc ngẫu nhiên trong nhóm. */
  pickTrick(coins) {
    const ok = this.tricks.filter((t) => t.minCoins <= coins);
    if (!ok.length) return this.tricks[0] || null;
    const top = ok[ok.length - 1].minCoins;
    const group = ok.filter((t) => t.minCoins === top);
    return group[Math.floor(Math.random() * group.length)];
  }

  perform(user, want, coins, now) {
    const { env } = this;
    if (want.kind === 'shield') {
      this.shields.set(user.id, now + this.shieldMs);
      return [env.make(user, 'troll_shield', { sec: this.shieldMs / 1000 }, { say: `${user.name} bật khiên chống troll!` })];
    }
    const trick = this.pickTrick(coins);
    if (!trick) return [];
    const target = want.target;
    const shielded = (this.shields.get(target.id) || 0) > now;
    const victim = shielded ? user : target;
    const out = [
      env.make(
        user,
        'troll',
        { trick: this.pubTrick(trick), to: victim, bounced: shielded, shield: shielded ? target : null },
        {
          priority: trick.minCoins >= 99 ? 3 : 2,
          say: shielded ? `Khiên của ${target.name} dội ngược! ${user.name} tự dính ${trick.name}!` : `${user.name} troll ${target.name}: ${trick.name}!`,
        },
      ),
    ];
    const top = this.countVictim(victim, now);
    if (top) out.push(env.make(victim, 'troll_top', { n: top.n }, { say: `${victim.name} là nạn nhân của đêm nay!` }));
    env.changed();
    return out;
  }

  /** Cộng 1 lần bị troll; trả về bản ghi nếu người này vừa vươn lên dẫn đầu (từ 2 lần trở lên). */
  countVictim(victim, now) {
    const day = this.dayFmt.format(now);
    if (day !== this.day) {
      this.day = day;
      this.victims.clear();
      this.crowned = null;
    }
    const v = this.victims.get(victim.id) || { id: victim.id, name: victim.name, n: 0 };
    v.n++;
    v.name = victim.name;
    this.victims.set(victim.id, v);
    const leads = [...this.victims.values()].every((o) => o === v || o.n < v.n);
    if (v.n < 2 || !leads || this.crowned === v.id) return null;
    this.crowned = v.id;
    return v;
  }

  selfDance(ctx, what) {
    const { env } = this;
    const list = { list: this.dances.map((d) => this.pubDance(d)) };
    if (!what) return [env.make(ctx.user, 'troll_dance_list', list)];
    const k = norm(what);
    const d = this.dances.find((x) => x.keys.includes(k)) || this.dances.find((x) => x.keys.some((key) => key.startsWith(k)));
    if (!d) return [env.make(ctx.user, 'troll_dance_list', list)];
    const wait = this.selfMs - (ctx.now - (this.lastDance.get(ctx.user.id) || -Infinity));
    if (wait > 0) return [env.make(ctx.user, 'troll_wait', { waitSec: Math.ceil(wait / 1000) })];
    this.lastDance.set(ctx.user.id, ctx.now);
    if (this.lastDance.size > 5000) this.lastDance.clear();
    return [env.make(ctx.user, 'troll_dance', { dance: this.pubDance(d) })];
  }

  tick(now) {
    for (const [id, until] of this.shields) if (until <= now) this.shields.delete(id);
    if (this.pending.size > 2000) for (const [id, p] of this.pending) if (p.until < now) this.pending.delete(id);
    if (this.credits.size > 2000) for (const [id, c] of this.credits) if (c.until < now) this.credits.delete(id);
  }

  publicState() {
    const day = this.dayFmt.format(this.env.now());
    const top = day === this.day ? [...this.victims.values()].sort((a, b) => b.n - a.n).slice(0, 3) : [];
    return { top, tricks: this.tricks.map((t) => this.pubTrick(t)), dances: this.dances.map((d) => this.pubDance(d)) };
  }
}
