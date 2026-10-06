// Quản lý nguồn sự kiện: tự kết nối lại (chờ tăng dần), lỗi liên tục thì chuyển sang nguồn dự phòng.

import { EventEmitter } from 'node:events';
import { log } from '../log.js';

const RETRY_MS = [2000, 4000, 8000, 16000, 30000, 60000];
const OFFLINE_RETRY_MS = 30000;

export class SourceManager extends EventEmitter {
  /** factories: { tên: () => nguồn }, order: [chính, dự phòng?] */
  constructor({ factories, order, failuresBeforeSwitch = 3 }) {
    super();
    this.factories = factories;
    this.order = order.filter(Boolean);
    for (const n of this.order) if (!factories[n]) throw new Error(`Nguồn sự kiện không tồn tại: ${n}`);
    this.failuresBeforeSwitch = failuresBeforeSwitch;
    this.index = 0;
    this.failures = 0;
    this.status = { source: this.order[0], state: 'idle', detail: '', since: Date.now() };
    this.stopped = true;
    this.downSince = Date.now();
  }

  get activeName() {
    return this.order[this.index];
  }

  async start() {
    this.stopped = false;
    await this.connect();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    await this.detach();
  }

  async detach() {
    const s = this.source;
    this.source = null;
    if (!s) return;
    s.removeAllListeners();
    await s.stop().catch(() => {});
  }

  async connect() {
    await this.detach();
    if (this.stopped) return;
    const name = this.activeName;
    const source = this.factories[name]();
    this.source = source;
    source.on('event', (ev) => this.emit('event', ev));
    source.on('status', (st) => this.onStatus(source, st));
    this.setStatus({ state: 'connecting', detail: '' });
    try {
      await source.start();
    } catch (err) {
      this.onStatus(source, { state: 'error', detail: err.message });
    }
  }

  onStatus(source, st) {
    if (source !== this.source) return; // trạng thái của nguồn cũ đã bị thay
    this.setStatus(st);
    if (st.state === 'connected') {
      this.failures = 0;
      return;
    }
    if (st.state === 'connecting') return;
    // disconnected / offline / error -> thử lại
    if (this.stopped) return;
    if (st.state === 'offline') return this.scheduleRetry(OFFLINE_RETRY_MS);

    this.failures++;
    if (this.order.length > 1 && this.failures >= this.failuresBeforeSwitch) {
      const from = this.activeName;
      this.index = (this.index + 1) % this.order.length;
      this.failures = 0;
      log.warn(`Nguồn "${from}" lỗi liên tục — chuyển sang "${this.activeName}"`);
      this.emit('switched', { from, to: this.activeName });
      return this.scheduleRetry(1000);
    }
    this.scheduleRetry(RETRY_MS[Math.min(this.failures - 1, RETRY_MS.length - 1)]);
  }

  scheduleRetry(ms) {
    clearTimeout(this.retryTimer);
    log.info(`Thử kết nối lại "${this.activeName}" sau ${Math.round(ms / 1000)} giây`);
    this.retryTimer = setTimeout(() => this.connect(), ms);
  }

  setStatus(st) {
    const changed = st.state !== this.status.state || this.activeName !== this.status.source;
    // downSince: mất kết nối từ lúc nào (không bị đặt lại khi trạng thái nhảy qua lại connecting/error)
    if (st.state === 'connected') this.downSince = null;
    else this.downSince ??= Date.now();
    this.status = {
      source: this.activeName,
      state: st.state,
      detail: st.detail || '',
      since: changed ? Date.now() : this.status.since,
      downSince: this.downSince,
    };
    if (changed) log.info(`Nguồn ${this.activeName}: ${st.state}${st.detail ? ` — ${st.detail}` : ''}`);
    this.emit('status', this.status);
  }

  /** Bảng điều khiển bấm "Kết nối lại". */
  async reconnect() {
    this.failures = 0;
    clearTimeout(this.retryTimer);
    await this.connect();
  }
}
