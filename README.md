# Live World — lõi cho live TikTok tương tác

Đây là bộ **lõi**: nhận sự kiện từ live (vào phòng, thả tim, bình luận, follow, chia sẻ, tặng quà), xử lý, rồi gửi **hành động** xuống trang hiển thị để diễn hiệu ứng. Trang hiển thị được đưa vào OBS.

Phần nội dung (live chủ đề gì, hiệu ứng ra sao) **chưa làm**. Hiện chỉ có một cảnh `demo` để kiểm tra luồng.

```
Nguồn sự kiện ──▶ Lõi xử lý ──▶ Trang hiển thị (OBS) ──▶ phát live
(TikTok / giả lập)   │            (cảnh theo địa điểm)
                     ├─ dữ liệu người xem dùng chung (SQLite)
                     ├─ lập lịch địa điểm theo giờ
                     ├─ canh chừng + báo Telegram
                     └─ bảng điều khiển (điện thoại)
```

## Chạy bằng Docker (khuyên dùng)

Chỉ cần cài Docker (trên Windows/Mac là Docker Desktop), không phải cài Node hay thư viện gì.

```bash
cp .env.example .env        # điền thông tin (xem bên dưới)
docker compose up -d --build
```

Sau đó mở:
- Trang hiển thị: http://localhost:3000/world/ (thêm `?tts=1` để đọc tên bằng giọng nói của trình duyệt)
- Bảng điều khiển: http://localhost:3000/dashboard/

Các lệnh hay dùng:

| Việc | Lệnh |
|---|---|
| Xem log | `docker compose logs -f` |
| Áp dụng thay đổi trong `config/` hoặc `locations/` | `docker compose restart` (không cần build lại) |
| Cập nhật code mới | `git pull && docker compose up -d --build` |
| Dừng | `docker compose down` (dữ liệu vẫn được giữ trong volume `live-data`) |

Container tự chạy lại khi lỗi hoặc khi máy khởi động lại (`restart: unless-stopped`), và có kiểm tra sức khoẻ qua `/health`.

### Chạy với TikTok thật

1. Trong `.env`, điền:
   - `LIVE_SOURCE=tiktok`
   - `TIKTOK_USERNAME=...`
   - `EULER_API_KEY` (để trống thì dùng hạn mức miễn phí)
2. Chạy `docker compose up -d`.
3. Trong OBS, thêm **Browser Source** với URL `http://localhost:3000/world/`, kích thước **1080×1920**.
4. Nên chừa phần dưới màn hình: trên app TikTok, khung bình luận sẽ che vùng đó.

### Chạy không dùng Docker (khi phát triển)

Cần Node.js 22.13 trở lên.

```bash
npm install
npm run sim      # chạy với nguồn GIẢ LẬP
npm test         # chạy kiểm thử
```

## Các phần của lõi

| Phần | File | Việc làm |
|---|---|---|
| Sự kiện chuẩn | `src/events.js` | Mọi nguồn đều đổi về một định dạng chung |
| Nguồn TikTok | `src/sources/tiktok.js` | Dùng `tiktok-live-connector`; quà combo chỉ tính khi kết thúc |
| Nguồn giả lập | `src/sources/simulator.js` | Sinh sự kiện ngẫu nhiên để thử |
| Quản lý nguồn | `src/sources/manager.js` | Tự kết nối lại (chờ tăng dần). Lỗi liên tục thì chuyển sang nguồn dự phòng. Kênh chưa live thì chờ rồi thử lại. |
| Lõi xử lý | `src/core/pipeline.js` | Lọc trùng, lọc nội dung, giới hạn tần suất thả tim, gộp lượt vào khi đông, ghi quà, tra luật, phát hành động |
| Luật | `src/core/rules.js`, `config/rules.default.json` | Sự kiện nào ra hành động nào. Quà chia bậc theo tổng xu. Mỗi địa điểm ghi đè được. |
| Dữ liệu chung | `src/core/store.js` | Hồ sơ người xem, tổng xu và cấp **dùng chung cho mọi địa điểm**; quà, ca live, danh sách chặn |
| Cấp người xem | `src/core/tiers.js`, `config/config.json` → `tiers` | Cấp theo tổng xu đã tặng |
| Lập lịch | `src/core/scheduler.js`, `config/schedule.json` | Khung giờ nào mở địa điểm nào. Ghi đè tay được. |
| Lọc nội dung | `src/core/filter.js`, `config/banned-words.txt` | Tên hoặc bình luận có từ cấm, link, số điện thoại quảng cáo. Danh sách chặn. |
| Canh chừng | `src/core/watchdog.js` | Báo khi mất nguồn trong giờ mở cửa, khi lâu không có sự kiện, khi không có trang hiển thị |
| Báo động | `src/notify/` | Hiện trên bảng điều khiển + Telegram, có thời gian chờ để không spam |
| Máy chủ | `src/server/` | Trang hiển thị, bảng điều khiển, API, proxy ảnh đại diện, `/health` |
| Engine hiển thị | `public/world/engine.js` | Tải cảnh theo địa điểm, chuyển cảnh, xếp hàng hiệu ứng lớn, hiệu ứng cơ bản. Mỗi cảnh có sẵn một đám đông cố định (mặc định 30 nhân vật, chỉnh bằng `maxChars`); ai tương tác thì bốc ngẫu nhiên một nhân vật tạm mang tên người đó để diễn |

Một số nguyên tắc:
- **Quà luôn được ghi**, kể cả khi đang tạm dừng hiệu ứng, khi người tặng bị chặn, hoặc ngoài giờ mở cửa.
- **Sự kiện thử** từ bảng điều khiển không tính vào thống kê.
- Mỗi lần đổi địa điểm là một **ca**. Bảng điều khiển hiện xu, xu/giờ và số người tặng của ca đó.

## Thêm một địa điểm (loại hình live) mới

1. Sao chép `locations/demo` thành `locations/<tên-mới>`.
2. Sửa `location.json`: `name`, `emoji`, và `rules` nếu muốn ghi đè luật mặc định.
3. Sửa `scene.js`: vẽ nền trong `background()`. Có thể thêm `actions` để diễn hành động theo kiểu riêng; hợp đồng đầy đủ ghi ở đầu `public/world/engine.js`.
4. Thêm khung giờ vào `config/schedule.json`.

Hành động gửi xuống cảnh có tên: `enter`, `cheer`, `follow`, `share`, `chat`, `crowd`, `gift_small`, `gift_medium`, `gift_big`, `gift_huge`, `tier_up`, và các tên tự đặt trong luật. Dữ liệu tuỳ ý cho cảnh được đặt trong luật qua trường `params`.

## Báo động qua Telegram

1. Nhắn cho @BotFather để tạo bot và lấy token.
2. Nhắn một tin cho bot vừa tạo, rồi lấy chat id (ví dụ qua @userinfobot).
3. Điền `TELEGRAM_BOT_TOKEN` và `TELEGRAM_CHAT_ID` vào `.env`.

Hệ thống sẽ báo khi: mất kết nối hoặc kênh chưa live trong giờ mở cửa, lâu không có sự kiện, không có trang hiển thị, có quà lớn, có người bị lọc nhiều lần, hoặc đổi địa điểm.

## Mở bảng điều khiển trên điện thoại

- Cùng mạng wifi: mở `http://<IP máy tính>:3000/dashboard/`.
- Ở ngoài: dùng Tailscale hoặc Cloudflare Tunnel.
- **Nhớ đặt `DASHBOARD_TOKEN`** trước khi mở ra ngoài mạng nhà.

## Chưa làm

- Nguồn dự phòng **bằng trình duyệt** (Playwright mở trang live, tự bắt dữ liệu, không cần Euler). Lớp nguồn đã sẵn chỗ để cắm vào qua `sources.fallback`.
- Nội dung thật cho các loại hình live.
- Đọc tên bằng dịch vụ TTS tiếng Việt chất lượng cao. Giọng của trình duyệt trong OBS có thể không có tiếng Việt.
- Tự bật/tắt live. Hiện vẫn phải bật tắt live bằng tay hoặc qua OBS.

> Lưu ý: `tiktok-live-connector` và Euler Stream là công cụ **không chính thức** của TikTok. Thư viện có thể hỏng khi TikTok thay đổi, và việc dùng chúng nằm ngoài điều khoản của TikTok.
