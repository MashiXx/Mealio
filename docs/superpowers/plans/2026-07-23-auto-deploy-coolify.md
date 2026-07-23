# Auto-deploy Mealio bằng Coolify — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đóng gói Mealio thành Docker image chạy được qua Coolify, migrate DB tự động khi khởi động, để mỗi `git push main` → Coolify tự build + deploy; Postgres và Ollama do Coolify quản lý.

**Architecture:** Next.js 16 build ở chế độ `output: "standalone"` cho image runtime gọn. Multi-stage Dockerfile (deps → builder → runner). Entrypoint chạy `prisma migrate deploy` rồi `node server.js`. App chạy bridge network trong Coolify, nối tới Postgres (qua `DATABASE_URL` Coolify set) và Ollama (qua URL nội bộ nhập ở UI Cài đặt AI). Coolify tự cấp reverse proxy + SSL.

**Tech Stack:** Next.js 16.2.9, React 19, Prisma 6 (PostgreSQL), NextAuth v5, Docker (base `node:22-slim`), Coolify.

## Global Constraints

- **Đây KHÔNG phải Next.js thường** (xem AGENTS.md): trước khi dùng bất kỳ API/option Next nào, đọc `node_modules/next/dist/docs/` của bản đang cài để xác nhận; adapt nếu khác.
- **Package manager: yarn** (có `yarn.lock`, không có `packageManager` field → yarn classic 1.x, đã có sẵn trong image `node:*`). Dùng `yarn install --frozen-lockfile`.
- **DB dùng migrations**: luôn `prisma migrate deploy`, KHÔNG `prisma db push`.
- **Node 20+** (Next 16/React 19). Base image dùng `node:22-slim` (Debian) — tránh rắc rối Prisma trên musl/alpine; cần package `openssl` + `ca-certificates`.
- **`ENCRYPTION_KEY`** phải là hex đúng 64 ký tự (32 byte), nếu không app throw lúc mã hoá.
- **NextAuth v5 sau proxy** cần `AUTH_TRUST_HOST=true` và `AUTH_URL` khớp domain.
- **Cấu hình AI KHÔNG qua env** — lưu ở bảng `AISettings`, nhập qua UI. Env chỉ có tinh chỉnh tùy chọn `MEALIO_OLLAMA_NUM_CTX`, `MEALIO_OLLAMA_TEMPERATURE`, `MENU_GEN_CONCURRENCY`.

## File Structure

| File | Trách nhiệm | Create/Modify |
|---|---|---|
| `next.config.ts` | Bật `output: "standalone"` | Modify |
| `.dockerignore` | Loại file thừa khỏi build context | Create |
| `docker-entrypoint.sh` | Migrate DB rồi start server | Create |
| `Dockerfile` | Multi-stage build → image runtime | Create |
| `docs/deploy-coolify.md` | Runbook cấu hình Coolify (thao tác trên VPS) | Create |

---

### Task 1: Bật standalone output và xác minh build

**Files:**
- Modify: `next.config.ts`
- (Prereq) cài dependencies: `node_modules/` hiện chưa có.

**Interfaces:**
- Produces: thư mục `.next/standalone/server.js` sau khi build — Task 2 (Dockerfile) copy từ đây; cả `.next/static` và `public`.

- [ ] **Step 1: Cài dependencies**

Run: `yarn install --frozen-lockfile`
Expected: cài xong không lỗi; `node_modules/next` xuất hiện.

- [ ] **Step 2: Xác nhận option standalone trong bản Next đang cài (AGENTS.md)**

Run: `grep -rli standalone node_modules/next/dist/docs/ | head`
Expected: có tài liệu nhắc `output: 'standalone'`. Nếu bản này đổi tên/hành vi option, dùng đúng tên tài liệu ghi và điều chỉnh Step 3 cho khớp.

- [ ] **Step 3: Sửa `next.config.ts` bật standalone**

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

- [ ] **Step 4: Build và xác minh sinh ra standalone**

Run: `yarn build && ls .next/standalone/server.js .next/static public/`
Expected: build thành công; `.next/standalone/server.js` tồn tại (đây là file entrypoint runtime).

- [ ] **Step 5: Commit**

```bash
git add next.config.ts
git commit -m "build(deploy): bật output standalone cho Next build"
```

---

### Task 2: Dockerfile + entrypoint + .dockerignore (build image thành công)

**Files:**
- Create: `.dockerignore`
- Create: `docker-entrypoint.sh`
- Create: `Dockerfile`

**Interfaces:**
- Consumes: `.next/standalone/server.js`, `.next/static`, `public/` (Task 1); `prisma/schema.prisma` + `prisma/migrations/` (đã có trong repo).
- Produces: Docker image chạy `docker-entrypoint.sh` → `prisma migrate deploy` → `node server.js`, nghe cổng `3000`.

- [ ] **Step 1: Tạo `.dockerignore`**

```
node_modules
.next
.git
.env*
.DS_Store
npm-debug.log
yarn-error.log
docs/superpowers
```

- [ ] **Step 2: Tạo `docker-entrypoint.sh`**

```sh
#!/bin/sh
set -e

echo "▶ prisma migrate deploy..."
./node_modules/.bin/prisma migrate deploy

echo "▶ starting Next.js (node server.js)..."
exec node server.js
```

- [ ] **Step 3: Tạo `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1

# ---- deps: cài toàn bộ dependencies (gồm dev) để build ----
FROM node:22-slim AS deps
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# ---- builder: prisma generate + next build (standalone) ----
FROM node:22-slim AS builder
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Dummy DATABASE_URL để build không gãy nếu có code đọc env lúc build; runtime dùng env thật.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN yarn prisma generate
RUN yarn build

# ---- runner: image runtime gọn từ standalone ----
FROM node:22-slim AS runner
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# App standalone
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Prisma runtime: client đã generate + schema/migrations + CLI + engine cho migrate deploy
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma/engines ./node_modules/@prisma/engines
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY --from=builder /app/prisma ./prisma

COPY --chmod=755 docker-entrypoint.sh ./docker-entrypoint.sh

USER nextjs
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
```

- [ ] **Step 4: Build image, xác minh thành công**

Run: `docker build -t mealio:test .`
Expected: build tới stage `runner` không lỗi; kết thúc `naming to docker.io/library/mealio:test`.
(Nếu không có Docker trên máy dev, hoãn Step 4–5 sang khi test trên VPS và ghi chú lại — KHÔNG đánh dấu hoàn thành.)

- [ ] **Step 5: Commit**

```bash
git add Dockerfile docker-entrypoint.sh .dockerignore
git commit -m "feat(deploy): Dockerfile standalone + entrypoint migrate deploy"
```

---

### Task 3: Smoke test container cục bộ (migrate + boot + HTTP)

**Files:** (không sửa file — kiểm thử image từ Task 2)

**Interfaces:**
- Consumes: image `mealio:test` (Task 2).
- Produces: bằng chứng container tự migrate DB trống, khởi động, và trả HTTP cho một route.

- [ ] **Step 1: Chạy Postgres tạm trên mạng Docker riêng**

```bash
docker network create mealio-test || true
docker run -d --name mealio-pg --network mealio-test \
  -e POSTGRES_PASSWORD=pass -e POSTGRES_DB=mealio postgres:16
```
Expected: container `mealio-pg` chạy (`docker ps` thấy nó).

- [ ] **Step 2: Chạy app image, quan sát migrate + boot**

```bash
docker run --rm --name mealio-app --network mealio-test -p 3000:3000 \
  -e DATABASE_URL="postgresql://postgres:pass@mealio-pg:5432/mealio" \
  -e AUTH_SECRET="$(openssl rand -base64 33)" \
  -e AUTH_TRUST_HOST=true \
  -e AUTH_URL="http://localhost:3000" \
  -e ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  mealio:test
```
Expected log: dòng `prisma migrate deploy` áp dụng các migration (init, add_ollama..., add_generation_job, add_dish_catalog) rồi log Next “Ready”/đang nghe cổng 3000. Nếu báo thiếu Prisma engine/schema → bổ sung COPY tương ứng ở Dockerfile Task 2 và build lại.

- [ ] **Step 3: Gọi thử một route (terminal khác)**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/login`
Expected: `200` (trang đăng nhập render server-side, không cần AI/Ollama).

- [ ] **Step 4: Dọn dẹp**

```bash
docker rm -f mealio-app mealio-pg 2>/dev/null || true
docker network rm mealio-test 2>/dev/null || true
```
Expected: gỡ sạch container/network tạm.

- [ ] **Step 5: Commit** (chỉ khi có thay đổi Dockerfile do Step 2 phát sinh)

```bash
git add -A && git commit -m "fix(deploy): bổ sung phụ thuộc Prisma runtime cho container"
```
(Nếu không sửa gì thì bỏ qua commit này.)

---

### Task 4: Runbook cấu hình Coolify

**Files:**
- Create: `docs/deploy-coolify.md`

**Interfaces:**
- Consumes: image build từ Dockerfile (Task 2); env ở spec.
- Produces: tài liệu các bước bấm trên Coolify để dựng Postgres + Ollama + app và bật auto-deploy. (Các bước này thực hiện trên VPS/Coolify — người dùng làm, plan chỉ tạo tài liệu.)

- [ ] **Step 1: Tạo `docs/deploy-coolify.md`**

```markdown
# Deploy Mealio lên Coolify

Mô hình: Coolify quản cả Postgres + Ollama + app (bridge network, tự cấp SSL).
Ref thiết kế: docs/superpowers/specs/2026-07-23-auto-deploy-coolify-design.md

## 1. Cài Coolify (nếu chưa)
    curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
Mở dashboard, tạo 1 **Project** mới cho Mealio.

## 2. Tạo service Postgres (managed)
- New Resource → Databases → PostgreSQL → tạo trong cùng project.
- Ghi nhớ để **link** vào app ở bước 4 (Coolify sẽ tự sinh `DATABASE_URL`).

## 3. Tạo service Ollama (managed)
- New Resource → Services → **Ollama** (one-click) → cùng project.
- Đặt/ghi lại **tên service nội bộ** (dùng làm host), cổng `11434`.
- Sau khi chạy: mở terminal của service → pull model:
      ollama pull qwen2.5
  (model lưu trong volume, chỉ pull một lần.)

## 4. Thêm app Mealio
- New Resource → chọn Git repo `mealio` → Build Pack: **Dockerfile** → nhánh `main`.
- Bật **Auto Deploy** (deploy khi push `main`).
- **Link** Postgres (bước 2) vào app → Coolify set `DATABASE_URL`.
- Thêm env (Environment Variables):
  | Env | Giá trị |
  |---|---|
  | `AUTH_SECRET` | `openssl rand -base64 33` |
  | `AUTH_URL` | domain app (bước 5) |
  | `AUTH_TRUST_HOST` | `true` |
  | `ENCRYPTION_KEY` | `openssl rand -hex 32` |
  | `MENU_GEN_CONCURRENCY` | (tùy chọn) |
  | `MEALIO_OLLAMA_NUM_CTX` | (tùy chọn, mặc định 8192) |
  | `MEALIO_OLLAMA_TEMPERATURE` | (tùy chọn, mặc định 0.7) |

## 5. Domain + HTTPS
- Đặt domain cho app trong Coolify → bật SSL (Let's Encrypt tự động).
- Cập nhật `AUTH_URL` khớp domain (vd `https://mealio.example.com`) → redeploy.

## 6. Deploy lần đầu
- Deploy → entrypoint tự chạy `prisma migrate deploy` (tạo schema).
- (Tùy chọn) seed dữ liệu mẫu: mở terminal container app → `yarn db:seed`.

## 7. Cấu hình AI trong app
- Đăng nhập app → **Cài đặt AI**.
- Provider: Ollama; Base URL: `http://<tên-service-ollama>:11434`.
- Chọn model đã pull (bước 3) → **Test** → **Lưu**.

## 8. Kiểm tra auto-deploy
- Sửa vặt ở repo → `git push main`.
- Coolify nhận webhook → build + migrate + swap container tự động.

## Ghi chú
- Ollama managed chạy CPU (trừ khi VPS có GPU + cấu hình thêm) → có thể chậm.
  Muốn dùng Ollama native trên host: chỉ đổi Base URL ở Cài đặt AI, không đổi deploy.
- Migration lỗi → container không start, giữ container cũ (an toàn).
```

- [ ] **Step 2: Commit**

```bash
git add docs/deploy-coolify.md
git commit -m "docs(deploy): runbook cấu hình Coolify"
```

---

## Self-Review

**Spec coverage:**
- `output: "standalone"` + Dockerfile standalone → Task 1, 2. ✅
- Entrypoint `migrate deploy` → Task 2 Step 2. ✅
- `.dockerignore` → Task 2 Step 1. ✅
- Env bắt buộc (DATABASE_URL, AUTH_SECRET, AUTH_URL, AUTH_TRUST_HOST, ENCRYPTION_KEY) → Task 3 (smoke) + Task 4 runbook. ✅
- Postgres managed + link → Task 4 §2,§4. ✅
- Ollama managed + pull model + base URL nội bộ ở UI → Task 4 §3,§7. ✅
- Auto-deploy on push → Task 4 §4,§8. ✅
- SSL/domain → Task 4 §5. ✅
- Lưu ý Ollama CPU/pull model → Task 4 Ghi chú. ✅

**Placeholder scan:** Không có TBD/TODO; mọi file có nội dung đầy đủ. Các mục "(tùy chọn)" là env optional có chủ đích, không phải placeholder.

**Type/name consistency:** `.next/standalone/server.js`, `docker-entrypoint.sh`, tên service `mealio:test`/`mealio-pg`/`mealio-app`/network `mealio-test` nhất quán giữa Task 2 và 3. Đường dẫn Prisma runtime (`node_modules/.prisma`, `node_modules/prisma`, `@prisma/engines`, `.bin/prisma`) khớp với lệnh entrypoint `./node_modules/.bin/prisma`.
