// Luật: sự kiện nào -> hành động (hiệu ứng) nào, theo từng địa điểm.
// Luật mặc định nằm ở config/rules.default.json; mỗi địa điểm ghi đè từng mục trong location.json.
//
// Một luật gồm:
//   action      tên hành động gửi xuống scene (bắt buộc)
//   priority    0-1: diễn ngay; >= 3: xếp hàng diễn lần lượt (quà lớn không bị chồng lên nhau)
//   say         câu đọc/hiển thị, có biến {name} {tier} {count} {gift} {coins} {text}
//   sayMinTier  chỉ đọc câu khi người xem đạt cấp này trở lên
//   minCoins    (quà) tổng xu tối thiểu để khớp bậc này
//   match       (chat) biểu thức chính quy; nhóm đầu tiên được gửi xuống làm text
//   minTier     (chat) chỉ áp dụng cho người đạt cấp này trở lên
//   params      dữ liệu tuỳ ý chuyển nguyên xuống scene (scene tự hiểu)

export class RuleBook {
  constructor(defaultRules, locations) {
    this.defaults = defaultRules;
    this.locations = locations;
    this.cache = new Map();
    for (const loc of Object.values(locations)) validate(this.forLocation(loc.id), loc.id);
    validate(this.forLocation(null), 'mặc định');
  }

  forLocation(locationId) {
    const key = locationId || '';
    if (!this.cache.has(key)) {
      const over = (locationId && this.locations[locationId]?.rules) || {};
      const merged = { ...this.defaults, ...over };
      merged.gift = [...(merged.gift || [])].sort((a, b) => a.minCoins - b.minCoins);
      merged.chat = (merged.chat || []).map((r) => ({ ...r, re: r.match ? new RegExp(r.match, 'iu') : null }));
      this.cache.set(key, merged);
    }
    return this.cache.get(key);
  }

  /** Bậc quà cao nhất có minCoins <= tổng xu (không khớp bậc nào thì lấy bậc thấp nhất). */
  pickGift(locationId, totalCoins) {
    const list = this.forLocation(locationId).gift;
    let hit = list[0] || null;
    for (const r of list) if (totalCoins >= r.minCoins) hit = r;
    return hit;
  }

  /** Luật bình luận khớp đầu tiên (thỏa điều kiện cấp nếu có). */
  pickChat(locationId, text, tierOk) {
    for (const r of this.forLocation(locationId).chat) {
      if (r.minTier && !tierOk(r.minTier)) continue;
      if (!r.re) return { rule: r, match: null };
      const m = r.re.exec(text);
      if (m) return { rule: r, match: m };
    }
    return null;
  }
}

function validate(rules, where) {
  for (const r of rules.gift) {
    if (typeof r.minCoins !== 'number' || !r.action) throw new Error(`Luật quà (${where}) cần minCoins và action`);
  }
  for (const r of rules.chat) if (!r.action) throw new Error(`Luật bình luận (${where}) cần action`);
  for (const k of ['join', 'like', 'follow', 'share']) {
    if (!rules[k]?.action) throw new Error(`Thiếu luật "${k}" (${where})`);
  }
}
