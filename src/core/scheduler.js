// Lịch mở cửa: khung giờ nào mở địa điểm nào. Có thể ghi đè tay từ bảng điều khiển.

import { EventEmitter } from 'node:events';
import { localTime, parseHHMM } from '../util.js';

export class Scheduler extends EventEmitter {
  constructor({ slots, timezone, locations, now = () => new Date() }) {
    super();
    this.timezone = timezone;
    this.now = now;
    this.slots = slots.map((s) => {
      if (!locations[s.location]) throw new Error(`Lịch: địa điểm "${s.location}" không tồn tại trong locations/`);
      const start = parseHHMM(s.start);
      const end = parseHHMM(s.end);
      if (end <= start) throw new Error(`Lịch: khung ${s.start}-${s.end} không hợp lệ (giờ kết thúc phải sau giờ bắt đầu)`);
      return { ...s, startMin: start, endMin: end };
    });
    this.override = null;
    this.state = this.compute();
  }

  compute() {
    const { minutes } = localTime(this.now(), this.timezone);
    const slot = this.slots.find((s) => minutes >= s.startMin && minutes < s.endMin) || null;
    // Khung kế tiếp (trong ngày, hoặc khung đầu tiên của ngày mai)
    const upcoming = [...this.slots].sort((a, b) => a.startMin - b.startMin);
    const next = upcoming.find((s) => s.startMin > minutes) || upcoming[0] || null;
    return {
      location: this.override ? this.override : slot ? slot.location : null,
      slot: slot ? { location: slot.location, start: slot.start, end: slot.end } : null,
      next: next ? { location: next.location, start: next.start } : null,
      overridden: Boolean(this.override),
    };
  }

  current() {
    return this.state;
  }

  /** Ghi đè địa điểm (null = theo lịch). Ghi đè tự hết khi sang khung giờ khác. */
  setOverride(locationId) {
    this.override = locationId || null;
    this.overrideSlot = this.compute().slot?.start ?? null;
    this.tick();
  }

  tick() {
    let next = this.compute();
    if (this.override && (next.slot?.start ?? null) !== this.overrideSlot) {
      this.override = null;
      next = this.compute();
    }
    const changed = next.location !== this.state.location;
    this.state = next;
    if (changed) this.emit('change', next);
    return changed;
  }

  start(everyMs = 15_000) {
    this.timer = setInterval(() => this.tick(), everyMs);
  }
  stop() {
    clearInterval(this.timer);
  }

  publicSlots(locations) {
    return this.slots.map((s) => ({
      start: s.start,
      end: s.end,
      location: s.location,
      name: locations[s.location].name,
      emoji: locations[s.location].emoji,
    }));
  }
}
