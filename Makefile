# Gói các lệnh hay dùng của project. `make` không tham số sẽ in danh sách này.
IMAGE   ?= vfakhuongdv/web-to-epub
VERSION := $(shell node -p "require('./package.json').version")
PORT    ?= 3100
PLATFORMS ?= linux/amd64,linux/arm64

.DEFAULT_GOAL := help
.PHONY: help install build dev test start clean \
        dev-frontend dev-all docker-build docker-run docker-stop docker-push \
        app release-mac e2e

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

release-mac: app ## Build app rồi thay file .dmg + .zip trên GitHub release cùng version
	gh release upload v$(VERSION) "release/Web to EPUB-$(VERSION)-arm64.dmg" "release/Web to EPUB-$(VERSION)-arm64-mac.zip" --clobber
