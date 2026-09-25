# Gói các lệnh hay dùng của project. `make` không tham số sẽ in danh sách này.
IMAGE   ?= vfakhuongdv/web-to-epub
VERSION := $(shell node -p "require('./package.json').version")
PORT    ?= 3100
PLATFORMS ?= linux/amd64,linux/arm64
# Model giọng đọc cho các lệnh tts-*: turbo (chất lượng, mặc định) | nano (nhanh)
TTS_VARIANT ?= turbo

.DEFAULT_GOAL := help
.PHONY: help install build dev test start clean \
        dev-frontend dev-all docker-build docker-run docker-stop docker-push \
        app install-mac release-mac e2e tts-install tts-smoke tts-uninstall

help: ## In danh sách lệnh
	@grep -hE '^[a-z0-9-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

## --- Chạy từ source ---

install: ## Cài dependency + Chromium cho Playwright
	npm install
	npx playwright install chromium

build: ## Build backend (tsc) + frontend (vite -> public/)
	npm run build

dev: ## Chạy backend ở chế độ watch (tsc --watch + nodemon)
	npm run dev

dev-frontend: ## Chạy Vite dev server cho frontend (HMR, proxy /api)
	npm run dev:frontend

dev-all: ## Chạy cùng lúc backend (watch) + Vite dev server; Ctrl-C tắt cả hai
	@npm run build:backend
	@trap 'kill 0' EXIT INT TERM; \
		npm run dev & \
		npm run dev:frontend & \
		wait

test: ## Chạy toàn bộ test
	npm test

e2e: ## Chạy E2E (Playwright) — tự build trước
	npm run test:e2e

start: build ## Build rồi chạy server ở PORT (mặc định 3100)
	PORT=$(PORT) npm start

clean: ## Xoá thư mục sinh ra khi build (giữ nguyên data/)
	rm -rf dist public release build/icon.iconset build/icon-1024.png

## --- Giọng đọc (VieNeu-TTS) ---
# Cùng runtime với Settings → Giọng đọc: cài vào $${DATA_DIR:-./data}/tts (uv + Python + model,
# khoảng 1–1,3 GB). Đặt DATA_DIR để trỏ vào thư viện khác, TTS_VARIANT=nano cho model nhanh.

tts-install: build ## Cài bộ giọng đọc (uv + Python + VieNeu + model) vào DATA_DIR/tts
	node scripts/tts.js install $(TTS_VARIANT)

tts-smoke: build ## Đọc thử một câu để kiểm tra bộ giọng đọc đã cài
	node scripts/tts.js smoke $(TTS_VARIANT)

tts-uninstall: build ## Gỡ bộ giọng đọc (xoá DATA_DIR/tts, giữ audio các chương)
	node scripts/tts.js uninstall

## --- Docker ---

docker-build: ## Build image cho máy hiện tại (tag theo version trong package.json)
	docker build -t $(IMAGE):$(VERSION) -t $(IMAGE):latest .

docker-run: ## Chạy container ở PORT, mount ./data
	docker run -d --name web-to-epub -p $(PORT):3100 -v "$(PWD)/data:/app/data" $(IMAGE):latest

docker-stop: ## Dừng và xoá container
	-docker rm -f web-to-epub

docker-push: ## Build multi-arch (amd64 + arm64) và push lên Docker Hub
	docker buildx build --platform $(PLATFORMS) \
		-t $(IMAGE):$(VERSION) -t $(IMAGE):latest --push .

## --- App macOS ---

app: ## Đóng gói app macOS -> release/*.dmg
	npm run app:mac

install-mac: ## Cài bản đã build vào /Applications, thay app hiện tại (build trước bằng: make app)
	@test -d "release/mac-arm64/Web to EPUB.app" || { echo "Chưa có release/mac-arm64/Web to EPUB.app — chạy 'make app' trước."; exit 1; }
	@# Thoát app đang chạy: bản cũ còn sống sẽ giữ cổng/DB và che bản vừa thay.
	@-osascript -e 'quit app "Web to EPUB"' 2>/dev/null
	@for i in 1 2 3 4 5 6 7 8 9 10; do pgrep -x "Web to EPUB" >/dev/null || exit 0; sleep 1; done; \
		echo "App vẫn đang chạy — thoát hẳn app rồi chạy lại 'make install-mac'."; exit 1
	@# Copy sang tên tạm rồi mới thay: ditto lỗi giữa chừng vẫn còn app cũ.
	rm -rf "/Applications/Web to EPUB.app.new"
	ditto "release/mac-arm64/Web to EPUB.app" "/Applications/Web to EPUB.app.new"
	rm -rf "/Applications/Web to EPUB.app"
	mv "/Applications/Web to EPUB.app.new" "/Applications/Web to EPUB.app"
	@echo "Đã cài Web to EPUB $(VERSION) vào /Applications/Web to EPUB.app"

release-mac: app ## Build app rồi thay file .dmg + .zip trên GitHub release cùng version
	@# gh 2.96.0 trả rỗng `gh release view --json assets` nên --clobber không xoá được
	@# asset cũ, upload sẽ fail 422 khi release lại cùng version — xoá bằng REST trước.
	@release_id=$$(gh api repos/vfa-khuongdv/web-to-epub/releases/tags/v$(VERSION) -q .id); \
	for name in "Web.to.EPUB-$(VERSION)-arm64.dmg" "Web.to.EPUB-$(VERSION)-arm64-mac.zip"; do \
		asset_id=$$(gh api "repos/vfa-khuongdv/web-to-epub/releases/$$release_id/assets" -q ".[] | select(.name == \"$$name\") | .id"); \
		if [ -n "$$asset_id" ]; then gh api -X DELETE "repos/vfa-khuongdv/web-to-epub/releases/assets/$$asset_id"; fi; \
	done
	gh release upload v$(VERSION) "release/Web to EPUB-$(VERSION)-arm64.dmg" "release/Web to EPUB-$(VERSION)-arm64-mac.zip"
