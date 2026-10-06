import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Scheduler } from '../src/core/scheduler.js';

const locations = { a: {}, b: {}, c: {} };
const slots = [
  { start: '06:00', end: '11:00', location: 'a' },
  { start: '14:00', end: '18:00', location: 'b' },
  { start: '20:00', end: '24:00', location: 'c' },
];
// Giờ Việt Nam = UTC+7
const vn = (hh, mm = 0) => new Date(Date.UTC(2026, 9, 6, hh - 7, mm));

function make(clock) {
  return new Scheduler({ slots, timezone: 'Asia/Ho_Chi_Minh', locations, now: () => clock.t });
}

test('chọn địa điểm theo giờ địa phương', () => {
  const clock = { t: vn(7) };
  const s = make(clock);
  assert.equal(s.current().location, 'a');
  clock.t = vn(12);
  s.tick();
  assert.equal(s.current().location, null);
  assert.deepEqual(s.current().next, { location: 'b', start: '14:00' });
  clock.t = vn(23, 59);
  s.tick();
  assert.equal(s.current().location, 'c');
  assert.deepEqual(s.current().next, { location: 'a', start: '06:00' });
});

test('phát sự kiện change khi đổi địa điểm', () => {
  const clock = { t: vn(10, 59) };
  const s = make(clock);
  const seen = [];
  s.on('change', (c) => seen.push(c.location));
  s.tick();
  clock.t = vn(11);
  s.tick();
  clock.t = vn(14);
  s.tick();
  assert.deepEqual(seen, [null, 'b']);
});

test('ghi đè tay tự hết khi sang khung giờ khác', () => {
  const clock = { t: vn(15) };
  const s = make(clock);
  s.setOverride('c');
  assert.equal(s.current().location, 'c');
  assert.equal(s.current().overridden, true);
  clock.t = vn(17);
  s.tick();
  assert.equal(s.current().location, 'c');
  clock.t = vn(18, 1);
  s.tick();
  assert.equal(s.current().location, null);
  assert.equal(s.current().overridden, false);
});

test('báo lỗi lịch sai', () => {
  assert.throws(() => new Scheduler({ slots: [{ start: '10:00', end: '09:00', location: 'a' }], timezone: 'UTC', locations }));
  assert.throws(() => new Scheduler({ slots: [{ start: '10:00', end: '11:00', location: 'khong-co' }], timezone: 'UTC', locations }));
});
