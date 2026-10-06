// Cấp VIP theo tổng xu đã tặng (tính trên TOÀN thế giới, không riêng địa điểm nào).

export class Tiers {
  constructor(list) {
    this.list = [...list].sort((a, b) => a.minCoins - b.minCoins);
  }
  of(totalCoins) {
    let t = this.list[0];
    for (const x of this.list) if (totalCoins >= x.minCoins) t = x;
    return t;
  }
  rank(tierId) {
    const i = this.list.findIndex((t) => t.id === tierId);
    return i < 0 ? 0 : i;
  }
  /** Cấp của tổng xu có đạt mức tierId không. */
  atLeast(totalCoins, tierId) {
    if (!tierId) return true;
    return this.rank(this.of(totalCoins).id) >= this.rank(tierId);
  }
  public(t) {
    return { id: t.id, name: t.name, color: t.color, rank: this.rank(t.id) };
  }
}
