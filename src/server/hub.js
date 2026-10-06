// Kênh WebSocket tới trang hiển thị (role=world). Trang hiển thị tự kết nối lại nếu rớt.

import { WebSocketServer } from 'ws';

export class Hub {
  constructor({ server, onWorldConnect }) {
    this.clients = new Set();
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws, req) => {
      const role = new URL(req.url, 'http://x').searchParams.get('role') || 'world';
      ws.role = role;
      ws.isAlive = true;
      this.clients.add(ws);
      ws.on('pong', () => (ws.isAlive = true));
      ws.on('close', () => this.clients.delete(ws));
      ws.on('error', () => this.clients.delete(ws));
      if (role === 'world') onWorldConnect?.((msg) => send(ws, msg));
    });
    // Phát hiện kết nối chết (vd. OBS treo) để đếm số trang hiển thị cho đúng
    this.pinger = setInterval(() => {
      for (const ws of this.clients) {
        if (!ws.isAlive) {
          ws.terminate();
          this.clients.delete(ws);
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }, 15_000);
  }

  broadcast(role, msg) {
    const data = JSON.stringify(msg);
    for (const ws of this.clients) if (ws.role === role && ws.readyState === 1) ws.send(data);
  }

  count(role) {
    let n = 0;
    for (const ws of this.clients) if (ws.role === role && ws.readyState === 1) n++;
    return n;
  }

  close() {
    clearInterval(this.pinger);
    for (const ws of this.clients) ws.terminate();
    this.wss.close();
  }
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
