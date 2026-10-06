import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ContentFilter, stripDiacritics } from '../src/core/filter.js';

const f = new ContentFilter({ words: ['# ghi chú', 'đụ', 'dm', 'vcl', 'tài xỉu', 'óc chó'], maskedName: 'Ẩn' });

test('bỏ dấu tiếng Việt', () => {
  assert.equal(stripDiacritics('Đặng Thị Hà'), 'Dang Thi Ha');
});

test('khớp nguyên từ, không bắt nhầm từ chứa nó', () => {
  assert.equal(f.isBad('đụ má'), true);
  assert.equal(f.isBad('đụng xe rồi'), false);
  assert.equal(f.isBad('ĐM quán này'), true);
  assert.equal(f.isBad('đm'), true); // "đm" bỏ dấu thành "dm"
  assert.equal(f.isBad('admin ơi'), false);
  assert.equal(f.isBad('vui VCL'), true);
});

test('cụm từ nhiều chữ, cả có dấu và gõ không dấu', () => {
  assert.equal(f.isBad('vào chơi tài xỉu đi'), true);
  assert.equal(f.isBad('mày óc chó à'), true);
  assert.equal(f.isBad('tài khoản xỉu'), false);
});

test('chặn link và số điện thoại quảng cáo', () => {
  assert.equal(f.chatAllowed('vào web abc.com nhé'), false);
  assert.equal(f.chatAllowed('liên hệ 0912 345 678'), false);
  assert.equal(f.chatAllowed('quán mở tới 12h hả'), true);
});

test('tên xấu bị thay, tên dài bị cắt', () => {
  assert.equal(f.cleanName('dm tao'), 'Ẩn');
  assert.equal(f.cleanName('Lan Anh'), 'Lan Anh');
  assert.equal(f.cleanName('a'.repeat(40)).length, 24);
});
