// GIỌNG NÓI cho bình luận: biến chữ thành file âm thanh để trang hiển thị phát "giữa đám đông".
//
// Nguồn giọng:
//   piper  : chạy ngay trên máy (miễn phí, không cần mạng). Docker tự cài vào /opt/piper.
//            Giọng tiếng Việt: vivos (65 người nói khác nhau, hợp làm đám đông) + 25hours (1 giọng nữ rõ hơn).
//   google : dự phòng khi chưa có piper (giọng Google Dịch, miễn phí nhưng không chính thức, cần mạng).
// Mỗi người xem luôn được cùng một giọng + tốc độ nói riêng (theo id), nên nghe như nhiều người khác nhau.
// File làm xong được giữ lại (cache) trong data/tts, tự xoá bớt khi quá nhiều.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { log } from './log.js';

const VIVOS = 'vi-vivos-x-low.onnx';
const SINGLE = 'vi-25hours-single-low.onnx';

/** Làm sạch chữ trước khi đọc: bỏ emoji, link, ký tự lặp dài ("hahaaaaaa"); null nếu không còn gì để đọc. */
export function cleanForSpeech(text, maxLen = 100) {
  let t = String(text || '')
    .replace(/https?:\/\/\S+|www\.\S+/giu, ' ')
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]/gu, ' ')
    .replace(/[@#]\S+/gu, ' ')
    .replace(/(.)\1{3,}/gu, '$1$1$1')
    .replace(/[^\p{L}\p{N}\s.,!?'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!/\p{L}/u.test(t)) return null;
  if (t.length > maxLen) t = `${t.slice(0, maxLen).replace(/\s+\S*$/, '')}`;
  return t;
}

/** Số ổn định từ chuỗi (để mỗi người xem luôn cùng một giọng). */
function hashNum(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

export class Tts {
  /**
   * cfg: { enabled, provider: 'auto'|'piper'|'google'|'off', piperDir, maxConcurrent, maxFiles }
   */
  constructor(cfg = {}, dataDir = 'data') {
    this.cfg = cfg;
    this.dir = path.join(dataDir, 'tts');
    this.maxConcurrent = cfg.maxConcurrent ?? 3;
    this.maxFiles = cfg.maxFiles ?? 400;
    this.pending = new Map(); // id -> Promise<đường dẫn file | null>
    this.active = 0;
    this.writes = 0;
    const dir = process.env.PIPER_DIR || cfg.piperDir || '/opt/piper';
    this.piper = {
      bin: path.join(dir, 'piper', 'piper'),
      vivos: path.join(dir, 'voices', VIVOS),
      single: path.join(dir, 'voices', SINGLE),
    };
    const want = cfg.enabled === false ? 'off' : cfg.provider || 'auto';
    const hasPiper = fs.existsSync(this.piper.bin) && (fs.existsSync(this.piper.vivos) || fs.existsSync(this.piper.single));
    this.provider = want === 'auto' ? (hasPiper ? 'piper' : 'google') : want === 'piper' && !hasPiper ? 'off' : want;
    if (this.provider !== 'off') fs.mkdirSync(this.dir, { recursive: true });
    log.info(`Giọng nói bình luận: ${{ piper: 'Piper (trên máy)', google: 'Google Dịch (dự phòng, cần mạng)', off: 'tắt' }[this.provider]}`);
  }

  get enabled() {
    return this.provider !== 'off';
  }

  /** Giọng của một người xem: vivos (65 người) là chính, thỉnh thoảng giọng 25hours; tốc độ nói hơi khác nhau. */
  voiceOf(userId) {
    const h = hashNum(userId || 'x');
    const single = fs.existsSync(this.piper.single) && (h % 5 === 0 || !fs.existsSync(this.piper.vivos));
    return {
      model: single ? this.piper.single : this.piper.vivos,
      speaker: single ? 0 : h % 65,
      length: (0.92 + ((h >>> 8) % 17) / 100).toFixed(2), // 0.92..1.08: người nói nhanh, người nói chậm
      key: single ? 's' : `v${h % 65}`,
    };
  }

  fileOf(id) {
    return path.join(this.dir, `${id}.${this.provider === 'google' ? 'mp3' : 'wav'}`);
  }

  /**
   * Bắt đầu làm giọng cho một câu; trả về id để trang hiển thị tải /tts/<id>, hoặc null nếu bỏ qua
   * (đang quá nhiều câu cùng lúc, chữ không đọc được, hoặc đang tắt).
   */
  request(text, userId) {
    if (!this.enabled) return null;
    const clean = cleanForSpeech(text);
    if (!clean) return null;
    const voice = this.provider === 'piper' ? this.voiceOf(userId) : { key: 'g' };
    const id = createHash('sha1').update(`${voice.key}|${voice.length || ''}|${clean}`).digest('hex').slice(0, 20);
    const file = this.fileOf(id);
    if (this.pending.has(id)) return id;
    if (fs.existsSync(file)) {
      this.pending.set(id, Promise.resolve(file));
      setTimeout(() => this.pending.delete(id), 30000);
      return id;
    }
    if (this.active >= this.maxConcurrent) return null; // quán đông: không phải ai nói cũng nghe được
    this.active++;
    const job = (this.provider === 'piper' ? this.#piper(clean, voice, file) : this.#google(clean, file))
      .then(() => {
        if (++this.writes % 50 === 0) this.#prune();
        return file;
      })
      .catch((err) => {
        log.warn(`Không đọc được bình luận: ${err.message}`);
        return null;
      })
      .finally(() => {
        this.active--;
        setTimeout(() => this.pending.delete(id), 30000);
      });
    this.pending.set(id, job);
    return id;
  }

  /** Đợi file của id làm xong (tối đa ms); null nếu không có. */
  async waitFile(id, ms = 8000) {
    if (!/^[a-f0-9]{20}$/.test(id)) return null;
    const p = this.pending.get(id);
    if (!p) {
      const f = this.fileOf(id);
      return fs.existsSync(f) ? f : null;
    }
    return Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
  }

  #piper(text, voice, file) {
    return new Promise((resolve, reject) => {
      const tmp = `${file}.tmp`;
      const args = ['-q', '-m', voice.model, '-s', String(voice.speaker), '--length_scale', voice.length, '--sentence_silence', '0.05', '-f', tmp];
      const p = spawn(this.piper.bin, args, { stdio: ['pipe', 'ignore', 'pipe'] });
      let err = '';
      const timer = setTimeout(() => p.kill('SIGKILL'), 15000);
      p.stderr.on('data', (d) => (err += d));
      p.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      p.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 && fs.existsSync(tmp)) {
          fs.renameSync(tmp, file);
          resolve();
        } else {
          fs.rmSync(tmp, { force: true });
          reject(new Error(`piper thoát mã ${code} ${err.slice(0, 200)}`));
        }
      });
      p.stdin.end(`${text}\n`);
    });
  }

  async #google(text, file) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=vi&q=${encodeURIComponent(text.slice(0, 190))}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Google TTS ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }

  /** Giữ tối đa maxFiles file mới nhất. */
  #prune() {
    try {
      const files = fs
        .readdirSync(this.dir)
        .map((f) => ({ f, t: fs.statSync(path.join(this.dir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
      for (const { f } of files.slice(this.maxFiles)) fs.rmSync(path.join(this.dir, f), { force: true });
    } catch {
      // bỏ qua
    }
  }
}
