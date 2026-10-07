// NHÂN VẬT CHIBI tự sinh: từ một con số "style" ra kiểu tóc, màu tóc, áo, quần, phụ kiện, nét mặt.
// Có ảnh đại diện TikTok thì dùng làm khuôn mặt. Mỗi nhân vật được vẽ sẵn thành ảnh một lần (sprite),
// mỗi khung hình chỉ dán ảnh nên vẽ được hàng trăm nhân vật cùng lúc.
//
// Toạ độ sprite: rộng 100, cao 140 (đơn vị gốc), chân ở (50, 138).

export const SPRITE_W = 100;
export const SPRITE_H = 140;
export const FOOT_Y = 138;
export const SHOULDER_Y = 84; // vai (để vẽ tay mỗi khung hình)
export const HEAD_Y = 46; // tâm đầu
export const HEAD_R = 31;

const SKIN = ['#ffe3cf', '#f8d2b4', '#efbd96', '#d39a72', '#a8704c'];
const HAIR = ['#1d1b20', '#2b2421', '#4a2c1c', '#7a4a28', '#c89448', '#efd9a6', '#b8382d', '#3d5da8', '#d667a8', '#9aa0a6', '#5ec2b5'];
const OUTFIT = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#00897b', '#039be5', '#3949ab', '#8e24aa', '#d81b60', '#f4f4f4', '#263238', '#795548'];
const PANTS = ['#263238', '#37474f', '#1a237e', '#4e342e', '#424242', '#283593'];
const HAIRSTYLES = ['short', 'spiky', 'long', 'bun', 'twin', 'bowl', 'cap', 'mohawk'];
const HATS = [null, null, null, 'snapback', 'snapback', 'beanie', 'hood']; // mũ đội lên tóc (hip-hop)
const SHOES = ['#e53935', '#1e88e5', '#fdd835', '#212121', '#f5f5f5', '#43a047', '#fb8c00', '#8e24aa'];
const OUT = '#231a2e'; // màu viền nét (kiểu tranh hoạt hình)
const ACCESSORY = ['none', 'none', 'none', 'glasses', 'headphones', 'bow', 'shades'];
const FACES = ['dot', 'happy', 'wink', 'cat', 'surprised'];

function rng(seed) {
  let a = (seed | 0) + 0x6d2b79f5;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pickFrom = (r, list) => list[Math.floor(r() * list.length)];

/** Các bộ phận của nhân vật từ số style (cùng style -> cùng nhân vật). */
export function partsOf(style) {
  const r = rng(style);
  return {
    skin: pickFrom(r, SKIN),
    hair: pickFrom(r, HAIR),
    hairStyle: pickFrom(r, HAIRSTYLES),
    outfit: pickFrom(r, OUTFIT),
    outfit2: pickFrom(r, OUTFIT),
    pants: pickFrom(r, PANTS),
    accessory: pickFrom(r, ACCESSORY),
    face: pickFrom(r, FACES),
    shirt: pickFrom(r, ['plain', 'stripe', 'collar', 'heart']),
    // thêm sau cùng: không làm đổi các phần ở trên của nhân vật cũ
    hat: pickFrom(r, HATS),
    hatColor: pickFrom(r, OUTFIT),
    shoe: pickFrom(r, SHOES),
    tee: pickFrom(r, ['plain', 'raglan', 'jersey', 'plain']),
    num: 1 + Math.floor(r() * 99),
  };
}

/** Vẽ sẵn nhân vật thành ảnh. res: độ nét (1 = 100x140 px). avatar: ảnh đại diện đã tải (hoặc null). */
export function renderChibi(parts, avatar, res = 1.25) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(SPRITE_W * res);
  c.height = Math.ceil(SPRITE_H * res);
  const g = c.getContext('2d');
  g.scale(res, res);
  const hx = 50;
  const hy = HEAD_Y;

  // Chân + bóng không vẽ sẵn ở đây: vẽ mỗi khung hình bằng drawLegs() để gập gối, bước, đá chân.
  g.lineJoin = 'round';
  g.lineCap = 'round';
  // Lưng quần (hông) để chân nối vào cho liền
  g.fillStyle = parts.pants;
  g.strokeStyle = OUT;
  g.lineWidth = 1.8;
  g.beginPath();
  g.roundRect(35, 103, 30, 13, [2, 2, 7, 7]);
  g.fill();
  g.stroke();

  torso(g, parts);

  // linh vật (dancer): đầu thú thay cho đầu người
  if (parts.costume) {
    mascotHead(g, parts.costume, hx, hy);
    return c;
  }

  const hat = parts.hat;
  // mũ trùm (hoodie) phía sau đầu, hoặc tóc phía sau
  if (hat === 'hood') {
    g.fillStyle = parts.outfit;
    g.strokeStyle = OUT;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(hx, hy + 1, HEAD_R + 7, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  } else if (!hat || hat === 'snapback') {
    g.fillStyle = parts.hair;
    g.strokeStyle = OUT;
    g.lineWidth = 1.8;
    hairBack(g, parts.hairStyle, hx, hy);
  }

  // tai
  g.fillStyle = parts.skin;
  g.strokeStyle = OUT;
  g.lineWidth = 1.8;
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.ellipse(hx + sx * (HEAD_R - 1), hy + 5, 5.5, 7, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  g.fillStyle = 'rgba(220,120,110,.35)';
  g.beginPath();
  g.ellipse(hx - HEAD_R + 0.5, hy + 5, 2.4, 3.8, 0, 0, Math.PI * 2);
  g.ellipse(hx + HEAD_R - 0.5, hy + 5, 2.4, 3.8, 0, 0, Math.PI * 2);
  g.fill();

  // đầu (có viền)
  g.fillStyle = parts.skin;
  g.beginPath();
  g.arc(hx, hy, HEAD_R, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = OUT;
  g.lineWidth = 2;
  g.stroke();
  // bóng nhẹ dưới cằm + sáng nhẹ trên trán cho có khối
  g.fillStyle = 'rgba(120,60,40,.10)';
  g.beginPath();
  g.arc(hx, hy, HEAD_R - 1, Math.PI * 0.15, Math.PI * 0.85);
  g.arc(hx, hy - 6, HEAD_R - 4, Math.PI * 0.82, Math.PI * 0.18, true);
  g.fill();

  if (avatar) {
    // ảnh đại diện làm khuôn mặt, viền da + tóc ôm phía trên
    g.save();
    g.beginPath();
    g.arc(hx, hy + 2, HEAD_R - 4, 0, Math.PI * 2);
    g.clip();
    g.drawImage(avatar, hx - HEAD_R + 4, hy + 2 - HEAD_R + 4, (HEAD_R - 4) * 2, (HEAD_R - 4) * 2);
    g.restore();
    g.fillStyle = parts.hair;
    g.beginPath();
    g.arc(hx, hy, HEAD_R + 1, Math.PI * 1.08, Math.PI * 1.92);
    g.arc(hx, hy + 2, HEAD_R - 4, Math.PI * 1.9, Math.PI * 1.1, true);
    g.closePath();
    g.fill();
  } else {
    face(g, parts, hx, hy);
    if (!hat || hat === 'snapback') {
      g.fillStyle = parts.hair;
      g.strokeStyle = OUT;
      g.lineWidth = 1.8;
      hairFront(g, hat ? 'short' : parts.hairStyle, hx, hy);
    }
  }
  if (hat) hatFront(g, parts, hx, hy);
  accessory(g, parts, hx, hy, Boolean(avatar));
  return c;
}

/** Thân áo phông có tay áo ngắn, viền nét, đổ bóng một bên; kiểu: trơn, raglan, áo số, sọc, cổ bẻ, hoodie. */
function torso(g, parts) {
  const path = () => {
    g.beginPath();
    g.moveTo(43, 73);
    g.quadraticCurveTo(50, 77, 57, 73); // cổ áo
    g.quadraticCurveTo(66, 74, 70, 80); // vai phải
    g.lineTo(74, 90); // tay áo phải
    g.lineTo(67.5, 93);
    g.lineTo(67, 111); // sườn phải
    g.quadraticCurveTo(50, 114, 33, 111); // gấu áo
    g.lineTo(32.5, 93);
    g.lineTo(26, 90); // tay áo trái
    g.lineTo(30, 80);
    g.quadraticCurveTo(34, 74, 43, 73);
    g.closePath();
  };
  g.fillStyle = parts.outfit;
  path();
  g.fill();
  g.save();
  path();
  g.clip();
  const hood = parts.hat === 'hood';
  g.fillStyle = parts.outfit2;
  if (hood) {
    // hoodie: túi trước bụng + dây rút
    g.fillStyle = 'rgba(0,0,0,.14)';
    g.beginPath();
    g.roundRect(39, 96, 22, 12, 4);
    g.fill();
    g.strokeStyle = '#f5f5f5';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(46, 75);
    g.lineTo(45, 86);
    g.moveTo(54, 75);
    g.lineTo(55, 86);
    g.stroke();
  } else if (parts.tee === 'raglan') {
    // tay áo khác màu chéo từ cổ
    g.beginPath();
    g.moveTo(43, 73);
    g.lineTo(34, 95);
    g.lineTo(20, 95);
    g.lineTo(20, 70);
    g.closePath();
    g.moveTo(57, 73);
    g.lineTo(66, 95);
    g.lineTo(80, 95);
    g.lineTo(80, 70);
    g.closePath();
    g.fill();
  } else if (parts.tee === 'jersey') {
    // áo bóng rổ: số to + viền cổ
    g.font = '900 15px "Arial Black", Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText(String(parts.num ?? 7), 50, 103);
    g.fillRect(26, 88, 48, 2.5);
  } else if (parts.shirt === 'stripe') {
    g.fillRect(25, 88, 50, 5);
    g.fillRect(25, 99, 50, 5);
  } else if (parts.shirt === 'collar') {
    g.beginPath();
    g.moveTo(42, 73);
    g.lineTo(50, 84);
    g.lineTo(58, 73);
    g.closePath();
    g.fill();
  } else if (parts.shirt === 'heart') {
    g.font = '14px sans-serif';
    g.textAlign = 'center';
    g.fillText('♥', 50, 99);
  }
  // viền tay áo + đổ bóng nửa phải + nếp gấp gấu áo
  g.fillStyle = 'rgba(0,0,0,.16)';
  g.fillRect(25, 87.5, 9, 3);
  g.fillRect(66, 87.5, 9, 3);
  g.fillStyle = 'rgba(0,0,0,.12)';
  g.beginPath();
  g.moveTo(58, 70);
  g.quadraticCurveTo(62, 92, 57, 115);
  g.lineTo(80, 115);
  g.lineTo(80, 70);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(255,255,255,.10)';
  g.fillRect(30, 76, 6, 30);
  g.restore();
  g.strokeStyle = OUT;
  g.lineWidth = 2;
  path();
  g.stroke();
  // cổ áo
  g.strokeStyle = 'rgba(0,0,0,.25)';
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(44, 74.5);
  g.quadraticCurveTo(50, 79, 56, 74.5);
  g.stroke();
}

/** Mũ: snapback (lưỡi trai lệch / quay ngược), mũ len có quả bông, mũ trùm hoodie. */
function hatFront(g, parts, x, y) {
  const col = parts.hatColor || parts.outfit2;
  g.strokeStyle = OUT;
  g.lineWidth = 2;
  if (parts.hat === 'snapback') {
    const back = (parts.num || 0) % 3 === 0; // 1/3 đội ngược
    // chóp mũ
    g.fillStyle = col;
    g.beginPath();
    g.arc(x, y - 5, HEAD_R + 2, Math.PI * 1.02, Math.PI * 1.98);
    g.closePath();
    g.fill();
    g.stroke();
    // mảng trước khác màu + nút trên đỉnh
    g.fillStyle = parts.outfit2 === col ? '#fafafa' : parts.outfit2;
    g.beginPath();
    g.arc(x, y - 5, HEAD_R - 6, Math.PI * 1.2, Math.PI * 1.8);
    g.closePath();
    g.fill();
    g.fillStyle = col;
    g.beginPath();
    g.arc(x, y - 5 - HEAD_R - 1, 3, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    // lưỡi trai: chếch sang phải, hoặc quai cài phía trước khi đội ngược
    g.fillStyle = back ? 'rgba(0,0,0,.25)' : parts.outfit2 === col ? '#263238' : parts.outfit2;
    g.beginPath();
    if (back) g.roundRect(x - 9, y - 10, 18, 5, 2);
    else g.ellipse(x + 18, y - 7, 22, 5.5, 0.12, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  } else if (parts.hat === 'beanie') {
    g.fillStyle = col;
    g.beginPath();
    g.arc(x, y - 3, HEAD_R + 3, Math.PI, 0);
    g.closePath();
    g.fill();
    g.stroke();
    // đường len dọc
    g.strokeStyle = 'rgba(0,0,0,.18)';
    g.lineWidth = 1.2;
    g.beginPath();
    for (let i = -3; i <= 3; i++) {
      g.moveTo(x + i * 8, y - 12);
      g.quadraticCurveTo(x + i * 9, y - 26, x + i * 5, y - 30);
    }
    g.stroke();
    // vành gập
    g.fillStyle = parts.outfit2;
    g.strokeStyle = OUT;
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(x - HEAD_R - 3, y - 12, (HEAD_R + 3) * 2, 11, 5);
    g.fill();
    g.stroke();
    // quả bông
    g.fillStyle = '#fafafa';
    g.beginPath();
    g.arc(x, y - HEAD_R - 6, 7, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  } else if (parts.hat === 'hood') {
    // viền mũ trùm ôm quanh trán
    g.strokeStyle = parts.outfit;
    g.lineWidth = 7;
    g.beginPath();
    g.arc(x, y + 1, HEAD_R + 2, Math.PI * 0.92, Math.PI * 2.08);
    g.stroke();
    g.strokeStyle = OUT;
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(x, y + 1, HEAD_R - 1.5, Math.PI * 0.95, Math.PI * 2.05);
    g.stroke();
  }
}

/** Đầu linh vật hài: gà, khủng long, gấu. */
function mascotHead(g, kind, x, y) {
  const eyes = (ey, big = 6) => {
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(x - 11, ey, big, 0, Math.PI * 2);
    g.arc(x + 11, ey, big, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1b1b1b';
    g.beginPath();
    g.arc(x - 9, ey + 1, big * 0.5, 0, Math.PI * 2);
    g.arc(x + 13, ey + 1, big * 0.5, 0, Math.PI * 2);
    g.fill();
  };
  if (kind === 'chicken') {
    g.fillStyle = '#e53935'; // mào
    g.beginPath();
    g.arc(x - 9, y - 30, 7, 0, Math.PI * 2);
    g.arc(x, y - 34, 8, 0, Math.PI * 2);
    g.arc(x + 9, y - 30, 7, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fffaf0';
    g.beginPath();
    g.arc(x, y, HEAD_R, 0, Math.PI * 2);
    g.fill();
    eyes(y - 4, 7);
    g.fillStyle = '#ffb300'; // mỏ
    g.beginPath();
    g.moveTo(x - 9, y + 8);
    g.lineTo(x + 9, y + 8);
    g.lineTo(x, y + 20);
    g.closePath();
    g.fill();
    g.fillStyle = '#e53935'; // yếm
    g.beginPath();
    g.ellipse(x + 3, y + 24, 4, 6, 0, 0, Math.PI * 2);
    g.fill();
  } else if (kind === 'dino') {
    g.fillStyle = '#2e7d32'; // gai lưng
    g.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = Math.PI * (1.1 + i * 0.2);
      const bx = x + Math.cos(a) * (HEAD_R - 2);
      const by = y + Math.sin(a) * (HEAD_R - 2);
      g.moveTo(bx - 7, by + 3);
      g.lineTo(x + Math.cos(a) * (HEAD_R + 13), y + Math.sin(a) * (HEAD_R + 13));
      g.lineTo(bx + 7, by + 3);
    }
    g.fill();
    g.fillStyle = '#66bb6a';
    g.beginPath();
    g.arc(x, y, HEAD_R, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(x, y + 14, 24, 15, 0, 0, Math.PI * 2); // mõm
    g.fill();
    eyes(y - 8, 6);
    g.fillStyle = '#1b5e20';
    g.beginPath();
    g.arc(x - 6, y + 12, 2.5, 0, Math.PI * 2);
    g.arc(x + 6, y + 12, 2.5, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#1b5e20';
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(x, y + 16, 12, Math.PI * 0.15, Math.PI * 0.85);
    g.stroke();
  } else {
    // gấu
    g.fillStyle = '#8d5a2b';
    g.beginPath();
    g.arc(x - 24, y - 24, 11, 0, Math.PI * 2);
    g.arc(x + 24, y - 24, 11, 0, Math.PI * 2);
    g.arc(x, y, HEAD_R, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#d7a86e';
    g.beginPath();
    g.arc(x - 24, y - 24, 5, 0, Math.PI * 2);
    g.arc(x + 24, y - 24, 5, 0, Math.PI * 2);
    g.ellipse(x, y + 12, 15, 11, 0, 0, Math.PI * 2);
    g.fill();
    eyes(y - 6, 5);
    g.fillStyle = '#3e2723';
    g.beginPath();
    g.ellipse(x, y + 7, 6, 4, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#3e2723';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(x, y + 12, 6, Math.PI * 0.15, Math.PI * 0.85);
    g.stroke();
  }
  // má hồng cho dễ thương
  g.fillStyle = 'rgba(255,110,140,.45)';
  g.beginPath();
  g.ellipse(x - 20, y + 8, 5, 3, 0, 0, Math.PI * 2);
  g.ellipse(x + 20, y + 8, 5, 3, 0, 0, Math.PI * 2);
  g.fill();
}

function hairBack(g, style, x, y) {
  g.beginPath();
  if (style === 'long') {
    g.roundRect(x - 35, y - 20, 70, 62, 22);
  } else if (style === 'twin') {
    g.arc(x - 34, y + 6, 12, 0, Math.PI * 2);
    g.arc(x + 34, y + 6, 12, 0, Math.PI * 2);
  } else if (style === 'bun') {
    g.arc(x, y - 34, 13, 0, Math.PI * 2);
  }
  g.fill();
  g.stroke();
  g.beginPath();
  g.arc(x, y - 2, HEAD_R + 3, Math.PI, 0);
  g.fill();
  g.stroke();
}

function hairFront(g, style, x, y) {
  g.beginPath();
  if (style === 'spiky') {
    g.moveTo(x - 33, y - 4);
    for (let i = 0; i <= 6; i++) g.lineTo(x - 33 + i * 11, y - (i % 2 ? 44 : 22));
    g.lineTo(x + 33, y - 4);
  } else if (style === 'bowl') {
    g.arc(x, y - 2, HEAD_R + 3, Math.PI, 0);
    g.lineTo(x + 33, y + 2);
    g.lineTo(x - 33, y + 2);
  } else if (style === 'mohawk') {
    g.roundRect(x - 7, y - 46, 14, 26, 6);
    g.arc(x, y - 6, HEAD_R + 1, Math.PI * 1.15, Math.PI * 1.85);
  } else if (style === 'cap') {
    g.arc(x, y - 6, HEAD_R + 3, Math.PI, 0);
    g.closePath();
    g.fill();
    g.beginPath();
    g.ellipse(x + 14, y - 7, 26, 6, 0, 0, Math.PI * 2);
  } else {
    // mái ngang
    g.arc(x, y - 4, HEAD_R + 2, Math.PI * 1.02, Math.PI * 1.98);
    g.quadraticCurveTo(x + 10, y - 10, x - 2, y - 16);
    g.quadraticCurveTo(x - 14, y - 6, x - 32, y - 2);
  }
  g.closePath();
  g.fill();
  g.stroke();
}

function face(g, parts, x, y) {
  const ey = y + 4;
  // lông mày
  g.strokeStyle = parts.hair === '#efd9a6' || parts.hair === '#9aa0a6' ? '#6d5a4a' : parts.hair;
  g.lineWidth = 2.2;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x - 16, ey - 9);
  g.quadraticCurveTo(x - 11, ey - 12, x - 6, ey - 9.5);
  g.moveTo(x + 6, ey - 9.5);
  g.quadraticCurveTo(x + 11, ey - 12, x + 16, ey - 9);
  g.stroke();
  g.fillStyle = '#2b2b2b';
  g.strokeStyle = '#2b2b2b';
  g.lineWidth = 2.4;
  g.lineCap = 'round';
  if (parts.face === 'happy' || parts.face === 'cat') {
    g.beginPath();
    g.arc(x - 11, ey + 2, 5, Math.PI * 1.15, Math.PI * 1.85);
    g.moveTo(x + 16, ey);
    g.arc(x + 11, ey + 2, 5, Math.PI * 1.15, Math.PI * 1.85);
    g.stroke();
  } else if (parts.face === 'wink') {
    g.beginPath();
    g.arc(x - 11, ey, 4, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(x + 6, ey);
    g.lineTo(x + 16, ey);
    g.stroke();
  } else {
    // mắt to: tròng đen + 2 đốm sáng
    g.beginPath();
    g.ellipse(x - 11, ey, 4.4, 5.2, 0, 0, Math.PI * 2);
    g.ellipse(x + 11, ey, 4.4, 5.2, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(x - 9.6, ey - 1.8, 1.7, 0, Math.PI * 2);
    g.arc(x + 12.4, ey - 1.8, 1.7, 0, Math.PI * 2);
    g.arc(x - 12.4, ey + 2, 0.8, 0, Math.PI * 2);
    g.arc(x + 9.6, ey + 2, 0.8, 0, Math.PI * 2);
    g.fill();
  }
  // má hồng
  g.fillStyle = 'rgba(255,120,140,.45)';
  g.beginPath();
  g.ellipse(x - 18, ey + 9, 5, 3, 0, 0, Math.PI * 2);
  g.ellipse(x + 18, ey + 9, 5, 3, 0, 0, Math.PI * 2);
  g.fill();
  // miệng
  g.strokeStyle = '#7a2b2b';
  g.beginPath();
  if (parts.face === 'surprised') {
    g.fillStyle = '#7a2b2b';
    g.ellipse(x, ey + 13, 3.5, 4.5, 0, 0, Math.PI * 2);
    g.fill();
  } else if (parts.face === 'cat') {
    g.moveTo(x - 6, ey + 11);
    g.quadraticCurveTo(x - 3, ey + 15, x, ey + 11);
    g.quadraticCurveTo(x + 3, ey + 15, x + 6, ey + 11);
    g.stroke();
  } else {
    g.arc(x, ey + 9, 6, Math.PI * 0.15, Math.PI * 0.85);
    g.stroke();
  }
}

function accessory(g, parts, x, y, hasAvatar) {
  const a = parts.accessory;
  if (parts.bowtie) {
    g.fillStyle = parts.bowtie;
    g.beginPath();
    g.moveTo(50, 80);
    g.lineTo(42, 75);
    g.lineTo(42, 85);
    g.closePath();
    g.moveTo(50, 80);
    g.lineTo(58, 75);
    g.lineTo(58, 85);
    g.closePath();
    g.fill();
  }
  if (a === 'headphones') {
    g.strokeStyle = '#222';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(x, y - 2, HEAD_R + 3, Math.PI * 1.05, Math.PI * 1.95);
    g.stroke();
    g.fillStyle = parts.outfit2;
    g.beginPath();
    g.roundRect(x - HEAD_R - 6, y - 6, 9, 16, 4);
    g.roundRect(x + HEAD_R - 3, y - 6, 9, 16, 4);
    g.fill();
  } else if (a === 'bow') {
    g.fillStyle = '#ff4f9a';
    g.beginPath();
    g.moveTo(x + 18, y - 26);
    g.lineTo(x + 8, y - 34);
    g.lineTo(x + 8, y - 18);
    g.closePath();
    g.moveTo(x + 18, y - 26);
    g.lineTo(x + 28, y - 34);
    g.lineTo(x + 28, y - 18);
    g.closePath();
    g.fill();
  } else if (!hasAvatar && (a === 'glasses' || a === 'shades')) {
    g.strokeStyle = '#222';
    g.lineWidth = 2;
    g.fillStyle = a === 'shades' ? '#111' : 'rgba(255,255,255,0.15)';
    g.beginPath();
    g.roundRect(x - 19, y - 2, 15, 11, 4);
    g.roundRect(x + 4, y - 2, 15, 11, 4);
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(x - 4, y + 2);
    g.lineTo(x + 4, y + 2);
    g.stroke();
  }
}

/**
 * Tay vẽ mỗi khung hình (để giơ tay, vỗ tay, quẩy...). x, y: chân nhân vật; s: tỉ lệ.
 * pose: walk | guard | run | headstand | freeze | cheer | dance | wave | pump | clap | point | roof | wave2 | swing | carry | tpose | flap | noodle | (null = buông tay)
 * beat: số nhịp nhạc đã trôi (số thực) để tay chuyển động khớp nhịp.
 * detail: false khi nhân vật nhỏ trên màn hình (bỏ ngón cái, viền giày) cho nhanh.
 */
export function drawArms(ctx, x, y, s, parts, pose, t, seed, beat = t * 2, detail = true) {
  const sy = y - (FOOT_Y - SHOULDER_Y) * s;
  const lx = x - 17 * s;
  const rx = x + 17 * s;
  const b = Math.pow(Math.abs(Math.sin(Math.PI * beat)), 2); // 1 đúng nhịp
  const odd = Math.floor(beat) % 2 === 1;
  let L;
  let R;
  let LC = null; // điểm uốn (tay cong)
  let RC = null;
  switch (pose) {
    case 'cheer': {
      const w = Math.sin(t * 8 + seed * 6) * 6 * s;
      L = [lx - 12 * s + w, sy - 40 * s];
      R = [rx + 12 * s - w, sy - 40 * s];
      break;
    }
    case 'dance': {
      const k = Math.sin(t * 6 + seed * 6);
      L = [lx - 16 * s, sy - (k > 0 ? 34 : 4) * s];
      R = [rx + 16 * s, sy - (k > 0 ? 4 : 34) * s];
      break;
    }
    case 'wave':
      L = [lx - 6 * s, sy + 26 * s];
      R = [rx + 14 * s + Math.sin(t * 10) * 7 * s, sy - 36 * s];
      break;
    case 'pump': // giơ hai tay quẩy theo nhịp
      L = [lx - 8 * s, sy - (30 + 14 * b) * s];
      R = [rx + 8 * s, sy - (30 + 14 * b) * s];
      break;
    case 'clap': {
      // vỗ tay trên đầu: hai tay chạm nhau đúng nhịp
      const gap = (3 + (1 - b) * 14) * s;
      L = [x - gap, sy - 44 * s];
      R = [x + gap, sy - 44 * s];
      break;
    }
    case 'point': // chỉ tay kiểu disco, đổi bên mỗi nhịp
      if (odd) {
        L = [lx - 18 * s, sy - 44 * s];
        R = [rx + 2 * s, sy + 14 * s];
      } else {
        R = [rx + 18 * s, sy - 44 * s];
        L = [lx - 2 * s, sy + 14 * s];
      }
      break;
    case 'roof': // "raise the roof": hai tay đẩy lên trời
      L = [lx - 14 * s, sy - (34 + 8 * b) * s];
      R = [rx + 14 * s, sy - (34 + 8 * b) * s];
      break;
    case 'wave2': {
      // vẫy hai tay qua lại trên đầu
      const d = Math.sin((Math.PI * beat) / 2) * 16 * s;
      L = [lx - 6 * s + d, sy - 40 * s];
      R = [rx + 6 * s + d, sy - 40 * s];
      break;
    }
    case 'swing': {
      // vung tay sang hai bên: bàn tay đi theo cung tròn quanh vai (tay luôn gần duỗi, không gập)
      const k = Math.sin(Math.PI * beat);
      const aL = 0.35 + 0.55 * (1 + k) / 2; // góc lệch khỏi phương thẳng đứng
      const aR = 0.35 + 0.55 * (1 - k) / 2;
      L = [lx - Math.sin(aL) * 27 * s, sy + Math.cos(aL) * 27 * s];
      R = [rx + Math.sin(aR) * 27 * s, sy + Math.cos(aR) * 27 * s];
      break;
    }
    case 'carry': // giơ thẳng hai tay đỡ vật trên đầu (khiêng quan tài)
      L = [lx - 2 * s, sy - 74 * s];
      R = [rx + 2 * s, sy - 74 * s];
      break;
    case 'tpose': // dang thẳng hai tay cứng đơ
      L = [lx - 36 * s, sy];
      R = [rx + 36 * s, sy];
      break;
    case 'flap': {
      // vỗ cánh kiểu con gà: khuỷu tay chống hông, đập lên xuống thật nhanh
      const k = Math.sin(t * 22 + seed * 6) * 10 * s;
      L = [lx - 16 * s, sy + 6 * s - k];
      R = [rx + 16 * s, sy + 6 * s - k];
      LC = [lx - 4 * s, sy + 16 * s];
      RC = [rx + 4 * s, sy + 16 * s];
      break;
    }
    case 'noodle': {
      // tay sợi mì kiểu hình nộm hơi trước cửa hàng: cả cánh tay uốn thành sóng chạy từ vai ra ngón tay
      noodleArm(ctx, lx, sy, -1, s, parts, t + seed);
      noodleArm(ctx, rx, sy, 1, s, parts, t + seed + 1.3);
      return;
    }
    case 'guard': {
      // thủ thế b-boy: nắm tay trước cằm, nhún theo nhịp
      const k = Math.sin(Math.PI * beat) * 3 * s;
      L = [lx + 3 * s, sy - 15 * s + k];
      R = [rx - 3 * s, sy - 15 * s - k];
      break;
    }
    case 'run': {
      // running man: đánh tay lên xuống như chạy
      const k = Math.sin(Math.PI * beat);
      L = [lx - 9 * s, sy + (8 - 16 * k) * s];
      R = [rx + 9 * s, sy + (8 + 16 * k) * s];
      break;
    }
    case 'headstand': // trồng chuối: hai tay chống đất hai bên đầu
      L = [lx - 12 * s, sy - 40 * s];
      R = [rx + 12 * s, sy - 40 * s];
      break;
    case 'freeze': // freeze: tay phải chống thẳng xuống đất, tay trái giơ ra cân bằng
      L = [lx - 24 * s, sy - 16 * s];
      R = [rx + 29 * s, sy - 7 * s];
      break;
    case 'walk': {
      // đánh tay khi đi bộ, ngược nhịp với chân
      const k = Math.sin(t * 11 + seed * 9);
      L = [lx - 7 * s, sy + (22 + k * 5) * s];
      R = [rx + 7 * s, sy + (22 - k * 5) * s];
      break;
    }
    default: {
      const k = Math.sin(t * 4 + seed * 6) * 2 * s;
      L = [lx - 5 * s, sy + 28 * s + k];
      R = [rx + 5 * s, sy + 28 * s - k];
    }
  }
  const LS = [lx, sy];
  const RS = [rx, sy];
  const LM = LC || softElbow(LS, L, s, -1, x);
  const RM = RC || softElbow(RS, R, s, 1, x);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (detail) {
    // viền nét: vẽ đường to màu tối bên dưới, tay màu đè lên
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 10.5 * s;
    ctx.beginPath();
    ctx.moveTo(LS[0], LS[1]);
    ctx.lineTo(LM[0], LM[1]);
    ctx.lineTo(L[0], L[1]);
    ctx.moveTo(RS[0], RS[1]);
    ctx.lineTo(RM[0], RM[1]);
    ctx.lineTo(R[0], R[1]);
    ctx.stroke();
    ctx.fillStyle = OUT;
    ctx.beginPath();
    ctx.arc(L[0], L[1], 6.2 * s, 0, Math.PI * 2);
    ctx.moveTo(R[0] + 6.2 * s, R[1]);
    ctx.arc(R[0], R[1], 6.2 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  // cẳng tay (màu da) vẽ trước, bắp tay (tay áo) đè lên ở khuỷu; gom 2 tay vào một lần vẽ cho nhanh
  ctx.strokeStyle = parts.skin;
  ctx.lineWidth = 7 * s;
  ctx.beginPath();
  ctx.moveTo(LM[0], LM[1]);
  ctx.lineTo(L[0], L[1]);
  ctx.moveTo(RM[0], RM[1]);
  ctx.lineTo(R[0], R[1]);
  ctx.stroke();
  ctx.strokeStyle = parts.outfit;
  ctx.lineWidth = 8 * s;
  ctx.beginPath();
  ctx.moveTo(LS[0], LS[1]);
  ctx.lineTo((LS[0] + LM[0]) / 2, (LS[1] + LM[1]) / 2);
  ctx.moveTo(RS[0], RS[1]);
  ctx.lineTo((RS[0] + RM[0]) / 2, (RS[1] + RM[1]) / 2);
  ctx.stroke();
  ctx.fillStyle = parts.skin;
  ctx.beginPath();
  ctx.arc(L[0], L[1], 4.8 * s, 0, Math.PI * 2);
  ctx.moveTo(R[0] + 4.8 * s, R[1]);
  ctx.arc(R[0], R[1], 4.8 * s, 0, Math.PI * 2);
  ctx.fill();
  if (detail) {
    thumb(ctx, L, LM, s, -1);
    thumb(ctx, R, RM, s, 1);
  }
}

// ---------- Khớp tay chân (2 đoạn, gập ở khuỷu / gối) ----------
const ARM_UP = 15; // bắp tay
const ARM_LOW = 15; // cẳng tay
const THIGH = 15;
const SHIN = 15;
export const HIP_Y = 108; // hông trong sprite (chân nối vào đây)

/**
 * Tìm khớp giữa (khuỷu / gối) để đoạn trên dài a, đoạn dưới dài b nối từ gốc A tới đích B.
 * side: -1 / 1 = khớp chĩa sang trái / phải. Xa quá tầm với thì duỗi thẳng (kéo dài chút kiểu hoạt hình).
 */
function joint(A, B, a, b, side) {
  const dx = B[0] - A[0];
  const dy = B[1] - A[1];
  const d = Math.hypot(dx, dy) || 0.001;
  if (d >= a + b - 0.01) return [A[0] + (dx * a) / (a + b), A[1] + (dy * a) / (a + b)];
  const dd = Math.max(d, Math.abs(a - b) + 0.01);
  const cosA = clamp1((a * a + dd * dd - b * b) / (2 * a * dd));
  const ang = Math.atan2(dy, dx) + side * Math.acos(cosA);
  return [A[0] + Math.cos(ang) * a, A[1] + Math.sin(ang) * a];
}
const clamp1 = (v) => Math.max(-1, Math.min(1, v));

/**
 * Khuỷu tay mềm kiểu hoạt hình: tay chỉ cong nhẹ ra ngoài, không bao giờ gập nhọn (nhìn như gãy).
 * Độ cong lớn nhất ~5 đơn vị dù bàn tay ở gần hay xa vai; tay dài ngắn co giãn theo khoảng cách.
 */
function softElbow(A, B, s, outward, cx) {
  const dx = B[0] - A[0];
  const dy = B[1] - A[1];
  const d = Math.hypot(dx, dy) || 0.001;
  const reach = (ARM_UP + ARM_LOW) * s;
  const bend = Math.min(5 * s, Math.max(1.5 * s, (reach - d) * 0.35)); // càng gần vai càng cong, nhưng có giới hạn
  // pháp tuyến của đoạn vai -> tay, chọn phía chĩa ra xa thân
  let nx = -dy / d;
  let ny = dx / d;
  const mx = A[0] + dx / 2;
  const my = A[1] + dy / 2;
  if ((mx + nx - cx) * outward < (mx - cx) * outward) {
    nx = -nx;
    ny = -ny;
  }
  return [mx + nx * bend, my + ny * bend];
}

/** Một cánh tay sợi mì: đường cong sóng mượt (không có khớp gãy), sóng chạy dọc tay theo thời gian. */
function noodleArm(ctx, sx0, sy0, side, s, parts, t) {
  const N = 9;
  const len = 34 * s;
  const lift = Math.sin(t * 2.3) * 0.5; // cả tay vẫy lên xuống chậm
  const base = side > 0 ? -0.25 + lift : Math.PI + 0.25 - lift; // hướng chung: chếch lên, ra ngoài
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const wave = Math.sin(t * 9 - u * 5) * 0.75 * u; // sóng to dần về phía bàn tay
    const ang = base - side * wave;
    const prev = pts[i - 1] || [sx0, sy0];
    pts.push(i === 0 ? [sx0, sy0] : [prev[0] + Math.cos(ang) * (len / N), prev[1] + Math.sin(ang) * (len / N)]);
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const curve = (from, to) => {
    ctx.beginPath();
    ctx.moveTo(pts[from][0], pts[from][1]);
    for (let i = from + 1; i < to; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    ctx.lineTo(pts[to][0], pts[to][1]);
    ctx.stroke();
  };
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 10.5 * s;
  curve(0, N);
  ctx.strokeStyle = parts.skin;
  ctx.lineWidth = 7 * s;
  curve(3, N);
  ctx.strokeStyle = parts.outfit;
  ctx.lineWidth = 8 * s;
  curve(0, 2);
  ctx.fillStyle = parts.skin;
  ctx.beginPath();
  ctx.arc(pts[N][0], pts[N][1], 4.8 * s, 0, Math.PI * 2);
  ctx.fill();
}

/** Chọn khớp giữa chĩa ra xa thân (khuỷu / gối hướng ra ngoài trông tự nhiên). */
function pickJoint(A, B, a, b, outward, cx) {
  const m1 = joint(A, B, a, b, 1);
  const m2 = joint(A, B, a, b, -1);
  return (m1[0] - cx) * outward >= (m2[0] - cx) * outward ? m1 : m2;
}

/** Ngón cái trên bàn tay tròn, hướng theo cẳng tay. */
function thumb(ctx, H, E, s, side) {
  const ta = Math.atan2(H[1] - E[1], H[0] - E[0]) - side * 1.2;
  ctx.beginPath();
  ctx.ellipse(H[0] + Math.cos(ta) * 4 * s, H[1] + Math.sin(ta) * 4 * s, 2.6 * s, 1.8 * s, ta, 0, Math.PI * 2);
  ctx.fill();
}

/** Bóng tròn dưới chân (vẽ ở mặt đất, trước khi xoay người). lift: độ cao đang bay (đơn vị sprite). */
export function drawShadow(ctx, x, y, s, lift = 0) {
  const sh = Math.max(0.35, 1 - lift / 70);
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath();
  ctx.ellipse(x, y - 2 * s, 20 * sh * s, 4 * sh * s, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Chân vẽ mỗi khung hình, gốc toạ độ (0,0) = mặt đất giữa hai chân. s: tỉ lệ.
 * legs: { dip: hông hạ xuống (gập gối), lx, ly, rx, ry: bàn chân trái/phải lệch khỏi chỗ đứng (ly/ry âm = nhấc lên) }
 * detail: có viền nét, dây giày (nhân vật đủ to trên màn hình).
 */
export function drawLegs(ctx, s, parts, legs = {}, detail = true) {
  const dip = legs.dip || 0;
  const hipY = (-(FOOT_Y - HIP_Y) + dip) * s;
  const LH = [-7 * s, hipY];
  const RH = [7 * s, hipY];
  const LF = [(-8 + (legs.lx || 0)) * s, (-3 + (legs.ly || 0)) * s];
  const RF = [(8 + (legs.rx || 0)) * s, (-3 + (legs.ry || 0)) * s];
  const LK = pickJoint(LH, LF, THIGH * s, SHIN * s, -1, 0);
  const RK = pickJoint(RH, RF, THIGH * s, SHIN * s, 1, 0);
  const legPath = () => {
    ctx.beginPath();
    ctx.moveTo(LH[0], LH[1]);
    ctx.lineTo(LK[0], LK[1]);
    ctx.lineTo(LF[0], LF[1]);
    ctx.moveTo(RH[0], RH[1]);
    ctx.lineTo(RK[0], RK[1]);
    ctx.lineTo(RF[0], RF[1]);
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (detail) {
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 12.5 * s;
    legPath();
    ctx.stroke();
  }
  // đùi + cẳng chân cùng màu quần: vẽ cả 2 chân một lần (khớp tròn nhờ lineJoin)
  ctx.strokeStyle = parts.pants;
  ctx.lineWidth = 9.5 * s;
  legPath();
  ctx.stroke();
  // giày sneaker: thân màu + đế trắng, mũi chĩa ra ngoài, nghiêng khi nhấc chân
  const shoe = parts.shoe || '#f5f5f5';
  if (!detail) {
    // ở xa: giày đơn giản, vẽ cả đôi một lần
    ctx.fillStyle = shoe;
    ctx.beginPath();
    ctx.ellipse(LF[0] - 2 * s, LF[1] + 1 * s, 8.5 * s, 4.5 * s, 0, 0, Math.PI * 2);
    ctx.moveTo(RF[0] + 10.5 * s, RF[1] + 1 * s);
    ctx.ellipse(RF[0] + 2 * s, RF[1] + 1 * s, 8.5 * s, 4.5 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  for (const [f, side] of [
    [LF, -1],
    [RF, 1],
  ]) {
    const tilt = side * Math.min(0.5, Math.max(0, -f[1] / s - 3) / 30);
    ctx.save();
    ctx.translate(f[0] + side * 2 * s, f[1] + 2 * s);
    ctx.rotate(tilt);
    ctx.fillStyle = shoe;
    ctx.beginPath();
    ctx.ellipse(side * 1 * s, -1 * s, 8.5 * s, 5 * s, 0, Math.PI, 0);
    ctx.lineTo(side * 9.5 * s, 2 * s);
    ctx.lineTo(-side * 7.5 * s, 2 * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = shoe === '#f5f5f5' ? '#d32f2f' : '#fafafa';
    ctx.fillRect(-8 * s, 1 * s, 17.5 * s, 2.8 * s); // đế
    {
      ctx.strokeStyle = OUT;
      ctx.lineWidth = 1.6 * s;
      ctx.beginPath();
      ctx.ellipse(side * 1 * s, -1 * s, 8.5 * s, 5 * s, 0, Math.PI, 0);
      ctx.lineTo(side * 9.5 * s, 3.8 * s);
      ctx.lineTo(-side * 7.5 * s, 3.8 * s);
      ctx.closePath();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.8)';
      ctx.lineWidth = 1.2 * s;
      ctx.beginPath();
      ctx.moveTo(-2 * s, -4 * s);
      ctx.lineTo(2 * s, -3 * s);
      ctx.moveTo(-1.5 * s, -2 * s);
      ctx.lineTo(2.5 * s, -1 * s);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** Đôi cánh thiên thần phát sáng xanh (lệnh "Huy hiệu + cánh"). */
export function drawWings(ctx, x, y, s, t) {
  const cy = y - 80 * s;
  const flap = Math.sin(t * 6) * 0.18;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(x + side * 10 * s, cy);
    ctx.rotate(side * (0.15 + flap));
    ctx.scale(side * s, s);
    const g = ctx.createLinearGradient(0, -40, 70, 20);
    g.addColorStop(0, 'rgba(120,220,255,0.95)');
    g.addColorStop(1, 'rgba(40,120,255,0.15)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(30, -55, 78, -42);
    ctx.quadraticCurveTo(62, -28, 72, -18);
    ctx.quadraticCurveTo(52, -10, 62, 2);
    ctx.quadraticCurveTo(40, 4, 46, 16);
    ctx.quadraticCurveTo(20, 14, 0, 10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/** Thẻ tên vẽ sẵn: [huy hiệu] tên, viền màu cấp VIP. */
export function renderTag(name, color, rank, badge, font) {
  const size = 22;
  const c = document.createElement('canvas');
  const g0 = c.getContext('2d');
  g0.font = `700 ${size}px ${font}`;
  const tw = Math.min(g0.measureText(name).width, 240);
  const pad = badge ? 34 : 12;
  c.width = Math.ceil(tw + pad + 14);
  c.height = 34;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(8,8,16,.72)';
  g.beginPath();
  g.roundRect(1, 1, c.width - 2, 32, 16);
  g.fill();
  if (rank >= 1) {
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.stroke();
  }
  if (badge) {
    g.font = `20px ${font}`;
    g.textBaseline = 'middle';
    g.fillText('🏅', 8, 18);
  }
  g.font = `700 ${size}px ${font}`;
  g.textBaseline = 'middle';
  g.fillStyle = rank >= 1 ? color : '#fff';
  g.fillText(name, pad, 18, 240);
  return c;
}
