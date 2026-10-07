// LÕI XỬ LÝ: sự kiện chuẩn -> lọc trùng -> lọc nội dung -> ghi dữ liệu chung -> luật -> hành động.
// Hành động ("action") được gửi xuống trang hiển thị; diễn hành động đó ra sao là việc của scene.
//
// Hành động gửi xuống:
// { id, action, priority, location, say, test, ts,
//   user: { id, name, avatar, tier: {id,name,color,rank}, totalCoins, isNew, look: {style, scale, wings} } | null,
//   data: { text?, likes?, gift?: {name,count,coins,total,image}, from?, to?, count?, params?, cmd?: {label, icon} } }
//
// Ngoại hình (look) của nhân vật mỗi người xem: style (kiểu nhân vật, giữ mãi), scale + wings (to/nhỏ, có cánh:
// giữ trong ngày). Máy chủ cũng nhớ ai đang ở trong quán (presence) để trang hiển thị tải lại không mất đám đông.

import { EventEmitter } from 'node:events';
import { norm } from '../features/norm.js';
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
    this.present = new Map(); // id người xem -> { user, lastSeen }
    this.testLooks = new Map(); // ngoại hình của người thử (không lưu DB)
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

    if (blocked) {
      this.present.delete(ev.user.id);
      return this.drop();
    }

    // Ngoại hình nhân vật (lệnh "to lên", "đổi nhân vật"... là tiền thật nên áp dụng cả khi tạm dừng)
    let look = this.lookOf(ev, player, day);
    if (giftInfo?.rule?.look) look = this.changeLook(ev, look, giftInfo.rule.look, day);

    const total = giftInfo ? giftInfo.newTotal : player.total_coins;
    const user = {
      id: ev.user.id,
      name: this.filter.cleanName(ev.user.name),
      avatar: ev.user.avatar ? `/avatar?u=${encodeURIComponent(ev.user.avatar)}` : null,
      tier: this.tiers.public(this.tiers.of(total)),
      totalCoins: total,
      isNew,
      look,
    };
    this.present.set(user.id, { user, lastSeen: now });

    // Tính năng tương tác của địa điểm (mục tiêu chung, quyền mời/ném sau khi tặng quà...)
    const featureExtra =
      giftInfo && this.features && location
        ? this.features.afterGift({ user, location, now, gift: ev.gift, coins: ev.gift.coins * ev.gift.count })
        : [];
    if (this.paused) return this.drop();
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
        const claimed = this.features && location ? this.features.onChat({ user, location, now, text }) : null;
        if (claimed) {
          out.push(...claimed);
          break;
        }
        const hit = this.rules.pickChat(location, text, (tierId) => this.tiers.atLeast(total, tierId));
        if (!hit) return this.drop();
        const shown = (hit.match ? hit.match[1] ?? hit.match[0] : text).slice(0, 80);
        // speak: câu chat thường (không phải lệnh) được đọc thành tiếng giữa đám đông
        out.push(this.make(ctx, hit.rule, { text: shown, speak: hit.match ? '' : shown }));
        break;
      }
      case 'gift': {
        const { rule, tierBefore, tierAfter } = giftInfo;
        const g = ev.gift;
        const data = { gift: { name: g.name, count: g.count, coins: g.coins, total: g.coins * g.count, image: g.image } };
        if (rule) {
          const a = this.make(ctx, rule, data);
          out.push(...(this.features && location ? this.features.transform(a, { user, location, now }) : [a]));
        }
        if (tierAfter.rank > tierBefore.rank) {
          out.push(
            this.make(
              ctx,
              { action: 'tier_up', priority: 3, say: 'Chúc mừng {name} lên {tier}!' },
              { from: tierBefore, to: tierAfter },
            ),
          );
        }
        out.push(...featureExtra);
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

    const rule = this.rules.pickGiftRule(location, g);

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
      data: { ...data, ...(rule.params ? { params: rule.params } : {}), ...(rule.label ? { cmd: { label: rule.label, icon: rule.icon || '' } } : {}) },
      say: sayAllowed ? fillTemplate(rule.say, vars) : '',
      test: ev.test,
      ts: now,
    };
  }

  /** Hành động không đi qua luật (do tính năng tạo ra). */
  makeRaw(location, user, action, data = {}, { priority = 1, say = '' } = {}) {
    return { id: ++this.seq, action, priority, location, user, data, say, test: false, ts: Date.now() };
  }

  /** Phát hành động từ ngoài luồng sự kiện (vd. đơn pha xong); bỏ qua khi đang tạm dừng. */
  emitAction(a) {
    if (this.paused) return;
    this.counts.actions++;
    this.emit('action', a);
  }

  /** Tìm người đang trong quán theo tên (không dấu, khớp đúng > bắt đầu bằng > chứa). */
  findUser(name, excludeId) {
    const k = norm(name).replace(/^@/, '');
    if (!k) return null;
    const list = [...this.present.values()].filter((p) => p.user.id !== excludeId).sort((a, b) => b.lastSeen - a.lastSeen);
    const n = (p) => norm(p.user.name);
    const hit = list.find((p) => n(p) === k) || list.find((p) => n(p).startsWith(k)) || list.find((p) => n(p).includes(k));
    return hit ? hit.user : null;
  }

  /** Ngoại hình hiện tại: kiểu nhân vật giữ mãi, to/nhỏ và cánh chỉ giữ trong ngày. */
  lookOf(ev, player, day) {
    let saved = ev.test ? this.testLooks.get(ev.user.id) : null;
    if (!saved && player?.look) {
      try {
        saved = JSON.parse(player.look);
      } catch {
        saved = null;
      }
    }
    const look = { style: saved?.style ?? hashId(ev.user.id), scale: 1, wings: false, day };
    if (saved?.day === day) {
      look.scale = saved.scale ?? 1;
      look.wings = Boolean(saved.wings);
    }
    return look;
  }

  changeLook(ev, look, kind, day) {
    const next = { ...look, day };
    if (kind === 'grow') next.scale = Math.min(2.2, Math.round((look.scale + 0.3) * 100) / 100);
    if (kind === 'shrink') next.scale = Math.max(0.5, Math.round((look.scale - 0.25) * 100) / 100);
    if (kind === 'wings') next.wings = true;
    if (kind === 'change') next.style = (look.style + 1 + Math.floor(Math.random() * 997)) % 1_000_000;
    if (ev.test) this.testLooks.set(ev.user.id, next);
    else this.store.setLook(ev.user.id, next);
    return next;
  }

  /** Những người đang trong quán (tương tác gần đây), mới nhất trước. */
  presentList(limit = 300, now = Date.now()) {
    const maxAge = (this.cfg.presenceMinutes || 15) * 60_000;
    for (const [id, p] of this.present) if (now - p.lastSeen > maxAge) this.present.delete(id);
    return [...this.present.values()].sort((a, b) => b.lastSeen - a.lastSeen).slice(0, limit).map((p) => p.user);
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

/** Số cố định từ id người xem (để mỗi người có sẵn một kiểu nhân vật riêng). */
function hashId(id) {
  let h = 2166136261;
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % 1_000_000;
}
