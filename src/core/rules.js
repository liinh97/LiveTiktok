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
//
// Lệnh theo LOẠI quà (mục "commands"): khớp theo tên hoặc id quà, được ưu tiên hơn bậc xu.
//   { gift: ["Rose", "5655"], action: "jump", label: "Nhảy 1 cái", icon: "🌹", look?: "grow"|"shrink"|"wings"|"change" }
//   look: đổi ngoại hình của nhân vật người tặng (máy chủ lưu lại).

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
      merged.commands = (merged.commands || []).map((r) => ({ ...r, keys: new Set([].concat(r.gift || []).map((g) => String(g).toLowerCase())) }));
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

  /** Lệnh khớp với loại quà (theo tên hoặc id), không có thì null. */
  pickCommand(locationId, gift) {
    const name = String(gift?.name || '').toLowerCase();
    const id = String(gift?.id ?? '').toLowerCase();
    return this.forLocation(locationId).commands.find((r) => r.keys.has(name) || (id && r.keys.has(id))) || null;
  }

  /** Luật cho một món quà: lệnh theo loại quà nếu có, không thì theo bậc xu. */
  pickGiftRule(locationId, gift) {
    return this.pickCommand(locationId, gift) || this.pickGift(locationId, gift.coins * gift.count);
  }

  /** Danh sách lệnh để hiện menu trên màn hình. */
  commandMenu(locationId) {
    return this.forLocation(locationId).commands.map((r) => ({ gift: [].concat(r.gift)[0], label: r.label || r.action, icon: r.icon || '🎁' }));
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
  for (const r of rules.commands) {
    if (!r.action || !r.keys.size) throw new Error(`Lệnh quà (${where}) cần gift và action`);
    if (r.look && !['grow', 'shrink', 'wings', 'change'].includes(r.look)) throw new Error(`Lệnh quà (${where}): look "${r.look}" không hợp lệ`);
  }
  for (const k of ['join', 'like', 'follow', 'share']) {
    if (!rules[k]?.action) throw new Error(`Thiếu luật "${k}" (${where})`);
  }
}
