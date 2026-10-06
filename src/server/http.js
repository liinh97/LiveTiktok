// Máy chủ HTTP: trang hiển thị (cho OBS), bảng điều khiển (cho điện thoại), API, proxy ảnh đại diện.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { ROOT } from '../config.js';
import { log } from '../log.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

const PUBLIC = path.join(ROOT, 'public');
const LOCATIONS = path.join(ROOT, 'locations');

export function createHttpServer({ config, api }) {
  const avatars = new AvatarProxy(config.avatarHosts || []);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const p = decodeURIComponent(url.pathname);

      if (p === '/') return redirect(res, '/dashboard/');
      if (p === '/health') return json(res, 200, { ok: true });
      if (p === '/world' || p === '/dashboard') return redirect(res, `${p}/${url.search}`);
      if (p === '/avatar') return avatars.serve(url.searchParams.get('u'), res);
      if (p.startsWith('/api/')) return handleApi(req, res, url, p.slice(5), config, api);
      if (p.startsWith('/locations/')) return serveFile(res, LOCATIONS, p.slice('/locations/'.length));
      if (p.startsWith('/world/') || p.startsWith('/dashboard/')) {
        return serveFile(res, PUBLIC, p.endsWith('/') ? `${p}index.html` : p);
      }
      return send(res, 404, 'Không tìm thấy');
    } catch (err) {
      log.error(`HTTP ${req.method} ${req.url}: ${err.message}`);
      if (!res.headersSent) send(res, 500, 'Lỗi máy chủ');
    }
  });
  return server;
}

async function handleApi(req, res, url, route, config, api) {
  const token = config.dashboardToken;
  if (token && req.headers['x-token'] !== token && url.searchParams.get('token') !== token) {
    return json(res, 401, { error: 'Sai mật khẩu bảng điều khiển' });
  }
  if (req.method === 'GET') {
    if (route === 'status') return json(res, 200, api.status(Number(url.searchParams.get('after')) || 0));
    if (route === 'leaderboard') return json(res, 200, api.leaderboard());
    return json(res, 404, { error: 'Không có API này' });
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'Sai phương thức' });

  const body = await readJson(req);
  const handlers = {
    location: () => api.setLocation(body.location ?? null),
    pause: () => api.setPaused(Boolean(body.paused)),
    block: () => api.block(String(body.userId || ''), body.name),
    unblock: () => api.unblock(String(body.userId || '')),
    simulate: () => api.simulate(body),
    reconnect: () => api.reconnect(),
    'dismiss-alert': () => api.dismissAlert(String(body.key || '')),
  };
  if (!handlers[route]) return json(res, 404, { error: 'Không có API này' });
  try {
    return json(res, 200, { ok: true, result: (await handlers[route]()) ?? null });
  } catch (err) {
    return json(res, 400, { error: err.message });
  }
}

function serveFile(res, base, rel) {
  const file = path.resolve(base, `.${path.sep}${rel}`);
  if (!file.startsWith(base + path.sep)) return send(res, 403, 'Không được phép');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Không tìm thấy');
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 16_384) {
        reject(new Error('Dữ liệu quá lớn'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function json(res, status, data) {
  res.writeHead(status, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}
function send(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}
function redirect(res, to) {
  res.writeHead(302, { location: to });
  res.end();
}

/**
 * Tải hộ ảnh đại diện TikTok (link ảnh có thể hết hạn / bị chặn khi trang hiển thị tải trực tiếp)
 * và giữ trong bộ nhớ. Chỉ cho phép các tên miền ảnh của TikTok để không bị lợi dụng.
 */
class AvatarProxy {
  constructor(hosts, max = 500) {
    this.hosts = hosts;
    this.max = max;
    this.cache = new Map();
  }

  allowed(u) {
    try {
      const { protocol, hostname } = new URL(u);
      return protocol === 'https:' && this.hosts.some((h) => hostname === h || hostname.endsWith(`.${h}`));
    } catch {
      return false;
    }
  }

  async serve(u, res) {
    if (!u || !this.allowed(u)) return send(res, 400, 'Ảnh không hợp lệ');
    let item = this.cache.get(u);
    if (!item) {
      try {
        const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
        const type = r.headers.get('content-type') || '';
        const buf = Buffer.from(await r.arrayBuffer());
        if (!r.ok || !type.startsWith('image/') || buf.length > 2_000_000) return send(res, 502, 'Không tải được ảnh');
        item = { type, buf };
        this.cache.set(u, item);
        if (this.cache.size > this.max) this.cache.delete(this.cache.keys().next().value);
      } catch {
        return send(res, 502, 'Không tải được ảnh');
      }
    }
    res.writeHead(200, { 'content-type': item.type, 'cache-control': 'max-age=86400' });
    res.end(item.buf);
  }
}
