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
  for (let i = 0; i < 10; i++) shown += p.process(makeEvent('join', { source: 't', user: { id: `j${i}`, name: `N${i}` } }), 5_000_000).length;
  assert.equal(shown, 3);
  assert.equal(p.flushCrowd().data.count, 7);
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
