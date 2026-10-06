// Khởi động "thế giới chung": nối nguồn sự kiện -> lõi xử lý -> trang hiển thị + bảng điều khiển.

import path from 'node:path';
import { findMedia, loadConfig, loadLocations, ROOT } from './config.js';
import { ContentFilter } from './core/filter.js';
import { Pipeline } from './core/pipeline.js';
import { RuleBook } from './core/rules.js';
import { Scheduler } from './core/scheduler.js';
import { Store } from './core/store.js';
import { Tiers } from './core/tiers.js';
import { Watchdog } from './core/watchdog.js';
import { makeEvent } from './events.js';
import { log } from './log.js';
import { Alerts } from './notify/alerts.js';
import { Telegram } from './notify/telegram.js';
import { createHttpServer } from './server/http.js';
import { Hub } from './server/hub.js';
import { SourceManager } from './sources/manager.js';
import { SimulatorSource } from './sources/simulator.js';
import { TikTokSource } from './sources/tiktok.js';
import { localTime } from './util.js';

const config = loadConfig();
const locations = loadLocations();
const store = new Store(path.join(config.dataDir, 'world.db'));
const tiers = new Tiers(config.tiers);
const rules = new RuleBook(config.defaultRules, locations);
const filter = ContentFilter.fromFile(path.resolve(ROOT, config.filter.bannedWordsFile), config.filter);
for (const b of store.blockedList()) filter.block(b.id);

const alerts = new Alerts({ telegram: new Telegram(config.telegram), cooldownSec: config.alerts.cooldownSec, worldName: config.worldName });
const scheduler = new Scheduler({ slots: config.schedule.slots, timezone: config.timezone, locations });

// ---- Ca live: mỗi lần đổi địa điểm là một ca, để thống kê xu/giờ theo từng chủ đề ----
let sessionId = null;
function switchSession(location) {
  store.endSession(sessionId);
  sessionId = location ? store.startSession(location) : null;
}
switchSession(scheduler.current().location);

const pipeline = new Pipeline({ config, store, filter, rules, tiers, scheduler, locations, alerts, getSessionId: () => sessionId });

const sources = new SourceManager({
  factories: {
    simulator: () => new SimulatorSource(config.sources.simulator),
    tiktok: () => new TikTokSource(config.sources.tiktok),
  },
  order: [config.sources.primary, config.sources.fallback],
  failuresBeforeSwitch: config.sources.failuresBeforeSwitch,
});
sources.on('event', (ev) => {
  try {
    pipeline.process(ev);
  } catch (err) {
    log.error(`Lỗi xử lý sự kiện ${ev.type}: ${err.message}`);
  }
});
sources.on('switched', ({ from, to }) => alerts.raise('switched', `Nguồn "${from}" lỗi liên tục — đã chuyển sang "${to}"`, 'warn'));

// ---- Trạng thái gửi cho trang hiển thị ----
const today = () => localTime(new Date(), config.timezone).day;
const locPublic = (id) => (id ? { id, name: locations[id].name, emoji: locations[id].emoji } : null);

function worldState() {
  const cur = scheduler.current();
  return {
    worldName: config.worldName,
    location: cur.location ? { ...locPublic(cur.location), media: findMedia(cur.location) } : null,
    next: cur.next ? { ...locPublic(cur.next.location), start: cur.next.start } : null,
    schedule: scheduler.publicSlots(locations),
    tiers: config.tiers,
    paused: pipeline.paused,
    ...boards(),
  };
}
function boards() {
  return {
    leaderboard: store.topDay(today(), 5).map((p) => ({ ...p, tier: tiers.public(tiers.of(p.totalCoins)) })),
  };
}

const recentActions = [];
let actionSeq = 0;

const api = {
  status(afterSeq) {
    const cur = scheduler.current();
    return {
      worldName: config.worldName,
      source: sources.status,
      sourceOrder: sources.order,
      location: locPublic(cur.location),
      slot: cur.slot,
      next: cur.next ? { ...locPublic(cur.next.location), start: cur.next.start } : null,
      overridden: cur.overridden,
      locations: Object.values(locations).map((l) => locPublic(l.id)),
      paused: pipeline.paused,
      worldClients: hub.count('world'),
      session: store.sessionStats(sessionId),
      todayByLocation: store.dayByLocation(today()).map((r) => ({ ...r, name: locations[r.location] ? `${locations[r.location].emoji} ${locations[r.location].name}` : 'ngoài giờ' })),
      vndPerCoin: config.vndPerCoin,
      counts: pipeline.counts,
      alerts: alerts.snapshot(),
      blocked: store.blockedList(),
      actions: recentActions.filter((a) => a.seq > afterSeq),
      lastSeq: actionSeq,
      logs: log.since(0).slice(-40).reverse(),
    };
  },
  leaderboard() {
    return { today: store.topDay(today(), 10), allTime: store.topAll(10) };
  },
  setLocation(id) {
    if (id && !locations[id]) throw new Error(`Không có địa điểm ${id}`);
    scheduler.setOverride(id);
    return scheduler.current();
  },
  setPaused(p) {
    pipeline.setPaused(p);
    hub.broadcast('world', { type: 'paused', paused: pipeline.paused });
    log.info(p ? 'Tạm dừng hiệu ứng' : 'Bật lại hiệu ứng');
    return pipeline.paused;
  },
  block(id, name) {
    if (!id) throw new Error('Thiếu id người dùng');
    filter.block(id);
    store.block(id, name);
    hub.broadcast('world', { type: 'remove', userId: id });
    log.warn(`Đã chặn ${name || id}`);
  },
  unblock(id) {
    filter.unblock(id);
    store.unblock(id);
    log.info(`Bỏ chặn ${id}`);
  },
  simulate(body) {
    const type = body.type || 'gift';
    const user = { id: body.userId || 'test-user', name: body.name || 'Người thử', avatar: null };
    const ev = makeEvent(type, {
      source: 'dashboard',
      test: true,
      user,
      text: type === 'chat' ? body.text || 'Xin chào!' : undefined,
      likes: type === 'like' ? 10 : undefined,
      gift: type === 'gift' ? { name: body.giftName || 'Quà thử', coins: Number(body.coins) || 1, count: Number(body.count) || 1 } : undefined,
    });
    return pipeline.process(ev).length;
  },
  reconnect() {
    return sources.reconnect();
  },
  dismissAlert(key) {
    alerts.resolve(key);
  },
};

// ---- Máy chủ ----
const server = createHttpServer({ config, api });
const hub = new Hub({ server, onWorldConnect: (send) => send({ type: 'hello', state: worldState() }) });

pipeline.on('action', (a) => {
  hub.broadcast('world', { type: 'action', action: a });
  recentActions.push({
    seq: ++actionSeq,
    ts: a.ts,
    action: a.action,
    test: a.test,
    user: a.user ? { id: a.user.id, name: a.user.name, tier: a.user.tier?.name } : null,
    coins: a.data?.gift?.total || 0,
    text: a.data?.text || a.data?.gift?.name || (a.data?.count ? `+${a.data.count}` : ''),
  });
  if (recentActions.length > 100) recentActions.shift();
});

// Bảng xếp hạng: gộp cập nhật trong 1 giây
let boardTimer = null;
pipeline.on('gift', () => {
  if (boardTimer) return;
  boardTimer = setTimeout(() => {
    boardTimer = null;
    hub.broadcast('world', { type: 'boards', ...boards() });
  }, 1000);
});

scheduler.on('change', (cur) => {
  switchSession(cur.location);
  const name = cur.location ? `${locations[cur.location].emoji} ${locations[cur.location].name}` : 'đóng cửa';
  log.info(`Đổi địa điểm: ${name}`);
  alerts.notify(cur.location ? `Mở cửa ${name}` : 'Phố đóng cửa — nhớ tắt live nếu chưa tắt');
  hub.broadcast('world', { type: 'state', state: worldState() });
});

const watchdog = new Watchdog({ config, sources, pipeline, scheduler, hub, alerts, locations });

server.listen(config.port, config.host, async () => {
  log.info(`Thế giới "${config.worldName}" chạy tại http://localhost:${config.port}`);
  log.info(`  Trang hiển thị (OBS):  http://localhost:${config.port}/world/`);
  log.info(`  Bảng điều khiển:       http://localhost:${config.port}/dashboard/`);
  if (config.sources.primary === 'simulator') log.warn('Đang dùng nguồn GIẢ LẬP — đổi LIVE_SOURCE=tiktok khi live thật');
  scheduler.start();
  pipeline.start();
  watchdog.start();
  await sources.start();
});

// Tắt gọn gàng (pm2 / Ctrl+C)
let stopping = false;
async function shutdown(sig) {
  if (stopping) return;
  stopping = true;
  log.info(`Nhận ${sig}, đang tắt...`);
  scheduler.stop();
  pipeline.stop();
  watchdog.stop();
  await sources.stop();
  store.endSession(sessionId);
  hub.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  log.error(`Lỗi không lường trước: ${err.stack || err.message}`);
  alerts.raise('crash', `Hệ thống gặp lỗi: ${err.message}`, 'error');
});
process.on('unhandledRejection', (err) => log.error(`Promise lỗi: ${err?.stack || err}`));
