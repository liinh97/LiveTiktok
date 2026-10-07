import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanForSpeech, Tts } from '../src/tts.js';

test('giọng đọc: làm sạch chữ trước khi đọc', () => {
  assert.equal(cleanForSpeech('Quán vui quáaaaaa 😂😂 https://x.com @abc ngon!!!!'), 'Quán vui quáaaa ngon!!!');
  assert.equal(cleanForSpeech('😂😂😂'), null); // chỉ có emoji: không đọc
  assert.equal(cleanForSpeech('123 456'), null); // không có chữ
  assert.ok(cleanForSpeech('a '.repeat(200)).length <= 100);
});

test('giọng đọc: tắt thì không làm gì; mỗi người luôn cùng một giọng', () => {
  const off = new Tts({ enabled: false }, '/tmp');
  assert.equal(off.enabled, false);
  assert.equal(off.request('xin chào', 'u1'), null);
  const t = new Tts({ provider: 'off' }, '/tmp');
  assert.deepEqual(t.voiceOf('u1'), t.voiceOf('u1'));
});
