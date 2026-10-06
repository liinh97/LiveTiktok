# Nền thật cho Bar (tuỳ chọn)

Thả một trong các file sau vào thư mục này là bối cảnh tự dùng làm nền, không cần cấu hình gì:

- `background.mp4` hoặc `background.webm` — video chạy lặp (ưu tiên)
- `background.jpg` / `.png` / `.webp` — ảnh tĩnh

Sau khi thả file, tải lại trang hiển thị (`/world/`). Không có file thì bối cảnh tự vẽ nền lounge.

Gợi ý lấy miễn phí (cho phép dùng thương mại, vẫn nên đọc giấy phép từng video):
- https://www.pexels.com/videos/ — tìm "bar bokeh", "lounge night", "cocktail bar", "nightclub lights"
- https://pixabay.com/videos/ — tìm "bar", "neon", "club lights"

Mẹo: chọn video **dọc** (9:16) hoặc cảnh rộng, tối, không có chữ/logo; cảnh mờ nhoè (bokeh) hợp nhất vì
bóng người và chữ sẽ nổi bật. Nên nén còn dưới ~20 MB, ví dụ:
`ffmpeg -i in.mp4 -vf "scale=-2:1920,crop=1080:1920" -an -c:v libx264 -crf 26 -preset slow background.mp4`
