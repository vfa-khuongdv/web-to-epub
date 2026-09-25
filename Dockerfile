# syntax=docker/dockerfile:1

# ---------- Stage 1: build (tsc backend + vite frontend -> public/) ----------
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Cài dependency trước, tách khỏi source để tận dụng cache layer.
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY frontend ./frontend
RUN npm run build

# ---------- Stage 2: runtime ----------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3100 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    CHROMIUM_NO_SANDBOX=1

WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/
RUN npm ci --omit=dev && npm cache clean --force

# Chromium + thư viện hệ thống cho Playwright (cần quyền root, làm trước USER).
# Gọi thẳng cli.js: playwright (prod) và @playwright/test (dev) trùng tên bin "playwright",
# npm chỉ link .bin/playwright -> @playwright/test/cli.js, mà dep dev đã bị --omit=dev bỏ đi.
RUN node node_modules/playwright/cli.js install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* \
    && chmod -R a+rx /ms-playwright

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
# Worker Python cho giọng đọc (VieNeu-TTS). Bản thân Python, uv và model được app tự tải
# vào /app/data/tts khi người dùng bấm Cài đặt trong Settings → Giọng đọc.
COPY tts ./tts

# Thư viện (SQLite + ảnh bìa) nằm ở /app/data — mount volume vào đây để giữ dữ liệu.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 3100
CMD ["node", "dist/server.js"]
