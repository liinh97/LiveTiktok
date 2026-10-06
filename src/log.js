// Ghi log ra console và giữ một bộ đệm gần nhất để bảng điều khiển hiển thị.

const MAX = 300;
const buffer = [];
let seq = 0;

function write(level, msg, extra) {
  const entry = { seq: ++seq, ts: Date.now(), level, msg, ...(extra ? { extra } : {}) };
  buffer.push(entry);
  if (buffer.length > MAX) buffer.shift();
  const line = `[${new Date(entry.ts).toLocaleTimeString('vi-VN')}] ${level.toUpperCase()} ${msg}`;
  (level === 'error' ? console.error : console.log)(line);
  return entry;
}

export const log = {
  info: (msg, extra) => write('info', msg, extra),
  warn: (msg, extra) => write('warn', msg, extra),
  error: (msg, extra) => write('error', msg, extra),
  since: (afterSeq = 0) => buffer.filter((e) => e.seq > afterSeq),
};
