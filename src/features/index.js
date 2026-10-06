// TÍNH NĂNG TƯƠNG TÁC theo địa điểm (gọi đồ, đổi nhạc, gọi dancer, mục tiêu chung, troll bạn bè...).
// Bật/tắt và cấu hình trong locations/<id>/location.json -> "features". Trạng thái giữ ở máy chủ
// để mọi màn hình (OBS, trình duyệt) thấy giống nhau và tải lại trang không mất.
//
// Mỗi tính năng là một lớp có thể có:
//   onChat(ctx)      -> mảng hành động nếu "nhận" bình luận này (vd. "!goi tra sua"), không thì null
//   afterGift(ctx)   -> mảng hành động thêm sau khi có quà (vd. góp vào mục tiêu chung)
//   transform(a, ctx)-> thay một hành động bằng mảng hành động khác (vd. "call_dancer" -> dancer tới)
//   tick(now)        -> chạy định kỳ (đơn pha xong, hết bài...)
//   onWorldMessage(msg) -> tin từ trang hiển thị (vd. bài nhạc đã hết)
//   publicState()    -> dữ liệu gửi xuống trang hiển thị
// ctx = { user, location, now, text?, gift?, coins? }

import { EventEmitter } from 'node:events';
import { Dancers } from './dancers.js';
import { Goal } from './goal.js';
import { Music } from './music.js';
import { Orders } from './orders.js';
import { Troll } from './troll.js';

const KINDS = { orders: Orders, music: Music, dancers: Dancers, goal: Goal, troll: Troll };

export class Features extends EventEmitter {
  /**
   * makeAction(location, user, action, data, { priority, say }) -> hành động chuẩn
   * findUser(name, excludeId) -> người xem đang trong quán khớp tên (hoặc null)
   */
  constructor({ locations, makeAction, findUser, now = () => Date.now() }) {
    super();
    this.locations = locations;
    this.makeAction = makeAction;
    this.findUser = findUser;
    this.now = now;
    this.byLocation = new Map();
  }

  /** Các tính năng của một địa điểm (tạo khi cần). */
  of(location) {
    if (!location || !this.locations[location]?.features) return [];
    if (!this.byLocation.has(location)) {
      const env = {
        now: this.now,
        make: (user, action, data = {}, opts = {}) => this.makeAction(location, user, action, data, opts),
        emit: (a) => this.emit('action', a),
        changed: () => this.emit('change', location),
        findUser: this.findUser,
      };
      const list = Object.entries(this.locations[location].features)
        .filter(([k, cfg]) => KINDS[k] && cfg && cfg.enabled !== false)
        .map(([k, cfg]) => Object.assign(new KINDS[k](cfg, env), { kind: k }));
      this.byLocation.set(location, list);
    }
    return this.byLocation.get(location);
  }

  onChat(ctx) {
    for (const f of this.of(ctx.location)) {
      const out = f.onChat?.(ctx);
      if (out) return out;
    }
    return null;
  }

  afterGift(ctx) {
    return this.of(ctx.location).flatMap((f) => f.afterGift?.(ctx) || []);
  }

  transform(action, ctx) {
    for (const f of this.of(ctx.location)) {
      const out = f.transform?.(action, ctx);
      if (out) return out;
    }
    return [action];
  }

  tick(location, now = this.now()) {
    for (const f of this.of(location)) f.tick?.(now);
  }

  onWorldMessage(location, msg) {
    for (const f of this.of(location)) f.onWorldMessage?.(msg);
  }

  publicState(location) {
    const out = {};
    for (const f of this.of(location)) out[f.kind] = f.publicState?.() ?? null;
    return out;
  }
}

export { norm } from './norm.js';
