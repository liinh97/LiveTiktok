// Báo động: hiện trên bảng điều khiển + gửi Telegram (có thời gian chờ để không spam).

import { log } from '../log.js';

export class Alerts {
  constructor({ telegram, cooldownSec = 600, worldName = '' }) {
    this.telegram = telegram;
    this.cooldownMs = cooldownSec * 1000;
    this.worldName = worldName;
    this.lastSent = new Map();
    this.active = new Map(); // key -> { key, level, message, ts }
    this.history = [];
  }

  /** Bật một báo động (vd. mất kết nối). Gửi Telegram nếu key chưa gửi trong thời gian chờ. */
  raise(key, message, level = 'warn') {
    const isNew = !this.active.has(key);
    this.active.set(key, { key, level, message, ts: Date.now() });
    if (isNew) this.push(level, message);
    const last = this.lastSent.get(key) || 0;
    if (Date.now() - last >= this.cooldownMs) {
      this.lastSent.set(key, Date.now());
      this.send(`${level === 'error' ? '🚨' : '⚠️'} ${message}`);
    }
  }

  /** Tắt báo động khi sự cố đã hết; báo "đã ổn" nếu trước đó có báo. */
  resolve(key, message) {
    if (!this.active.has(key)) return;
    this.active.delete(key);
    if (message) {
      this.push('info', message);
      this.send(`✅ ${message}`);
    }
  }

  /** Thông báo một lần (vd. quà lớn). */
  notify(message) {
    this.push('info', message);
    this.send(message);
  }

  push(level, message) {
    this.history.push({ ts: Date.now(), level, message });
    if (this.history.length > 50) this.history.shift();
    log[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info'](message);
  }

  send(text) {
    this.telegram?.send(this.worldName ? `[${this.worldName}] ${text}` : text);
  }

  snapshot() {
    return { active: [...this.active.values()], history: [...this.history].reverse() };
  }
}
