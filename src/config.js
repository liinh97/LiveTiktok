// Đọc cấu hình: config/config.json <- config/config.local.json <- biến môi trường.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Không đọc được ${path.relative(ROOT, file)}: ${err.message}`);
  }
}

function deepMerge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

export function loadConfig(env = process.env) {
  let cfg = readJson(path.join(ROOT, 'config/config.json'), {});
  cfg = deepMerge(cfg, readJson(path.join(ROOT, 'config/config.local.json'), {}));

  if (env.PORT) cfg.port = Number(env.PORT);
  if (env.LIVE_SOURCE) cfg.sources.primary = env.LIVE_SOURCE;
  if (env.LIVE_FALLBACK_SOURCE) cfg.sources.fallback = env.LIVE_FALLBACK_SOURCE;
  if (env.TIKTOK_USERNAME) cfg.sources.tiktok.username = env.TIKTOK_USERNAME;
  if (env.EULER_API_KEY) cfg.sources.tiktok.signApiKey = env.EULER_API_KEY;
  if (env.TELEGRAM_BOT_TOKEN) cfg.telegram.botToken = env.TELEGRAM_BOT_TOKEN;
  if (env.TELEGRAM_CHAT_ID) cfg.telegram.chatId = env.TELEGRAM_CHAT_ID;
  if (env.DASHBOARD_TOKEN) cfg.dashboardToken = env.DASHBOARD_TOKEN;

  cfg.dataDir = path.resolve(ROOT, cfg.dataDir || 'data');
  cfg.schedule = readJson(path.join(ROOT, 'config/schedule.json'), { slots: [] });
  cfg.defaultRules = readJson(path.join(ROOT, 'config/rules.default.json'), {});
  return cfg;
}

const MEDIA = { video: ['background.mp4', 'background.webm'], image: ['background.jpg', 'background.jpeg', 'background.png', 'background.webp'] };

/** Video/ảnh nền thật trong locations/<id>/assets/ (nếu có). Quét mỗi lần gọi để thả file vào là dùng được ngay. */
export function findMedia(id, dir = path.join(ROOT, 'locations')) {
  const out = {};
  for (const [kind, names] of Object.entries(MEDIA)) {
    const hit = names.find((n) => fs.existsSync(path.join(dir, id, 'assets', n)));
    if (hit) out[kind] = `assets/${hit}`;
  }
  return Object.keys(out).length ? out : null;
}

/** Quét thư mục locations/: mỗi thư mục có location.json + scene.js là một địa điểm. */
export function loadLocations(dir = path.join(ROOT, 'locations')) {
  const out = {};
  for (const name of fs.readdirSync(dir)) {
    const meta = path.join(dir, name, 'location.json');
    if (!fs.existsSync(meta)) continue;
    const data = readJson(meta, {});
    out[name] = { id: name, name: data.name || name, emoji: data.emoji || '📍', rules: data.rules || {} };
  }
  return out;
}
