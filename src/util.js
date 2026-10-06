// Tiện ích dùng chung: thời gian theo múi giờ, ngẫu nhiên, điền mẫu câu.

const partsFormatters = new Map();

function formatterFor(timeZone) {
  if (!partsFormatters.has(timeZone)) {
    partsFormatters.set(
      timeZone,
      new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
    );
  }
  return partsFormatters.get(timeZone);
}

/** Ngày (YYYY-MM-DD) và số phút từ 0h theo múi giờ cho trước. */
export function localTime(date, timeZone) {
  const p = Object.fromEntries(formatterFor(timeZone).formatToParts(date).map((x) => [x.type, x.value]));
  return {
    day: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

/** "06:30" -> 390, "24:00" -> 1440 */
export function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
  if (!m) throw new Error(`Giờ không hợp lệ: "${s}" (cần dạng HH:MM)`);
  const v = Number(m[1]) * 60 + Number(m[2]);
  if (v > 1440 || Number(m[2]) > 59) throw new Error(`Giờ không hợp lệ: "${s}"`);
  return v;
}

export function pick(list, rand = Math.random) {
  return list[Math.floor(rand() * list.length)];
}

/** Điền {biến} trong câu; biến không có giá trị thì để trống. */
export function fillTemplate(tpl, vars) {
  if (!tpl) return '';
  return tpl
    .replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k])))
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Tập giới hạn kích thước để lọc trùng (bỏ phần tử cũ nhất khi đầy). */
export class LruSet {
  constructor(max) {
    this.max = max;
    this.set = new Set();
  }
  has(k) {
    return this.set.has(k);
  }
  add(k) {
    this.set.add(k);
    if (this.set.size > this.max) this.set.delete(this.set.values().next().value);
  }
}
