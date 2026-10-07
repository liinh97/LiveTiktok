# ---- Giọng đọc bình luận: Piper (đọc chữ thành tiếng, chạy trên máy, miễn phí) + 2 giọng tiếng Việt ----
# Không tải được (mất mạng...) thì vẫn build tiếp, giọng nói tự dùng dự phòng.
FROM debian:bookworm-slim AS piper
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/piper
RUN ARCH=$([ "$TARGETARCH" = "arm64" ] && echo aarch64 || echo x86_64) \
 && ( curl -fsSL "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_${ARCH}.tar.gz" | tar xz \
   && mkdir -p voices \
   && curl -fsSL https://github.com/rhasspy/piper/releases/download/v0.0.2/voice-vi-vivos-x-low.tar.gz | tar xz -C voices \
   && curl -fsSL https://github.com/rhasspy/piper/releases/download/v0.0.2/voice-vi-25hours-single-low.tar.gz | tar xz -C voices ) \
 || (echo "Không tải được Piper: giọng đọc sẽ dùng dự phòng" && rm -rf /opt/piper/* )

FROM node:22-slim

ENV NODE_ENV=production \
    TZ=Asia/Ho_Chi_Minh

WORKDIR /app

# Cài thư viện trước để tận dụng cache khi chỉ sửa code
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=piper /opt/piper /opt/piper
COPY . .
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
