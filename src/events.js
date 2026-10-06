// Định dạng sự kiện CHUẨN. Mọi nguồn (TikTok, giả lập, sau này Facebook/YouTube...)
// đều phải đổi về dạng này; phần sau của hệ thống không biết sự kiện đến từ đâu.
//
// {
//   id:     string   mã duy nhất (để lọc trùng)
//   type:   'join' | 'like' | 'follow' | 'share' | 'chat' | 'gift'
//   source: string   tên nguồn
//   ts:     number   thời điểm (ms)
//   test:   boolean  sự kiện thử từ bảng điều khiển: không ghi vào thống kê
//   user:   { id, name, avatar }
//   text?:  string                                  (chat)
//   likes?: number                                  (like)
//   gift?:  { id, name, coins, count, image }       (gift; coins = giá 1 quà, count = số lượng)
// }

export const EVENT_TYPES = ['join', 'like', 'follow', 'share', 'chat', 'gift'];

let counter = 0;

export function makeEvent(type, fields) {
  if (!EVENT_TYPES.includes(type)) throw new Error(`Loại sự kiện không hợp lệ: ${type}`);
  const user = fields.user || {};
  if (!user.id) throw new Error('Sự kiện thiếu user.id');
  return {
    id: fields.id || `${fields.source || 'x'}-${Date.now()}-${++counter}`,
    type,
    source: fields.source || 'unknown',
    ts: fields.ts || Date.now(),
    test: Boolean(fields.test),
    user: { id: String(user.id), name: user.name || String(user.id), avatar: user.avatar || null },
    ...(fields.text !== undefined ? { text: String(fields.text) } : {}),
    ...(fields.likes !== undefined ? { likes: Number(fields.likes) || 1 } : {}),
    ...(fields.gift
      ? {
          gift: {
            id: String(fields.gift.id ?? fields.gift.name),
            name: fields.gift.name || 'Quà',
            coins: Math.max(0, Number(fields.gift.coins) || 0),
            count: Math.max(1, Number(fields.gift.count) || 1),
            image: fields.gift.image || null,
          },
        }
      : {}),
  };
}
