// Nguồn TIKTOK qua thư viện tiktok-live-connector (dịch vụ ký Euler Stream).
// Chỉ phần này biết định dạng tin nhắn của TikTok; ra ngoài đều là sự kiện chuẩn.

import { EventEmitter } from 'node:events';
import { makeEvent } from '../events.js';

// ---- Chuyển tin nhắn TikTok -> sự kiện chuẩn (hàm thuần, có test) ----

function first(...vals) {
  return vals.find((v) => v !== undefined && v !== null && v !== '');
}

export function mapUser(msg) {
  const u = msg?.user || msg || {};
  // Ưu tiên id số (không đổi), handle @ người dùng có thể tự đổi
  const id = first(u.userId, u.id, msg?.userId, u.uniqueId, u.displayId, msg?.uniqueId);
  return {
    id: id ? String(id) : null,
    name: first(u.nickname, msg?.nickname, u.uniqueId, u.displayId, id),
    avatar: first(
      u.avatarThumb?.urlList?.[0],
      u.avatarThumb?.url?.[0],
      u.profilePicture?.urls?.[0],
      u.profilePicture?.url?.[0],
      msg?.profilePictureUrl,
    ),
  };
}

function msgId(msg, type) {
  const id = first(msg?.common?.msgId, msg?.msgId);
  return id ? `tt-${type}-${id}` : undefined;
}

/**
 * Quà combo (giftType 1) bắn nhiều tin trong lúc người xem bấm liên tục;
 * chỉ tính khi combo KẾT THÚC (repeatEnd), lúc đó repeatCount là tổng số lượng.
 * Trả về null nếu chưa phải tin cuối.
 */
export function mapGift(msg) {
  const g = msg.gift || msg.giftDetails || msg.extendedGiftInfo || {};
  const giftType = first(g.type, g.giftType, msg.giftType);
  const repeatEnd = Boolean(first(msg.repeatEnd, 0));
  if (giftType === 1 && !repeatEnd) return null;
  const user = mapUser(msg);
  if (!user.id) return null;
  return makeEvent('gift', {
    id: msgId(msg, 'gift') || `tt-gift-${user.id}-${first(msg.groupId, msg.logId, Date.now())}-${msg.repeatCount}`,
    source: 'tiktok',
    user,
    gift: {
      id: first(msg.giftId, g.id),
      name: first(g.name, g.giftName, msg.giftName, 'Quà'),
      coins: Number(first(g.diamondCount, msg.diamondCount, 0)),
      count: Number(first(msg.repeatCount, msg.comboCount, 1)) || 1,
      image: first(g.image?.urlList?.[0], g.image?.url?.[0], msg.giftPictureUrl),
    },
  });
}

export function mapSimple(type, msg) {
  const user = mapUser(msg);
  if (!user.id) return null;
  const extra = {};
  if (type === 'chat') extra.text = first(msg.content, msg.comment, '');
  if (type === 'like') extra.likes = Number(first(msg.count, msg.likeCount, 1));
  return makeEvent(type, { id: msgId(msg, type), source: 'tiktok', user, ...extra });
}

// ---- Kết nối ----

export class TikTokSource extends EventEmitter {
  constructor({ username, signApiKey }) {
    super();
    this.name = 'tiktok';
    this.username = username;
    this.signApiKey = signApiKey;
  }

  async start() {
    if (!this.username) throw new Error('Chưa cấu hình username TikTok (TIKTOK_USERNAME)');
    let lib;
    try {
      lib = await import('tiktok-live-connector');
    } catch {
      throw new Error('Chưa cài thư viện: chạy "npm install tiktok-live-connector"');
    }
    const { TikTokLiveConnection, WebcastEvent, ControlEvent } = lib;
    const conn = new TikTokLiveConnection(this.username, {
      ...(this.signApiKey ? { signApiKey: this.signApiKey } : {}),
      enableExtendedGiftInfo: true,
    });
    this.conn = conn;

    const forward = (fn) => (msg) => {
      try {
        const ev = fn(msg);
        if (ev) this.emit('event', ev);
      } catch (err) {
        this.emit('status', { state: 'connected', detail: `Lỗi đọc tin nhắn: ${err.message}` });
      }
    };
    conn.on(WebcastEvent.MEMBER, forward((m) => mapSimple('join', m)));
    conn.on(WebcastEvent.LIKE, forward((m) => mapSimple('like', m)));
    conn.on(WebcastEvent.CHAT, forward((m) => mapSimple('chat', m)));
    conn.on(WebcastEvent.FOLLOW, forward((m) => mapSimple('follow', m)));
    conn.on(WebcastEvent.SHARE, forward((m) => mapSimple('share', m)));
    conn.on(WebcastEvent.GIFT, forward(mapGift));

    conn.on(ControlEvent.DISCONNECTED, () => {
      // Chỉ báo khi đã từng kết nối được; lỗi lúc kết nối đã được báo ở dưới
      if (this.connected) this.emit('status', { state: 'disconnected', detail: 'TikTok ngắt kết nối' });
      this.connected = false;
    });
    conn.on(WebcastEvent.STREAM_END, () => this.emit('status', { state: 'offline', detail: 'Buổi live đã kết thúc' }));
    conn.on(ControlEvent.ERROR, (err) => this.emit('status', { state: 'error', detail: String(err?.message || err) }));

    this.emit('status', { state: 'connecting', detail: `Đang kết nối @${this.username}` });
    try {
      const state = await conn.connect();
      this.connected = true;
      this.emit('status', { state: 'connected', detail: `Đã vào phòng live ${state?.roomId || ''}`.trim() });
    } catch (err) {
      const msg = String(err?.message || err);
      // Kênh chưa live: không phải lỗi hệ thống, cứ chờ rồi thử lại
      const offline = /offline|not live|isn't online|UserOffline/i.test(msg) || err?.name === 'UserOfflineError';
      this.emit('status', { state: offline ? 'offline' : 'error', detail: offline ? 'Kênh chưa phát live' : msg });
    }
  }

  async stop() {
    try {
      await this.conn?.disconnect();
    } catch {
      // bỏ qua
    }
    this.conn?.removeAllListeners?.();
    this.conn = null;
  }
}
