import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { ContentFilter } from '../src/core/filter.js';
import { Pipeline } from '../src/core/pipeline.js';
import { RuleBook } from '../src/core/rules.js';
import { Store } from '../src/core/store.js';
import { Tiers } from '../src/core/tiers.js';
import { makeEvent } from '../src/events.js';
import { Features } from '../src/features/index.js';

const locations = {
  bar: {
    id: 'bar',
    name: 'Bar',
    emoji: '🍸',
    rules: { commands: [{ gift: ['Corgi'], action: 'call_dancer', label: 'Gọi dancer' }] },
    features: {
      orders: {
        cooldownSec: 60,
        prepSec: 4,
        maxQueue: 3,
        creditSec: 30,
        menu: [
          { id: 'tra-sua', name: 'Trà sữa', emoji: '🧋', effect: 'hiccup', aliases: ['ts'] },
          { id: 'ot', name: 'Nước ớt', emoji: '🌶️', effect: 'fire' },
        ],
      },
      music: {
        cooldownSec: 60,
        priorityCoins: 30,
        defaultSec: 100,
        playlist: [
          { id: 1, title: 'Quẩy Lên', bpm: 128 },
          { id: 2, title: 'Gà Con Disco', bpm: 118 },
          { id: 3, title: 'Chill', bpm: 96 },
        ],
      },
      dancers: { visitSec: 20, list: [{ id: 'ga', name: 'Gà Quay', costume: 'chicken' }, { id: 'gau', name: 'Gấu Béo', costume: 'bear' }] },
      goal: { label: 'Tháp trà sữa', target: 100, growBy: 0.5 },
    },
  },
};

function setup() {
  const clock = { t: 1_000_000_000 };
  const config = loadConfig({});
  const p = new Pipeline({
    config,
    store: new Store(':memory:'),
    filter: new ContentFilter({ words: [] }),
    rules: new RuleBook(config.defaultRules, locations),
    tiers: new Tiers(config.tiers),
    scheduler: { current: () => ({ location: 'bar' }) },
    locations,
    alerts: { notify() {}, raise() {} },
  });
  const f = new Features({ locations, makeAction: (...a) => p.makeRaw(...a), findUser: (n, x) => p.findUser(n, x), now: () => clock.t });
  p.features = f;
  const emitted = [];
  f.on('action', (a) => emitted.push(a));
  const u = (id, name = id) => ({ id, name });
  const chat = (user, text) => p.process(makeEvent('chat', { source: 't', user, text }), clock.t);
  const gift = (user, name, coins) => p.process(makeEvent('gift', { source: 't', user, gift: { name, coins } }), clock.t);
  const tick = (sec) => {
    clock.t += sec * 1000;
    f.tick('bar', clock.t);
  };
  return { p, f, clock, emitted, u, chat, gift, tick };
}

test('gọi đồ: món theo tên/không dấu/viết tắt, pha xong mới mang ra, giới hạn mỗi người', () => {
  const s = setup();
  const lan = s.u('lan', 'Lan Anh');
  assert.equal(s.chat(lan, '!goi tra sua')[0].action, 'order_placed');
  assert.equal(s.chat(lan, '!goi ot')[0].action, 'order_wait'); // chưa hết thời gian chờ
  assert.equal(s.chat(s.u('b'), '!gọi TS')[0].data.item.id, 'tra-sua');
  assert.equal(s.chat(s.u('c'), '!goi pizza')[0].action, 'order_menu'); // không có món -> hiện thực đơn
  assert.equal(s.f.publicState('bar').orders.waiting, 2);
  s.tick(4);
  const ready = () => s.emitted.filter((a) => a.action === 'order_ready');
  assert.deepEqual(ready().map((a) => a.user.id), ['lan']);
  s.tick(4);
  assert.equal(ready().length, 2);
  s.tick(60);
  assert.equal(s.chat(lan, '!goi ot')[0].action, 'order_placed');
});

test('gọi đồ: hàng chờ đầy thì báo bận', () => {
  const s = setup();
  for (const id of ['a', 'b', 'c']) s.chat(s.u(id), '!goi ot');
  assert.equal(s.chat(s.u('d'), '!goi ot')[0].action, 'order_busy');
});

test('mời / ném bánh: cần tặng quà trước, tìm người theo tên không dấu', () => {
  const s = setup();
  const minh = s.u('minh', 'Minh Tuấn');
  s.chat(s.u('lan', 'Lan Anh'), 'chào cả nhà');
  assert.equal(s.chat(minh, '!moi lan anh')[0].action, 'social_hint');
  s.gift(minh, 'Rose', 1);
  const [t] = s.chat(minh, '!moi lan');
  assert.equal(t.action, 'treat');
  assert.equal(t.data.to.id, 'lan');
  assert.equal(s.chat(minh, '!nem lan')[0].action, 'social_hint'); // mỗi lần tặng chỉ 1 lần
  s.gift(minh, 'Rose', 1);
  assert.equal(s.chat(minh, '!nem ai đó không có')[0].action, 'social_notfound');
  s.gift(minh, 'Rose', 1);
  assert.equal(s.chat(minh, '!nem Lan')[0].action, 'throw_pie');
});

test('nhạc: tự phát, chọn bài, bầu, chen hàng bằng quà, hết bài thì đổi', () => {
  const s = setup();
  s.tick(0.5); // tự phát bài đầu
  assert.equal(s.f.publicState('bar').music.now.id, 1);
  const a = s.u('a');
  assert.equal(s.chat(a, '!nhac 3')[0].action, 'song_requested');
  assert.equal(s.chat(a, '!nhac 2')[0].action, 'song_wait'); // chờ giữa 2 lần chọn
  assert.equal(s.chat(s.u('b'), '!nhac 2')[0].action, 'song_requested');
  s.chat(s.u('c'), '!vote 2');
  assert.deepEqual(s.f.publicState('bar').music.queue.map((q) => q.id), [2, 3]); // bài 2 nhiều phiếu hơn
  s.gift(s.u('d'), 'Doughnut', 30);
  const [r] = s.chat(s.u('d'), '!nhac chill');
  assert.equal(r.data.priority, true);
  assert.deepEqual(s.f.publicState('bar').music.queue.map((q) => q.id), [3, 2]); // chen lên đầu
  s.f.onWorldMessage('bar', { type: 'song_end', songId: 1 }); // mới phát < 5 giây: bỏ qua
  assert.equal(s.f.publicState('bar').music.now.id, 1);
  s.tick(102);
  assert.equal(s.f.publicState('bar').music.now.id, 3);
  assert.ok(s.emitted.some((x) => x.action === 'song_change' && x.data.song.id === 3));
  assert.equal(s.chat(s.u('e'), '!nhac 99')[0].action, 'music_list');
});

test('dancer: quà gọi dancer, chọn dancer trước, hết dancer thì xếp hàng', () => {
  const s = setup();
  s.chat(s.u('a'), '!dancer gau');
  const [v] = s.gift(s.u('a'), 'Corgi', 299);
  assert.equal(v.action, 'dancer_visit');
  assert.equal(v.data.dancer.id, 'gau');
  assert.equal(s.gift(s.u('b'), 'Corgi', 299)[0].data.dancer.id, 'ga');
  assert.equal(s.gift(s.u('c'), 'Corgi', 299)[0].action, 'dancer_queued');
  s.tick(21);
  assert.ok(s.emitted.some((x) => x.action === 'dancer_visit' && x.user.id === 'c'));
});

test('mục tiêu chung: cộng dồn quà, đủ thì thưởng cả quán và tăng mục tiêu', () => {
  const s = setup();
  s.gift(s.u('a'), 'Doughnut', 30);
  s.gift(s.u('b'), 'Doughnut', 30);
  assert.equal(s.f.publicState('bar').goal.progress, 60);
  const out = s.gift(s.u('b'), 'Hand Hearts', 50);
  const g = out.find((x) => x.action === 'goal_reached');
  assert.ok(g);
  assert.equal(g.data.best, 'b');
  assert.deepEqual(s.f.publicState('bar').goal, { label: 'Tháp trà sữa', progress: 10, target: 150, round: 2 });
});
