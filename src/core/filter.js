// Lọc nội dung trước khi lên sóng: tên và bình luận có từ cấm, link quảng cáo, người bị chặn.

import fs from 'node:fs';

export function stripDiacritics(s) {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

const hasDiacritics = (s) => stripDiacritics(s) !== s;
const tokens = (s) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

function containsAny(toks, seqs) {
  return seqs.some((seq) => {
    for (let i = 0; i + seq.length <= toks.length; i++) {
      if (seq.every((t, j) => toks[i + j] === t)) return true;
    }
    return false;
  });
}

const LINK_RE = /(https?:\/\/|www\.|\b[\w-]+\.(com|net|vn|xyz|top|io|me|link|club)\b|(\d[\s.-]?){9,})/i;

export class ContentFilter {
  constructor({ words = [], blockLinks = true, maskedName = 'Khách bí ẩn' } = {}) {
    this.blockLinks = blockLinks;
    this.maskedName = maskedName;
    // Khớp theo NGUYÊN TỪ (tránh "đụ" khớp nhầm "đụng").
    // Từ có dấu: so trên chữ thường có dấu. Từ không dấu: so trên chữ đã bỏ dấu (bắt kiểu gõ không dấu).
    this.accented = [];
    this.plain = [];
    for (const raw of words) {
      const w = raw.trim().toLowerCase();
      if (!w || w.startsWith('#')) continue;
      if (hasDiacritics(w)) this.accented.push(tokens(w));
      else this.plain.push(tokens(w));
    }
    this.blocked = new Set();
  }

  static fromFile(file, opts) {
    const words = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : [];
    return new ContentFilter({ ...opts, words });
  }

  isBad(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    return containsAny(tokens(lower), this.accented) || containsAny(tokens(stripDiacritics(lower)), this.plain);
  }

  hasLink(text) {
    return this.blockLinks && LINK_RE.test(text || '');
  }

  /** Tên an toàn để hiển thị. */
  cleanName(name) {
    if (!name || this.isBad(name) || this.hasLink(name)) return this.maskedName;
    return name.length > 24 ? `${name.slice(0, 23)}…` : name;
  }

  /** Bình luận có được phép hiện không. */
  chatAllowed(text) {
    return !this.isBad(text) && !this.hasLink(text);
  }

  block(userId) {
    this.blocked.add(String(userId));
  }
  unblock(userId) {
    this.blocked.delete(String(userId));
  }
  isBlocked(userId) {
    return this.blocked.has(String(userId));
  }
}
