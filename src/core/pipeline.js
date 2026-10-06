// LÕI XỬ LÝ: sự kiện chuẩn -> lọc trùng -> lọc nội dung -> ghi dữ liệu chung -> luật -> hành động.
// Hành động ("action") được gửi xuống trang hiển thị; diễn hành động đó ra sao là việc của scene.
//
// Hành động gửi xuống:
// { id, action, priority, location, say, test, ts,
//   user: { id, name, avatar, tier: {id,name,color,rank}, totalCoins, isNew } | null,
//   data: { text?, likes?, gift?: {name,count,coins,total,image}, from?, to?, count?, params? } }

import { EventEmitter } from 'node:events';
import { fillTemplate, localTime, LruSet } from '../util.js';

export class Pipeline extends EventEmitter {
  constructor({ config, store, filter, rules, tiers, scheduler, locations, alerts, getSessionId = () => null }) {
    super();
    this.cfg = config.pipeline;
    this.config = config;
    this.store = store;
    this.filter = filter;
    this.rules = rules;
    this.tiers = tiers;
    this.scheduler = scheduler;
    this.locations = locations;
    this.alerts = alerts;
    this.getSessionId = getSessionId;

    this.seen = new LruSet(this.cfg.dedupeSize || 5000);
    this.lastCheer = new Map();
    this.filterHits = new Map();
    this.joinBucket = { sec: 0, count: 0 };
    this.crowdOverflow = 0;
    this.paused = false;
    this.lastEventAt = 0;
    this.seq = 0;
    this.counts = { events: 0, actions: 0, dropped: 0 };
  }

  start() {
    this.crowdTimer = setInterval(() => this.flushCrowd(), this.cfg.crowdFlushMs || 2000);
  }
  stop() {
    clearInterval(this.crowdTimer);
  }

  setPaused(p) {
    this.paused = Boolean(p);
  }

  /** Xử lý một sự kiện chuẩn. Trả về danh sách hành động đã phát ra. */
  process(ev, now = Date.now()) {
    this.lastEventAt = now;
    this.counts.events++;
    if (this.seen.has(ev.id)) return this.drop();
    this.seen.add(ev.id);

    const blocked = this.filter.isBlocked(ev.user.id);
    const location = this.scheduler.current().location;
    const day = localTime(new Date(ev.ts || now), this.config.timezone).day;

    // Hồ sơ người xem dùng chung cho mọi địa điểm
    let player;
    let isNew = false;
    if (ev.test) {
      player = this.store.getPlayer(ev.user.id) || { total_coins: 0 };
    } else {
      ({ player, isNew } = this.store.touch(ev.user, { countVisit: ev.type === 'join', now }));
    }

    // Quà luôn được ghi (là tiền thật), kể cả khi tạm dừng hiệu ứng hoặc người bị chặn
    let giftInfo = null;
    if (ev.type === 'gift') giftInfo = this.recordGift(ev, player, location, day, now);

    if (blocked || this.paused) return this.drop();

    const total = giftInfo ? giftInfo.newTotal : player.total_coins;
    const user = {
      id: ev.user.id,
      name: this.filter.cleanName(ev.user.name),
      avatar: ev.user.avatar ? `/avatar?u=${encodeURIComponent(ev.user.avatar)}` : null,
      tier: this.tiers.public(this.tiers.of(total)),
      totalCoins: total,
      isNew,
    };
    const ctx = { ev, user, location, day, now };
    const rules = this.rules.forLocation(location);
    const out = [];

    switch (ev.type) {
      case 'join': {
        if (!this.allowJoin(now)) return this.drop();
        out.push(this.make(ctx, rules.join, {}));
        break;
      }
      case 'like': {
        const last = this.lastCheer.get(user.id) || 0;
        if (now - last < (this.cfg.likeThrottleSec || 10) * 1000) return this.drop();
        this.lastCheer.set(user.id, now);
        if (this.lastCheer.size > 5000) this.lastCheer.clear();
        out.push(this.make(ctx, rules.like, { likes: ev.likes || 1 }));
        break;
      }
      case 'follow':
      case 'share':
        out.push(this.make(ctx, rules[ev.type], {}));
        break;
      case 'chat': {
        const text = (ev.text || '').trim();
        if (!text) return this.drop();
        if (!this.filter.chatAllowed(text)) {
          this.onFilterHit(ev.user, user.name);
          return this.drop();
        }
        const hit = this.rules.pickChat(location, text, (tierId) => this.tiers.atLeast(total, tierId));
        if (!hit) return this.drop();
        const shown = (hit.match ? hit.match[1] ?? hit.match[0] : text).slice(0, 80);
        out.push(this.make(ctx, hit.rule, { text: shown }));
        break;
      }
      case 'gift': {
        const { rule, tierBefore, tierAfter } = giftInfo;
        const g = ev.gift;
        const data = { gift: { name: g.name, count: g.count, coins: g.coins, total: g.coins * g.count, image: g.image } };
        if (rule) out.push(this.make(ctx, rule, data));
        if (tierAfter.rank > tierBefore.rank) {
          out.push(
            this.make(
              ctx,
              { action: 'tier_up', priority: 3, say: 'Chúc mừng {name} lên {tier}!' },
              { from: tierBefore, to: tierAfter },
            ),
          );
        }
        break;
      }
      default:
        return this.drop();
    }

    for (const a of out) {
      this.counts.actions++;
      this.emit('action', a);
    }
    return out;
  }

  recordGift(ev, player, location, day, now) {
    const g = ev.gift;
    const total = g.coins * g.count;
    const oldTotal = player.total_coins || 0;
    let newTotal = oldTotal + total;
    if (!ev.test) {
      newTotal = this.store.addGift({
        playerId: ev.user.id,
        location,
        sessionId: this.getSessionId(),
        giftName: g.name,
        count: g.count,
        coins: total,
        day,
        ts: now,
      });
    }

    const rule = this.rules.pickGift(location, total);

    const big = this.config.alerts?.bigGiftCoins;
    if (big && total >= big && !ev.test) {
      const vnd = (total * (this.config.vndPerCoin || 0)).toLocaleString('vi-VN');
      const where = location ? this.locations[location]?.name : 'ngoài giờ mở cửa';
      this.alerts?.notify(`🎁 ${ev.user.name} tặng ${g.count}× ${g.name} = ${total} xu (≈ ${vnd}đ) — ${where}`);
    }
    if (!ev.test) this.emit('gift', { playerId: ev.user.id, total, day });

    return {
      newTotal,
      rule,
      tierBefore: this.tiers.public(this.tiers.of(oldTotal)),
      tierAfter: this.tiers.public(this.tiers.of(newTotal)),
    };
  }

  make(ctx, rule, data) {
    const { user, location, ev, now } = ctx;
    const vars = {
      name: user.name,
      tier: user.tier.name,
      text: data.text,
      count: data.gift?.count,
      gift: data.gift?.name,
      coins: data.gift?.total,
    };
    if (data.to) vars.tier = data.to.name;
    const sayAllowed = !rule.sayMinTier || this.tiers.rank(user.tier.id) >= this.tiers.rank(rule.sayMinTier);
    return {
      id: ++this.seq,
      action: rule.action,
      priority: rule.priority ?? 0,
      location,
      user,
      data: rule.params ? { ...data, params: rule.params } : data,
      say: sayAllowed ? fillTemplate(rule.say, vars) : '',
      test: ev.test,
      ts: now,
    };
  }

  allowJoin(now) {
    const sec = Math.floor(now / 1000);
    if (this.joinBucket.sec !== sec) this.joinBucket = { sec, count: 0 };
    if (this.joinBucket.count >= (this.cfg.joinsPerSecond || 3)) {
      this.crowdOverflow++;
      return false;
    }
    this.joinBucket.count++;
    return true;
  }

  /** Lúc đông người vào cùng lúc: gộp phần dư thành một thông báo "+N khách". */
  flushCrowd() {
    if (!this.crowdOverflow || this.paused) {
      this.crowdOverflow = 0;
      return null;
    }
    const a = {
      id: ++this.seq,
      action: 'crowd',
      priority: 0,
      location: this.scheduler.current().location,
      user: null,
      data: { count: this.crowdOverflow },
      say: '',
      test: false,
      ts: Date.now(),
    };
    this.crowdOverflow = 0;
    this.emit('action', a);
    return a;
  }

  onFilterHit(rawUser, shownName) {
    const n = (this.filterHits.get(rawUser.id) || 0) + 1;
    this.filterHits.set(rawUser.id, n);
    const limit = this.config.filter?.alertAfterHits || 3;
    if (n === limit) {
      this.alerts?.raise(
        `filter:${rawUser.id}`,
        `Người xem "${shownName}" (id ${rawUser.id}) bị lọc ${n} lần — cân nhắc chặn trên bảng điều khiển`,
      );
    }
  }

  drop() {
    this.counts.dropped++;
    return [];
  }
}
