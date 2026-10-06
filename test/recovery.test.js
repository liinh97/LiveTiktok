import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { Watchdog } from '../src/core/watchdog.js';
import { Alerts } from '../src/notify/alerts.js';
import { SourceManager } from '../src/sources/manager.js';

// Nguồn giả: kết nối được hay không tuỳ cấu hình
class FakeSource extends EventEmitter {
  constructor(name, ok, log) {
    super();
    this.name = name;
    this.ok = ok;
    this.log = log;
  }
  async start() {
    this.log.push(this.name);
    if (!this.ok) throw new Error('hỏng');
    this.emit('status', { state: 'connected' });
  }
  async stop() {}
}

test('nguồn chính lỗi liên tục thì chuyển sang nguồn dự phòng', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const log = [];
  const m = new SourceManager({
    factories: { main: () => new FakeSource('main', false, log), backup: () => new FakeSource('backup', true, log) },
    order: ['main', 'backup'],
    failuresBeforeSwitch: 3,
  });
  const switched = [];
  m.on('switched', (s) => switched.push(s));
  await m.start();
  for (let i = 0; i < 6; i++) {
    t.mock.timers.tick(60_000);
    await new Promise((r) => setImmediate(r));
  }
  assert.deepEqual(log.slice(0, 4), ['main', 'main', 'main', 'backup']);
  assert.deepEqual(switched, [{ from: 'main', to: 'backup' }]);
  assert.equal(m.status.state, 'connected');
  assert.equal(m.status.source, 'backup');
  await m.stop();
});

test('sự kiện từ nguồn được chuyển tiếp', async () => {
  const src = new FakeSource('main', true, []);
  const m = new SourceManager({ factories: { main: () => src }, order: ['main'] });
  const got = [];
  m.on('event', (e) => got.push(e));
  await m.start();
  src.emit('event', { id: 1 });
  assert.deepEqual(got, [{ id: 1 }]);
  await m.stop();
});

function watchdogSetup({ state = 'connected', downSince = null, lastEventAt = 0, worlds = 1, open = true, now }) {
  const sent = [];
  const alerts = new Alerts({ telegram: { send: (t) => sent.push(t) }, cooldownSec: 600 });
  const wd = new Watchdog({
    config: { watchdog: { sourceDownAlertSec: 120, silentAlertSec: 180, noWorldAlertSec: 60 } },
    sources: { status: { source: 'tiktok', state, since: 0, downSince } },
    pipeline: { lastEventAt },
    scheduler: { current: () => ({ location: open ? 'a' : null }) },
    hub: { count: () => worlds },
    alerts,
    now: () => now,
  });
  return { wd, alerts, sent };
}

test('báo động khi mất kết nối quá lâu trong giờ mở cửa, báo ổn khi kết nối lại', () => {
  const s = watchdogSetup({ state: 'error', downSince: 0, now: 200_000 });
  s.wd.check();
  assert.equal(s.alerts.snapshot().active[0].key, 'source');
  assert.match(s.sent[0], /tiktok/);
  s.wd.sources.status = { source: 'tiktok', state: 'connected', since: 200_000, downSince: null };
  s.wd.pipeline.lastEventAt = 200_000;
  s.wd.now = () => 201_000;
  s.wd.check();
  assert.equal(s.alerts.snapshot().active.length, 0);
  assert.match(s.sent.at(-1), /kết nối lại/);
});

test('ngoài giờ mở cửa thì không báo', () => {
  const s = watchdogSetup({ state: 'offline', downSince: 0, open: false, worlds: 0, now: 999_999 });
  s.wd.check();
  assert.equal(s.sent.length, 0);
});

test('báo khi kết nối nhưng im lặng quá lâu, và khi không có trang hiển thị', () => {
  const s = watchdogSetup({ lastEventAt: 0, worlds: 0, now: 200_000 });
  s.wd.check(); // lần đầu thấy thiếu trang hiển thị: bắt đầu đếm
  s.wd.now = () => 270_000;
  s.wd.check();
  const keys = s.alerts.snapshot().active.map((a) => a.key).sort();
  assert.deepEqual(keys, ['silent', 'world']);
});

test('không gửi lặp cùng một báo động trong thời gian chờ', () => {
  const s = watchdogSetup({ state: 'error', downSince: 0, now: 200_000 });
  s.wd.check();
  s.wd.check();
  s.wd.check();
  assert.equal(s.sent.length, 1);
});
