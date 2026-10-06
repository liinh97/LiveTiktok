// Dữ liệu DÙNG CHUNG cho cả thế giới: hồ sơ người xem, tổng xu, quà, ca live, người bị chặn.
// Dùng SQLite có sẵn trong Node (node:sqlite) nên không cần cài thêm gì.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar TEXT,
  total_coins INTEGER NOT NULL DEFAULT 0,
  visits INTEGER NOT NULL DEFAULT 0,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS gifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL,
  location TEXT,
  session_id INTEGER,
  gift_name TEXT NOT NULL,
  count INTEGER NOT NULL,
  coins INTEGER NOT NULL,
  day TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS gifts_day ON gifts(day);
CREATE INDEX IF NOT EXISTS gifts_session ON gifts(session_id);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE TABLE IF NOT EXISTS blocked (
  player_id TEXT PRIMARY KEY,
  name TEXT,
  ts INTEGER NOT NULL
);
`;

// Coi là "lượt ghé mới" nếu lần trước cách đây hơn 30 phút.
const VISIT_GAP_MS = 30 * 60 * 1000;

export class Store {
  constructor(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
    // Nâng cấp dữ liệu cũ: thêm cột ngoại hình nhân vật
    const cols = this.db.prepare('PRAGMA table_info(players)').all().map((c) => c.name);
    if (!cols.includes('look')) this.db.exec('ALTER TABLE players ADD COLUMN look TEXT');
    this.q = {
      getPlayer: this.db.prepare('SELECT * FROM players WHERE id = ?'),
      insertPlayer: this.db.prepare(
        'INSERT INTO players (id, name, avatar, visits, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)',
      ),
      updatePlayer: this.db.prepare('UPDATE players SET name = ?, avatar = COALESCE(?, avatar), visits = visits + ?, last_seen = ? WHERE id = ?'),
      addCoins: this.db.prepare('UPDATE players SET total_coins = total_coins + ? WHERE id = ?'),
      setLook: this.db.prepare('UPDATE players SET look = ? WHERE id = ?'),
      insertGift: this.db.prepare(
        'INSERT INTO gifts (player_id, location, session_id, gift_name, count, coins, day, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ),
      topDay: this.db.prepare(`
        SELECT p.id, p.name, p.avatar, p.total_coins AS totalCoins, SUM(g.coins) AS coins
        FROM gifts g JOIN players p ON p.id = g.player_id
        WHERE g.day = ? GROUP BY g.player_id ORDER BY coins DESC LIMIT ?`),
      topAll: this.db.prepare(
        'SELECT id, name, avatar, total_coins AS totalCoins, total_coins AS coins FROM players WHERE total_coins > 0 ORDER BY total_coins DESC LIMIT ?',
      ),
      startSession: this.db.prepare('INSERT INTO sessions (location, started_at) VALUES (?, ?)'),
      endSession: this.db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL'),
      closeDangling: this.db.prepare('UPDATE sessions SET ended_at = started_at WHERE ended_at IS NULL'),
      session: this.db.prepare('SELECT * FROM sessions WHERE id = ?'),
      sessionStats: this.db.prepare(
        'SELECT COALESCE(SUM(coins), 0) AS coins, COUNT(*) AS gifts, COUNT(DISTINCT player_id) AS gifters FROM gifts WHERE session_id = ?',
      ),
      dayByLocation: this.db.prepare(
        'SELECT COALESCE(location, \'-\') AS location, SUM(coins) AS coins, COUNT(DISTINCT player_id) AS gifters FROM gifts WHERE day = ? GROUP BY location ORDER BY coins DESC',
      ),
      block: this.db.prepare('INSERT OR REPLACE INTO blocked (player_id, name, ts) VALUES (?, ?, ?)'),
      unblock: this.db.prepare('DELETE FROM blocked WHERE player_id = ?'),
      blockedList: this.db.prepare('SELECT player_id AS id, name, ts FROM blocked ORDER BY ts DESC'),
    };
    // Ca live đang dở khi máy tắt đột ngột: đóng lại để thống kê không bị treo.
    this.q.closeDangling.run();
  }

  getPlayer(id) {
    return this.q.getPlayer.get(String(id)) || null;
  }

  /** Cập nhật/ tạo hồ sơ khi người xem xuất hiện. Trả về { player, isNew }. */
  touch(user, { countVisit = false, now = Date.now() } = {}) {
    const existing = this.getPlayer(user.id);
    if (!existing) {
      this.q.insertPlayer.run(String(user.id), user.name, user.avatar || null, countVisit ? 1 : 0, now, now);
      return { player: this.getPlayer(user.id), isNew: true };
    }
    const newVisit = countVisit && now - existing.last_seen > VISIT_GAP_MS ? 1 : 0;
    this.q.updatePlayer.run(user.name, user.avatar || null, newVisit, now, String(user.id));
    return { player: this.getPlayer(user.id), isNew: false };
  }

  setLook(id, look) {
    this.q.setLook.run(JSON.stringify(look), String(id));
  }

  /** Ghi quà, cộng xu vào hồ sơ. Trả về tổng xu mới của người đó. */
  addGift({ playerId, location, sessionId, giftName, count, coins, day, ts = Date.now() }) {
    this.q.insertGift.run(String(playerId), location ?? null, sessionId ?? null, giftName, count, coins, day, ts);
    this.q.addCoins.run(coins, String(playerId));
    return this.getPlayer(playerId).total_coins;
  }

  topDay(day, limit = 5) {
    return this.q.topDay.all(day, limit);
  }
  topAll(limit = 5) {
    return this.q.topAll.all(limit);
  }

  startSession(location, now = Date.now()) {
    return Number(this.q.startSession.run(location, now).lastInsertRowid);
  }
  endSession(id, now = Date.now()) {
    if (id) this.q.endSession.run(now, id);
  }
  sessionStats(id, now = Date.now()) {
    const s = id ? this.q.session.get(id) : null;
    if (!s) return null;
    const agg = this.q.sessionStats.get(id);
    const hours = Math.max(((s.ended_at || now) - s.started_at) / 3_600_000, 1 / 60);
    return {
      id,
      location: s.location,
      startedAt: s.started_at,
      coins: agg.coins,
      gifts: agg.gifts,
      gifters: agg.gifters,
      coinsPerHour: Math.round(agg.coins / hours),
    };
  }
  dayByLocation(day) {
    return this.q.dayByLocation.all(day);
  }

  block(id, name) {
    this.q.block.run(String(id), name || null, Date.now());
  }
  unblock(id) {
    this.q.unblock.run(String(id));
  }
  blockedList() {
    return this.q.blockedList.all();
  }
}
