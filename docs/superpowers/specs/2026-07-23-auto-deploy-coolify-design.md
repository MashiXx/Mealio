# Auto-deploy Mealio bằng Coolify (Postgres + Ollama managed)

Ngày: 2026-07-23

## Mục tiêu

Tự động deploy Mealio lên VPS đã có sẵn: **mỗi lần `git push` nhánh `main` →
Coolify tự build image, chạy migration DB, restart app, giữ HTTPS**. Postgres và
Ollama đều do Coolify quản lý (managed service), không dùng bản native trên host.

## Bối cảnh & quyết định

- **Nền tảng**: VPS tự quản đã có sẵn (SSH được).
- **Cơ chế tự động**: self-hosted PaaS **Coolify** (git-push auto-deploy, UI quản
  lý env/rollback/log, tự cấp SSL Let's Encrypt).
- **Postgres & Ollama**: dùng **service do Coolify quản lý** (không dùng bản native
  trên host). Người dùng muốn trải nghiệm mô hình all-in-Coolify.
- **App**: đóng gói Docker (Coolify luôn chạy container). Vì Postgres/Ollama nay
  cũng nằm trong mạng Coolify nên app chạy **bridge network bình thường** — KHÔNG
  cần host-network, KHÔNG cần Caddy riêng (Coolify tự lo reverse proxy + SSL).

## Kiến trúc

```
Coolify (1 project)
 ├─ Postgres  (managed service, volume dữ liệu)
 ├─ Ollama    (managed service, volume chứa model)
 └─ app mealio (build từ Dockerfile, bridge network) ──HTTPS tự động──▶ internet
        ├─ tới Postgres qua DATABASE_URL nội bộ (Coolify set khi link)
        └─ tới Ollama  qua http://<tên-service-ollama>:11434 (nhập ở UI Cài đặt AI)
```

Luồng deploy:

```
git push main → Coolify webhook → build Docker image (Next standalone)
             → entrypoint: prisma migrate deploy → node server.js
             → health check → swap container → SSL do Coolify quản
```

## Thay đổi trong repo

| File | Nội dung |
|---|---|
| `next.config.ts` | Thêm `output: "standalone"` để image runtime gọn. |
| `Dockerfile` | Multi-stage: deps → `prisma generate` + `next build` → runtime slim từ standalone. |
| `docker-entrypoint.sh` | Chạy `prisma migrate deploy` rồi `node server.js`. |
| `.dockerignore` | Loại `node_modules`, `.next`, `.git`, `.env*`… khỏi build context. |

Ghi chú kỹ thuật:

- Prisma đã có migrations chuẩn (`prisma/migrations/`) → dùng `migrate deploy`
  (không dùng `db push`).
- `output: "standalone"` sinh `.next/standalone/server.js`; cần copy thêm
  `.next/static` và `public` vào image runtime.
- Prisma engine cần có mặt ở stage runtime (copy `node_modules/.prisma` +
  `@prisma/client`, hoặc `prisma generate` đã đưa vào standalone). Kiểm tra khi
  viết Dockerfile.
- Base image tương thích: Next.js 16 / React 19 cần Node 20+ (dùng `node:20-alpine`
  hoặc `node:22-alpine`; kiểm tra Prisma cần `libc6-compat` trên alpine).

## Biến môi trường (khai báo trong UI Coolify)

| Env | Giá trị | Bắt buộc |
|---|---|---|
| `DATABASE_URL` | Coolify tự set khi **link Postgres** vào app | ✅ |
| `AUTH_SECRET` | `openssl rand -base64 33` | ✅ |
| `AUTH_URL` | domain Coolify cấp cho app (vd `https://mealio.example.com`) | ✅ |
| `AUTH_TRUST_HOST` | `true` (NextAuth v5 sau reverse proxy) | ✅ |
| `ENCRYPTION_KEY` | `openssl rand -hex 32` (đúng 64 ký tự hex) | ✅ |
| `MENU_GEN_CONCURRENCY` | số job sinh menu chạy song song | tùy chọn |
| `MEALIO_OLLAMA_NUM_CTX` | cửa sổ ngữ cảnh Ollama (mặc định 8192) | tùy chọn |
| `MEALIO_OLLAMA_TEMPERATURE` | nhiệt độ Ollama (mặc định 0.7) | tùy chọn |

> **Cấu hình AI không qua env**: provider/model/base URL/API key lưu trong bảng
> `AISettings` (mỗi gia đình), nhập qua **UI Cài đặt AI** của app. Với Ollama
> managed, base URL = `http://<tên-service-ollama>:11434` (tên nội bộ trong mạng
> Coolify của cùng project).

## Các bước cấu hình một lần trên VPS/Coolify

1. **Cài Coolify** (nếu chưa): `curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash`.
2. **Tạo project** trong Coolify, thêm:
   - Service **Postgres** (managed) → ghi nhớ để link.
   - Service **Ollama** (managed, one-click) → có volume model.
3. **Thêm app**: New Resource → kết nối GitHub repo `mealio` → kiểu **Dockerfile**
   → nhánh `main` → bật **auto-deploy on push**.
4. **Link Postgres** vào app để Coolify tự set `DATABASE_URL`; nhập các env còn lại
   ở bảng trên.
5. **Cấp domain** cho app trong Coolify → bật HTTPS (Let's Encrypt tự động). Đặt
   `AUTH_URL` khớp domain này.
6. **Pull model Ollama** một lần: mở terminal của service Ollama trong Coolify →
   `ollama pull <model>` (vd `qwen2.5`). Model lưu trong volume nên còn mãi.
7. **Deploy lần đầu** → migration tự chạy, tạo schema trống. (Tùy chọn seed: chạy
   `yarn db:seed` một lần nếu cần dữ liệu mẫu.)
8. **Cấu hình AI trong app**: đăng nhập → Cài đặt AI → chọn Ollama, base URL
   `http://<tên-service-ollama>:11434`, chọn model đã pull → Test → Lưu.

## Lưu ý vận hành

- **Ollama container khởi đầu trống model** — bước 6 bắt buộc trước khi tạo menu.
- **Ollama chạy CPU** trừ khi VPS có GPU + cấu hình thêm → phản hồi có thể chậm.
  Chấp nhận cho giai đoạn trải nghiệm; có thể chuyển sang Ollama host sau (chỉ đổi
  base URL trong UI Cài đặt AI, không đổi code/deploy).
- **Migration tự động mỗi deploy** qua entrypoint — nếu một migration lỗi, container
  không start, giữ container cũ (an toàn).

## Ngoài phạm vi (YAGNI)

- CI test/lint trước deploy (có thể thêm GitHub Actions sau).
- Ollama GPU, autoscaling, multi-VPS.
- Backup Postgres tự động (Coolify có sẵn tính năng, bật riêng khi cần).
