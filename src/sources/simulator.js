// Nguồn GIẢ LẬP: sinh sự kiện ngẫu nhiên để thử toàn bộ luồng mà không cần live thật.
// Chỉ dùng để thử — không bao giờ đặt làm nguồn dự phòng khi đang live thật.

import { EventEmitter } from 'node:events';
import { makeEvent } from '../events.js';
import { pick } from '../util.js';

const HO = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Vũ', 'Đặng', 'Bùi', 'Đỗ', 'Ngô'];
const TEN = ['Lan Anh', 'Minh', 'Tuấn', 'Hà', 'Linh', 'Hùng', 'Trang', 'Nam', 'Thảo', 'Đức', 'Mai', 'Phúc', 'Ngọc', 'Quân', 'Vy'];
const CHATS = [
  'hello cả nhà',
  'quán vui quá',
  'cho mình 1 ly với',
  'tối nay đông ghê',
  'lần đầu vào đây',
  '!nhac Lạc Trôi',
  '!nhac Nơi này có anh',
  'cá to quá trời',
  'nem chua rán ngon không ạ',
  'thả tim nè ❤️',
  '!goi tra sua',
  '!goi ot',
  '!goi tang luc',
  '!goi soda',
  '!nhac 2',
  '!vote 4',
];

// Giá xu tham khảo; danh sách thật lấy từ TikTok
export const SIM_GIFTS = [
  { name: 'Rose', coins: 1, weight: 40 },
  { name: 'TikTok', coins: 1, weight: 15 },
  { name: 'Ice Cream Cone', coins: 1, weight: 8 },
  { name: 'GG', coins: 1, weight: 8 },
  { name: 'Finger Heart', coins: 5, weight: 15 },
  { name: 'Perfume', coins: 20, weight: 8 },
  { name: 'Doughnut', coins: 30, weight: 10 },
  { name: 'Hand Hearts', coins: 100, weight: 6 },
  { name: 'Corgi', coins: 299, weight: 3 },
  { name: 'Money Gun', coins: 500, weight: 2 },
  { name: 'Galaxy', coins: 1000, weight: 0.8 },
  { name: 'Lion', coins: 29999, weight: 0.05 },
];

function weighted(list) {
  const sum = list.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * sum;
  for (const x of list) if ((r -= x.weight) <= 0) return x;
  return list[0];
}

export class SimulatorSource extends EventEmitter {
  constructor({ eventsPerSecond = 2 } = {}) {
    super();
    this.name = 'simulator';
    this.rate = eventsPerSecond;
    this.users = Array.from({ length: 60 }, (_, i) => ({
      id: `sim-${i + 1}`,
      name: `${pick(HO)} ${pick(TEN)}`,
      avatar: null,
    }));
  }

  async start() {
    this.emit('status', { state: 'connected', detail: 'Đang giả lập sự kiện' });
    this.timer = setInterval(() => this.tick(), 1000 / this.rate);
  }

  async stop() {
    clearInterval(this.timer);
    this.emit('status', { state: 'disconnected' });
  }

  tick() {
    const user = pick(this.users);
    const r = Math.random();
    let ev;
    if (r < 0.3) ev = makeEvent('join', { source: this.name, user });
    else if (r < 0.55) ev = makeEvent('like', { source: this.name, user, likes: 1 + Math.floor(Math.random() * 15) });
    else if (r < 0.75) ev = makeEvent('chat', { source: this.name, user, text: pick(CHATS) });
    else if (r < 0.78) ev = makeEvent('follow', { source: this.name, user });
    else if (r < 0.8) ev = makeEvent('share', { source: this.name, user });
    else {
      const g = weighted(SIM_GIFTS);
      const count = g.coins <= 5 && Math.random() < 0.4 ? 1 + Math.floor(Math.random() * 10) : 1;
      ev = makeEvent('gift', { source: this.name, user, gift: { name: g.name, coins: g.coins, count } });
    }
    this.emit('event', ev);
  }
}
