import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapGift, mapSimple, mapUser } from '../src/sources/tiktok.js';

const user = { id: '7001', displayId: 'lananh99', nickname: 'Lan Anh', avatarThumb: { urlList: ['https://p16.tiktokcdn.com/a.jpg'] } };

test('lấy thông tin người dùng (định dạng proto v3)', () => {
  assert.deepEqual(mapUser({ user }), { id: '7001', name: 'Lan Anh', avatar: 'https://p16.tiktokcdn.com/a.jpg' });
});

test('lấy thông tin người dùng (định dạng phẳng kiểu cũ)', () => {
  assert.deepEqual(mapUser({ userId: '9', uniqueId: 'abc', nickname: 'ABC', profilePictureUrl: 'x' }), { id: '9', name: 'ABC', avatar: 'x' });
});

test('quà combo: bỏ qua tin giữa chừng, chỉ tính tin cuối', () => {
  const base = { user, giftId: 5655, gift: { name: 'Rose', diamondCount: 1, type: 1 }, common: { msgId: 'm1' } };
  assert.equal(mapGift({ ...base, repeatCount: 3, repeatEnd: 0 }), null);
  const ev = mapGift({ ...base, repeatCount: 7, repeatEnd: 1 });
  assert.equal(ev.type, 'gift');
  assert.equal(ev.gift.name, 'Rose');
  assert.equal(ev.gift.coins, 1);
  assert.equal(ev.gift.count, 7);
  assert.equal(ev.id, 'tt-gift-m1');
});

test('quà không combo được tính ngay', () => {
  const ev = mapGift({ user, gift: { name: 'Lion', diamondCount: 29999, type: 2 }, repeatCount: 1, repeatEnd: 0, common: { msgId: 'm2' } });
  assert.equal(ev.gift.coins, 29999);
  assert.equal(ev.gift.count, 1);
});

test('quà định dạng giftDetails (không tải danh sách quà lúc kết nối)', () => {
  const giftDetails = { giftName: 'Rose', diamondCount: 1, giftType: 1, giftImage: { urlList: ['https://p16.tiktokcdn.com/rose.png'] } };
  assert.equal(mapGift({ user, giftId: 5655, giftDetails, repeatCount: 2, repeatEnd: 0 }), null);
  const ev = mapGift({ user, giftId: 5655, giftDetails, repeatCount: 4, repeatEnd: 1, common: { msgId: 'm3' } });
  assert.equal(ev.gift.name, 'Rose');
  assert.equal(ev.gift.coins, 1);
  assert.equal(ev.gift.count, 4);
  assert.equal(ev.gift.image, 'https://p16.tiktokcdn.com/rose.png');
});

test('chat, like', () => {
  assert.equal(mapSimple('chat', { user, content: 'hello', common: { msgId: 'c1' } }).text, 'hello');
  assert.equal(mapSimple('like', { user, count: 15 }).likes, 15);
  assert.equal(mapSimple('chat', { content: 'không có user' }), null);
});
