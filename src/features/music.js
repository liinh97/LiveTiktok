// ĐỔI NHẠC trong danh sách bài có sẵn: "!nhac 3" (hoặc tên bài) xếp hàng, "!vote 3" bầu bài trong hàng chờ,
// "!baihat" xem danh sách. Tặng quà (>= priorityCoins) rồi "!nhac" thì được chen lên đầu hàng.
// Hết bài thì phát bài được bầu nhiều nhất, không ai chọn thì tự phát bài kế tiếp.
// Mỗi bài có bpm để đám đông nhảy đúng nhịp. File nhạc đặt trong thư mục địa điểm (vd. music/abc.mp3).
//
// cfg: { playlist: [{ id, title, artist?, file?, bpm?, duration? }], cooldownSec, priorityCoins, creditSec, defaultSec }

import { norm } from './norm.js';

export class Music {
  constructor(cfg, env) {
    this.env = env;
    this.playlist = (cfg.playlist || []).map((s, i) => ({ ...s, id: s.id ?? i + 1, bpm: s.bpm || 120, key: norm(s.title) }));
    this.cooldownMs = (cfg.cooldownSec ?? 120) * 1000;
    this.priorityCoins = cfg.priorityCoins ?? 30;
    this.creditMs = (cfg.creditSec ?? 90) * 1000;
    this.defaultMs = (cfg.defaultSec ?? 200) * 1000;
    this.queue = []; // { song, by, votes: Set, priority, at }
    this.last = new Map();
    this.credits = new Map();
    this.now = null; // { song, by, startedAt }
    this.history = [];
  }

  find(text) {
    const t = String(text).trim();
    const n = Number(t.replace(/^#/, ''));
    if (Number.isInteger(n)) return this.playlist.find((s) => s.id === n) || null;
    const k = norm(t);
    return this.playlist.find((s) => s.key === k) || this.playlist.find((s) => s.key.includes(k)) || null;
  }

  pubSong(s) {
    return s && { id: s.id, title: s.title, artist: s.artist || '', bpm: s.bpm, file: s.file || null };
  }

  onChat(ctx) {
    const t = ctx.text.trim();
    let m = /^!(?:nhac|nhạc|song)\s+(.{1,60})$/iu.exec(t);
    if (m) return this.request(ctx, m[1]);
    m = /^!vote\s+(.{1,60})$/iu.exec(t);
    if (m) return this.vote(ctx, m[1]);
    if (/^!(?:baihat|bài hát|nhac|nhạc|list)$/iu.test(t)) return [this.env.make(ctx.user, 'music_list', { list: this.playlist.map((s) => this.pubSong(s)) })];
    return null;
  }

  request(ctx, what) {
    const { env } = this;
    const song = this.find(what);
    if (!song) return [env.make(ctx.user, 'music_list', { text: what, list: this.playlist.map((s) => this.pubSong(s)) })];
    if (this.now?.song.id === song.id) return [env.make(ctx.user, 'song_playing', { song: this.pubSong(song) })];
    const credit = this.credits.get(ctx.user.id);
    const priority = Boolean(credit && ctx.now <= credit.until);
    const queued = this.queue.find((q) => q.song.id === song.id);
    if (queued) {
      queued.votes.add(ctx.user.id);
      if (priority) {
        // đã tặng quà: đẩy bài có sẵn trong hàng chờ lên đầu
        this.credits.delete(ctx.user.id);
        queued.priority = true;
        this.sortQueue();
        env.changed();
        return [env.make(ctx.user, 'song_requested', { song: this.pubSong(song), priority: true, position: this.queue.indexOf(queued) + 1 }, { priority: 2 })];
      }
      this.sortQueue();
      env.changed();
      return [env.make(ctx.user, 'song_voted', { song: this.pubSong(song), votes: queued.votes.size })];
    }
    const wait = this.cooldownMs - (ctx.now - (this.last.get(ctx.user.id) || 0));
    if (!priority && wait > 0) return [env.make(ctx.user, 'song_wait', { song: this.pubSong(song), waitSec: Math.ceil(wait / 1000) })];
    if (priority) this.credits.delete(ctx.user.id);
    this.last.set(ctx.user.id, ctx.now);
    this.queue.push({ song, by: ctx.user, votes: new Set([ctx.user.id]), priority, at: ctx.now });
    this.sortQueue();
    if (!this.now) this.next(ctx.now);
    env.changed();
    return [env.make(ctx.user, 'song_requested', { song: this.pubSong(song), priority, position: this.queue.findIndex((q) => q.song.id === song.id) + 1 }, { priority: priority ? 2 : 1 })];
  }

  vote(ctx, what) {
    const song = this.find(what);
    const q = song && this.queue.find((x) => x.song.id === song.id);
    if (!q) return this.request(ctx, what);
    q.votes.add(ctx.user.id);
    this.sortQueue();
    this.env.changed();
    return [this.env.make(ctx.user, 'song_voted', { song: this.pubSong(song), votes: q.votes.size })];
  }

  sortQueue() {
    this.queue.sort((a, b) => Number(b.priority) - Number(a.priority) || b.votes.size - a.votes.size || a.at - b.at);
  }

  afterGift(ctx) {
    if ((ctx.coins || 0) >= this.priorityCoins) this.credits.set(ctx.user.id, { until: ctx.now + this.creditMs });
    return [];
  }

  /** Phát bài tiếp: bài trong hàng chờ, không có thì bài kế tiếp trong danh sách (tránh bài vừa phát). */
  next(now) {
    if (!this.playlist.length) return;
    let pick = this.queue.shift();
    if (!pick) {
      const recent = new Set(this.history.slice(-Math.min(3, this.playlist.length - 1)));
      const cand = this.playlist.filter((s) => !recent.has(s.id));
      const lastIdx = this.now ? this.playlist.findIndex((s) => s.id === this.now.song.id) : -1;
      const song = cand.find((s) => this.playlist.indexOf(s) > lastIdx) || cand[0] || this.playlist[0];
      pick = { song, by: null };
    }
    this.now = { song: pick.song, by: pick.by, startedAt: now };
    this.history.push(pick.song.id);
    if (this.history.length > 20) this.history.shift();
    this.env.emit(this.env.make(pick.by, 'song_change', { song: this.pubSong(pick.song) }, { say: pick.by ? `Bài tiếp theo do ${pick.by.name} chọn` : '' }));
    this.env.changed();
  }

  tick(now) {
    if (!this.playlist.length) return;
    if (!this.now) return this.next(now);
    const dur = (this.now.song.duration ? this.now.song.duration * 1000 : this.defaultMs) + 1500;
    if (now - this.now.startedAt >= dur) this.next(now);
  }

  /** Trang hiển thị báo độ dài thật của bài hoặc bài đã hết. */
  onWorldMessage(msg) {
    const now = this.env.now();
    if (!this.now || msg.songId !== this.now.song.id) return;
    if (msg.type === 'song_meta' && msg.duration > 5 && !this.now.song.duration) this.now.song.duration = Math.round(msg.duration);
    if (msg.type === 'song_end' && now - this.now.startedAt > 5000) this.next(now);
  }

  publicState() {
    return {
      now: this.now && { ...this.pubSong(this.now.song), by: this.now.by?.name || null, startedAt: this.now.startedAt, serverNow: this.env.now() },
      queue: this.queue.slice(0, 4).map((q) => ({ ...this.pubSong(q.song), by: q.by?.name, votes: q.votes.size, priority: q.priority })),
      list: this.playlist.map((s) => ({ id: s.id, title: s.title })),
    };
  }
}
