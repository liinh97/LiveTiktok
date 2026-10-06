import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { ContentFilter } from '../src/core/filter.js';
import { Pipeline } from '../src/core/pipeline.js';
import { RuleBook } from '../src/core/rules.js';
import { Store } from '../src/core/store.js';
import { Tiers } from '../src/core/tiers.js';
import { makeEvent } from '../src/events.js';

// Hai địa điểm giả để kiểm tra dữ liệu dùng chung và ghi đè luật
const locations = {
  a: { id: 'a', name: 'A', emoji: 'A', rules: {} },
  b: {
    id: 'b',
    name: 'B',
    emoji: 'B',
    rules: {
      chat: [{ match: '^!lenh\\s+(.+)$', action: 'command', minTier: 'regular' }, { action: 'chat' }],
      gift: [{ minCoins: 1, action: 'b_gift', params: { emoji: '🍹' } }],
    },
  },
};

function setup(location = 'a') {
  const config = loadConfig({});
  const store = new Store(':memory:');
  const notes = [];
  const alerts = { notify: (m) => notes.push(m), raise: (k, m) => notes.push(m) };
  let current = location;
  const p = new Pipeline({
    config,
    store,
    filter: new ContentFilter({ words: ['dm'] }),
    rules: new RuleBook(config.defaultRules, locations),
    tiers: new Tiers(config.tiers),
    scheduler: { current: () => ({ location: current }) },
    locations,
    alerts,
    getSessionId: () => 1,
  });
  return { p, store, notes, setLocation: (l) => (current = l) };
}

const lan = { id: 'u1', name: 'Lan Anh' };
const gift = (coins, count = 1, extra = {}) => makeEvent('gift', { source: 't', user: lan, gift: { name: 'Rose', coins, count }, ...extra });

test('bậc quà theo TỔNG xu (giá × số lượng)', () => {
  const { p } = setup();
  const [small] = p.process(gift(1, 5));
  assert.equal(small.action, 'gift_small');
  assert.equal(small.data.gift.total, 5);
  assert.equal(small.say, 'Cảm ơn Lan Anh đã tặng 5 Rose!');
  assert.equal(p.process(gift(30))[0].action, 'gift_medium');
  assert.equal(p.process(gift(100, 6))[0].action, 'gift_big');
  assert.equal(p.process(gift(29999))[0].action, 'gift_huge');
});

test('địa điểm ghi đè luật + params chuyển nguyên xuống scene', () => {
  const { p } = setup('b');
  const [a] = p.process(gift(5000));
  assert.equal(a.action, 'b_gift');
  assert.deepEqual(a.data.params, { emoji: '🍹' });
});

test('hồ sơ dùng chung giữa các địa điểm: xu cộng dồn, lên cấp', () => {
  const { p, store, setLocation } = setup('a');
  p.process(gift(600));
  setLocation('b');
  const out = p.process(gift(500));
  assert.equal(store.getPlayer('u1').total_coins, 1100);
  assert.equal(out[0].location, 'b');
  assert.equal(out[0].user.tier.id, 'silver');
  assert.equal(out[1].action, 'tier_up');
  assert.equal(out[1].data.to.name, 'VIP Bạc');
});

test('lọc trùng theo id sự kiện', () => {
  const { p } = setup();
  const ev = gift(1, 1, { id: 'same' });
  assert.equal(p.process(ev).length, 1);
  assert.equal(p.process(ev).length, 0);
});

test('quà của người bị chặn vẫn được ghi nhưng không lên sóng', () => {
  const { p, store } = setup();
  p.filter.block('u1');
  assert.equal(p.process(gift(100)).length, 0);
  assert.equal(store.getPlayer('u1').total_coins, 100);
});

test('tạm dừng: không hiệu ứng nhưng vẫn ghi quà', () => {
  const { p, store } = setup();
  p.setPaused(true);
  assert.equal(p.process(gift(50)).length, 0);
  assert.equal(store.getPlayer('u1').total_coins, 50);
});

test('sự kiện thử không ghi vào thống kê', () => {
  const { p, store } = setup();
  const out = p.process(gift(500, 1, { test: true }));
  assert.equal(out[0].action, 'gift_big');
  assert.equal(store.getPlayer('u1'), null);
});

test('chat có từ cấm bị bỏ; lệnh có điều kiện cấp', () => {
  const { p, notes } = setup('b');
  const chat = (text) => p.process(makeEvent('chat', { source: 't', user: lan, text }));
  assert.equal(chat('dm quán').length, 0);
  assert.equal(chat('!lenh abc')[0].action, 'chat'); // chưa đủ cấp
  p.process(gift(100)); // lên Khách quen
  const [a] = chat('!lenh abc');
  assert.equal(a.action, 'command');
  assert.equal(a.data.text, 'abc');
  chat('dm');
  chat('dm');
  assert.ok(notes.some((n) => n.includes('bị lọc 3 lần')));
});

test('tên có từ cấm được thay khi lên sóng', () => {
  const { p } = setup();
  const [a] = p.process(makeEvent('follow', { source: 't', user: { id: 'x', name: 'dm abc' } }));
  assert.equal(a.user.name, 'Khách bí ẩn');
});

test('thả tim bị giới hạn tần suất mỗi người', () => {
  const { p } = setup();
  const like = () => makeEvent('like', { source: 't', user: lan, likes: 3 });
  assert.equal(p.process(like(), 1_000_000).length, 1);
  assert.equal(p.process(like(), 1_005_000).length, 0);
  assert.equal(p.process(like(), 1_011_000).length, 1);
});

test('đông người vào cùng lúc: gộp phần dư thành một thông báo', () => {
  const { p } = setup();
  let shown = 0;
  for (let i = 0; i < 12; i++) shown += p.process(makeEvent('join', { source: 't', user: { id: `j${i}`, name: `N${i}` } }), 5_000_000).length;
  assert.equal(shown, 8);
  assert.equal(p.flushCrowd().data.count, 4);
});

test('quà lớn được báo về điện thoại', () => {
  const { p, notes } = setup();
  p.process(gift(1000));
  assert.ok(notes.some((n) => n.includes('1000 xu')));
});

test('ngoài giờ mở cửa: quà vẫn được ghi và cảm ơn', () => {
  const { p, store } = setup(null);
  const [a] = p.process(gift(30));
  assert.equal(a.location, null);
  assert.equal(a.action, 'gift_medium');
  assert.equal(store.getPlayer('u1').total_coins, 30);
});

// ---- Lệnh theo loại quà, ngoại hình, người trong quán ----
const cmdLocations = {
  c: {
    id: 'c',
    name: 'C',
    emoji: 'C',
    rules: {
      commands: [
        { gift: ['Rose'], action: 'jump', label: 'Nhảy 1 cái', icon: '🌹' },
        { gift: ['Finger Heart'], action: 'grow', look: 'grow', label: 'To lên' },
        { gift: ['Ice Cream Cone'], action: 'shrink', look: 'shrink' },
        { gift: ['Hand Hearts', '5660'], action: 'wings', look: 'wings' },
        { gift: ['Doughnut'], action: 'change_char', look: 'change' },
      ],
    },
  },
};
function setupCmd({ day = '2026-10-06' } = {}) {
  const config = loadConfig({});
  const store = new Store(':memory:');
  const p = new Pipeline({
    config,
    store,
    filter: new ContentFilter({ words: [] }),
    rules: new RuleBook(config.defaultRules, cmdLocations),
    tiers: new Tiers(config.tiers),
    scheduler: { current: () => ({ location: 'c' }) },
    locations: cmdLocations,
    alerts: { notify() {}, raise() {} },
  });
  return { p, store, ts: (d = day) => new Date(`${d}T12:00:00+07:00`).getTime() };
}
const giftOf = (name, coins, ts) => makeEvent('gift', { source: 't', user: lan, gift: { name, coins }, ts });
const joinAt = (ts) => makeEvent('join', { source: 't', user: lan, ts });

test('quà theo loại là lệnh riêng, ưu tiên hơn bậc xu; quà khác vẫn theo bậc xu', () => {
  const { p } = setupCmd();
  const [a] = p.process(giftOf('rose', 1));
  assert.equal(a.action, 'jump');
  assert.deepEqual(a.data.cmd, { label: 'Nhảy 1 cái', icon: '🌹' });
  assert.equal(p.process(giftOf('Money Gun', 500))[0].action, 'gift_big');
  // khớp theo id quà
  assert.equal(p.process(makeEvent('gift', { source: 't', user: lan, gift: { id: 5660, name: 'Tên khác', coins: 100 } }))[0].action, 'wings');
});

test('ngoại hình: to lên / nhỏ lại có giới hạn, cánh, đổi nhân vật; lưu lại cho lần sau', () => {
  const { p, store, ts } = setupCmd();
  const style0 = p.process(joinAt(ts()), ts())[0].user.look.style;
  let look;
  for (let i = 0; i < 6; i++) look = p.process(giftOf('Finger Heart', 5, ts() + i), ts() + i)[0].user.look;
  assert.equal(look.scale, 2.2);
  for (let i = 0; i < 10; i++) look = p.process(giftOf('Ice Cream Cone', 1, ts() + 100 + i), ts() + 100 + i)[0].user.look;
  assert.equal(look.scale, 0.5);
  look = p.process(giftOf('Hand Hearts', 100, ts() + 200), ts() + 200)[0].user.look;
  assert.equal(look.wings, true);
  look = p.process(giftOf('Doughnut', 30, ts() + 300), ts() + 300)[0].user.look;
  assert.notEqual(look.style, style0);
  assert.equal(JSON.parse(store.getPlayer('u1').look).style, look.style);
});

test('ngoại hình: kiểu nhân vật giữ mãi, to/nhỏ và cánh hết hạn sang ngày mới', () => {
  const { p, ts } = setupCmd();
  p.process(giftOf('Finger Heart', 5, ts()), ts());
  const changed = p.process(giftOf('Doughnut', 30, ts() + 1), ts() + 1)[0].user.look;
  p.process(giftOf('Hand Hearts', 100, ts() + 2), ts() + 2);
  const same = p.process(joinAt(ts() + 3), ts() + 3)[0].user.look;
  assert.equal(same.scale, 1.3);
  assert.equal(same.wings, true);
  const next = p.process(joinAt(ts('2026-10-07')), ts('2026-10-07'))[0].user.look;
  assert.equal(next.style, changed.style);
  assert.equal(next.scale, 1);
  assert.equal(next.wings, false);
});

test('người trong quán: mới nhất trước, hết hạn sau một lúc không tương tác, bị chặn thì ra', () => {
  const { p } = setupCmd();
  const t0 = 1_000_000_000;
  p.process(makeEvent('join', { source: 't', user: { id: 'a', name: 'A' } }), t0);
  p.process(makeEvent('join', { source: 't', user: { id: 'b', name: 'B' } }), t0 + 1000);
  assert.deepEqual(p.presentList(10, t0 + 2000).map((u) => u.id), ['b', 'a']);
  p.filter.block('b');
  p.process(makeEvent('chat', { source: 't', user: { id: 'b', name: 'B' }, text: 'hi' }), t0 + 3000);
  assert.deepEqual(p.presentList(10, t0 + 4000).map((u) => u.id), ['a']);
  assert.equal(p.presentList(10, t0 + 15 * 60_000 + 500).length, 0);
});
