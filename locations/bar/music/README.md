# Nhạc cho Bar

Đặt file nhạc ở đây đúng tên trong `../location.json` → `features.music.playlist[].file`
(mặc định `song1.mp3` … `song5.mp3`), đổi `title`/`bpm` cho khớp bài thật.

⚠️ **Chỉ dùng nhạc miễn phí bản quyền** — nhạc nổi tiếng gần như chắc chắn bị TikTok tắt tiếng / phạt.
Gợi ý: https://pixabay.com/music/ (tìm "party", "edm", "funny", "disco"), nhạc tự làm, hoặc nhạc mua giấy phép.

`bpm` (nhịp mỗi phút) giúp đám đông nhảy đúng nhịp: bài sôi động ~120-140, bài chill ~90-100.
Chưa có file thì hệ thống vẫn "phát" (không có tiếng): hiện tên bài, đổi bài theo thời gian, đám đông nhảy theo bpm.

Hiện có sẵn `song1.mp3` … `song5.mp3` do `scripts/tao-nhac.py` tự tổng hợp (disco, không bản quyền, khớp `bpm` trong playlist).
Muốn tạo lại: `python3 scripts/tao-nhac.py` (cần numpy + ffmpeg). Thay bằng nhạc khác thì chỉ cần ghi đè file cùng tên.
