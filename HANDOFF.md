# Bàn giao dự án Live World (bar online TikTok)

Tài liệu này để một phiên làm việc mới (người hoặc AI) nắm ngay dự án và làm tiếp.
Cập nhật lần cuối: 2026-10-06, commit `7e6cabd` trên nhánh `main` của `github.com/liinh97/livetiktok`.

> Mở phiên mới: clone repo `liinh97/livetiktok`, rồi bảo AI **"Đọc HANDOFF.md và README.md rồi làm tiếp"**.

---

## 1. Bối cảnh

- Chủ dự án mở quán ăn vặt (nem chua rán, bánh rán...). Dự án này là **nguồn thu nhập mới, tách riêng khỏi quán**:
  live TikTok tương tác kiểu **"bar online"**.
- **Cách chơi:** người xem vào live thì có một nhân vật chibi mang tên họ đi vào quán bar.
  Tặng quà hoặc gõ lệnh bình luận thì nhân vật làm trò (nhảy, gọi đồ, đổi nhạc, troll bạn bè...).
- **Phong cách đã chốt:**
  - hoạt hình chibi;
  - **nhí nhố, hài hước**;
  - **không có rượu**: chỉ trà sữa, soda, nước ớt, bánh kem...
- **Ngân sách:** miễn phí. Không dùng dịch vụ trả phí, không dùng hình meme hay nhạc có bản quyền.
- **Chạy tự động:** chủ không cần ngồi canh. Chạy bằng **Docker Compose** để khỏi cài môi trường.
- **Tài khoản TikTok:** `diepvien_goc6` (khoảng 72 follower, đã đủ 50 để live).
  Chưa live thật lần nào nên **tên quà thật chưa được kiểm chứng**.
- **Cách lên sóng dự kiến:**
  - (a) TikTok LIVE Studio + OBS Virtual Camera (Browser Source 1080×1920 trỏ vào `/world/`);
  - (b) nếu không được, dùng điện thoại chế độ **Mobile gaming** chia sẻ màn hình trang `http://<IP máy>:3000/world/`.
- **Cách nói chuyện với chủ dự án:** tiếng Việt, câu ngắn, dễ hiểu (chủ không phải dân chuyên kỹ thuật sâu).
  Chủ hay trả lời ngắn kiểu "làm đi", "cứ làm".

## 2. Chạy dự án

```bash
cp .env.example .env        # sửa LIVE_SOURCE=tiktok, TIKTOK_USERNAME=diepvien_goc6, DASHBOARD_TOKEN=...
docker compose up -d --build
```
- Trang hiển thị (đưa vào OBS): `http://localhost:3000/world/`.
  Tham số URL: `?max=150` (số nhân vật tối đa), `?vol=0.5` (âm lượng), `?tts=1` (đọc tên), `?cam=0` (tắt camera tự lia, đứng yên toàn cảnh).
- Bảng điều khiển: `http://localhost:3000/dashboard/`.
  Có nút thử quà, ô chat thử với tên tuỳ chọn, "Thả 50 người vào", chặn người, tạm dừng.
- Không dùng Docker (khi phát triển): Node 22, chạy `npm ci`, `npm start`, `npm run sim` (nguồn giả lập), `npm test`.
- `config/` và `locations/` được mount chỉ đọc vào container: sửa xong chỉ cần `docker compose restart`.
- `docker compose down -v` **xoá toàn bộ dữ liệu** (volume `live-data`). Nên chạy một lần trước buổi live thật để xoá dữ liệu giả lập.

## 3. Kiến trúc

```
Nguồn sự kiện (tiktok | simulator) → src/sources/manager.js (tự kết nối lại, chuyển nguồn dự phòng)
  → src/core/pipeline.js (lọc trùng, lọc từ cấm, giới hạn tần suất, cấp VIP, presence, luật → hành động)
     ↳ src/features/* (tính năng tương tác theo địa điểm, trạng thái giữ ở máy chủ)
  → WebSocket (src/server/hub.js) → public/world/engine.js (canvas 1080×1920) + locations/<id>/scene.js
```

- **Sự kiện chuẩn:** `{id,type,source,ts,test,user{id,name,avatar},text?,likes?,gift?{id,name,coins,count,image}}`.
  Loại sự kiện: `join` · `chat` · `like` · `gift` · `follow` · `share`.
- **Hành động** gửi xuống trang hiển thị: `{ action, user, data, priority, say }`.
  Hành động có `priority >= 3` được xếp hàng diễn lần lượt (stage queue).
- **Luật** (`config/rules.default.json`, ghi đè trong `locations/<id>/location.json` → `rules`):
  - `gift`: quà theo **bậc xu**;
  - `commands`: quà theo **tên quà**, kèm `look: grow|shrink|wings|change`;
  - `chat`, `join`, `like`...
- **Tính năng** (`src/features/index.js`, bật/tắt trong `location.json` → `features`). Mỗi lớp có thể có các hook:
  - `onChat(ctx)`: nhận lệnh `!...`;
  - `afterGift(ctx)`;
  - `transform(action, ctx)`;
  - `tick(now)` (chạy mỗi 500 ms);
  - `onWorldMessage(msg)`;
  - `publicState()`: gửi xuống client qua `state.features`.

  Mỗi lớp nhận `env = { now, make(user, action, data, {priority, say}), emit, changed, findUser(name, excludeId) }`.
- **Lưu trữ:** SQLite (`node:sqlite`) ở `data/`. Bảng: `players` (tổng xu, cấp, `look`), `gifts`, `sessions`, `blocked`.
- **Lịch:** `config/schedule.json` (múi giờ `Asia/Ho_Chi_Minh`). Hiện đang để `00:00–24:00`.
  **Phải đổi thành giờ live thật**, không thì canh chừng (watchdog) báo mất nguồn liên tục.
- **Client:**
  - `public/world/engine.js`: crowd mỗi người xem một nhân vật, NPC, camera, banner, HUD, nhạc, các hành động mặc định ở object `defaults`.
  - `public/world/chibi.js`: vẽ chibi thành sprite; `drawArms` với các tư thế cheer, dance, pump, clap, point, roof, wave2, swing, carry, tpose, flap, noodle.
  - `public/world/fx.js`: hạt và đèn sân khấu.
  - Scene ghi đè hành động qua `scene.actions[action](w, a, defaults)`.
  - API cho scene là object `w`, gồm: `charFor`, `npc`, `walk`, `dance`, `pose`, `drinkEffect`, `coffinDance`, `fly`, `banner`, `camera`, `fx`...

## 4. Tính năng đang có (bối cảnh `bar`)

### Quà
- **Quà theo tên** (`commands`):

  | Quà | Lệnh |
  |---|---|
  | Rose | nhảy lộn |
  | TikTok | đi vòng |
  | Ice Cream Cone | nhỏ lại |
  | GG | pháo hoa |
  | Finger Heart | to lên |
  | Perfume | camera zoom |
  | Doughnut | đổi nhân vật |
  | Hand Hearts | cánh + huy hiệu |
  | Corgi | gọi dancer linh vật |

- **Quà theo bậc xu:**
  - 1 xu: trà sữa;
  - 30 xu: soda + đèn rọi;
  - 500 xu: bánh kem pháo sáng;
  - 5000 xu: bao cả quán (laser, khói CO2, kim tuyến).
- **Cấp VIP** theo tổng xu (0 / 100 / 1000 / 5000 / 20000).

### Lệnh bình luận
| Lệnh | File | Việc |
|---|---|---|
| `!goi <món>`, `!menu` | `orders.js` | Gọi đồ miễn phí (chờ 3 phút, VIP nửa thời gian). Bồi bàn mang tới, uống xong "lên cơn": phun lửa, nấc, chạy siêu tốc, đóng băng, ợ bay, nhăn mặt |
| `!moi <tên>`, `!nem <tên>` | `orders.js` | Sau khi tặng quà: mời nước / ném bánh kem |
| `!baihat`, `!nhac <số>`, `!vote <số>` | `music.js` | Playlist cố định, tặng ≥ 30 xu để chen hàng. Đám đông nhảy theo bpm |
| `!dancer <tên>` | `dancers.js` | Chọn dancer (Gà Quay, Khủng Long, Gấu Béo) trước khi tặng Corgi |
| `!troll <tên>` + quà | `troll.js` | Troll theo số xu. 1 xu: vỏ chuối / mặt ngáo / hoá khoai. 5 xu: T-pose bay / sâu đo. 20 xu: hoá gà. 30 xu: xì hơi tên lửa. 99 xu: khiêng quan tài |
| `!khien` + quà | `troll.js` | Khiên 2 phút, troll vào bị dội ngược |
| `!nhay ga\|sau\|tpose\|ngao\|deo\|hiphop` | `troll.js` | Điệu troll miễn phí, chờ 45 giây. `hiphop` = cả chuỗi breakdance (toprock, running man, cối xay gió, trồng chuối xoay, freeze) |

### Hoạt động tự động
- **Mục tiêu chung** (`goal.js`): "Tháp trà sữa cả quán". Quà cộng dồn, đủ thì cả quán được thưởng, mục tiêu sau tăng dần.
- **Nạn nhân của đêm**: người bị troll nhiều nhất trong ngày (từ 2 lần) đội mũ hề, tên hiện ở HUD.
  Bảng này **chỉ giữ trong bộ nhớ**, khởi động lại máy chủ là mất.
- **Solo troll**: mỗi lần đổi bài, một người ngẫu nhiên được đèn rọi lên nhảy điệu troll.
- **Drop nhạc**: thỉnh thoảng cả quán cùng làm một động tác.
- **Màn LED** sau quầy: bài đang phát, hàng chờ nhạc, đơn đang pha, chữ chạy hướng dẫn lệnh.
- **NPC**: bartender, DJ, 2 bồi bàn giao đồ, 3 dancer linh vật trên quầy.

### Hiệu năng
Đo trong trình duyệt không có GPU: 200 nhân vật khoảng 56 fps, 400 nhân vật khoảng 29 fps.
Khuyên đặt khoảng 300 trên PC, 150–200 trên điện thoại.

## 5. Quy ước khi làm tiếp

- **Ngôn ngữ:** comment và chữ hiển thị bằng tiếng Việt, theo phong cách code sẵn có.
- **Kiểm tra trước khi commit:**
  - Chạy test: `npm test` (`node:test`). Hiện có 46 test, tất cả phải pass.
  - Tính năng mới thì thêm test vào `test/features.test.js` theo mẫu `setup()`.
- **Kiểm tra hình ảnh:** chạy máy chủ ở cổng khác, bơm sự kiện qua `POST /api/simulate`
  (body `{type, userId, name, text?, giftName?, coins?}`), rồi chụp màn hình bằng Playwright.
  - Trong sandbox phải import `/opt/node22/lib/node_modules/playwright/index.mjs` trực tiếp, vì ESM bỏ qua `NODE_PATH`.
  - Chrome headless không có H.264: muốn thử video thì dùng WebM.
  - Dùng `config/config.local.json` (đã gitignore) để đặt `dataDir` tạm và hạ `simulator.eventsPerSecond`. **Xoá file này sau khi thử.**
  - Dừng máy chủ bằng file PID. **Đừng dùng `pkill -f src/index.js`**: lệnh này tự giết luôn shell đang chạy nó.
- **Git:**
  - Commit thẳng lên `main` của `liinh97/livetiktok`, message tiếng Việt.
  - Không tạo PR trừ khi chủ yêu cầu.
  - Không ghi tên model AI vào commit hay code.
- Chạy `docker compose build` trong sandbox có thể lỗi `npm ci` do proxy mạng. Đây là lỗi riêng của sandbox, `Dockerfile` trong repo vẫn giữ sạch.

## 6. Việc của chủ dự án (chưa làm)

1. Thêm nhạc miễn phí bản quyền vào `locations/bar/music/` (`song1.mp3`…`song5.mp3`), hoặc sửa `features.music.playlist`.
2. Đổi `config/schedule.json` sang giờ live thật, ví dụ `20:00–23:00`.
3. Sửa `.env`: `LIVE_SOURCE=tiktok`, `TIKTOK_USERNAME=diepvien_goc6`, `DASHBOARD_TOKEN`.
4. Chạy `docker compose down -v` một lần trước buổi live đầu để xoá dữ liệu giả lập.
5. Buổi live đầu: xem **tên quà thật** trong nhật ký bảng điều khiển, rồi sửa `rules.commands` và `minCoins` của troll cho khớp.
6. Thử cài TikTok LIVE Studio. Nếu tài khoản chưa được dùng thì live bằng điện thoại chế độ Mobile gaming.

## 7. Việc kỹ thuật còn dở / ý tưởng tiếp theo

**Đã đề xuất, chủ chưa chốt:**
- Dancer battle.
- Bàn VIP (đấu giá giành bàn).
- "Vua của đêm".
- Quay số may mắn.
- Menu bar dùng **món thật của quán ăn vặt** (nem chua rán, bánh rán) kèm tên và địa chỉ quán trên màn LED để quảng cáo quán. Cần chủ gửi tên quán, địa chỉ và danh sách món.

**Đã hứa từ đầu:**
- Nguồn dự phòng bằng trình duyệt (Playwright mở trang live, không cần Euler Stream).

**Nên làm:**
- Lưu bảng "Nạn nhân của đêm" vào SQLite để khởi động lại không mất.
- Menu quà trên màn hình (góc phải) che bớt đám đông: cân nhắc thu gọn hoặc cho nó tự ẩn/hiện.
- Đọc tên bằng TTS tiếng Việt tốt hơn (giọng trình duyệt trong OBS có thể không có tiếng Việt).
- Hướng dẫn quay video quảng bá bằng OBS. Đã đề nghị, chủ chưa trả lời.

## 8. Lưu ý rủi ro

- `tiktok-live-connector` và Euler Stream là công cụ **không chính thức**. Có thể hỏng khi TikTok thay đổi, và việc dùng chúng nằm ngoài điều khoản của TikTok.
- TikTok hạn chế lượt hiển thị của live "treo máy". Mấy buổi đầu chủ nên bật mic nói chuyện với người xem.
- Nội dung troll phải vui, không xúc phạm: không chửi, không chê ngoại hình, không dùng mặt người thật làm meme.
