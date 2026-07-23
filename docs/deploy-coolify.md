# Deploy Mealio lên Coolify

Mô hình: Coolify quản cả **Postgres + Ollama + app** (app chạy bridge network,
Coolify tự cấp reverse proxy + SSL). Mỗi `git push main` → Coolify tự build image
từ `Dockerfile`, chạy `prisma migrate deploy` (trong entrypoint) rồi khởi động.

Tham chiếu thiết kế: `docs/superpowers/specs/2026-07-23-auto-deploy-coolify-design.md`

> ⚠️ Build Docker CHƯA được verify cục bộ (bỏ theo yêu cầu — build ở máy dev quá
> lâu). Lần deploy đầu trên Coolify là lần build thật đầu tiên. Điểm dễ gãy nhất là
> các dòng `COPY` phần Prisma trong `Dockerfile`; nếu build lỗi ở đó, xem mục
> **Xử lý sự cố** cuối file.

## 1. Cài Coolify (nếu chưa)

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

Mở dashboard, tạo một **Project** mới cho Mealio.

## 2. Tạo service Postgres (managed)

- New Resource → Databases → **PostgreSQL** → tạo trong cùng project.
- Ghi nhớ để **link** vào app ở bước 4 (Coolify sẽ tự sinh `DATABASE_URL`).

## 3. Tạo service Ollama (managed)

- New Resource → Services → **Ollama** (one-click) → cùng project.
- Ghi lại **tên service nội bộ** (dùng làm host) và cổng `11434`.
- Sau khi service chạy, mở terminal của nó và pull model:

  ```bash
  ollama pull qwen2.5
  ```

  Model lưu trong volume nên chỉ cần pull một lần.

## 4. Thêm app Mealio

- New Resource → chọn Git repo `mealio` → Build Pack: **Dockerfile** → nhánh `main`.
- Bật **Auto Deploy** (deploy mỗi khi push `main`).
- **Link** Postgres (bước 2) vào app → Coolify set `DATABASE_URL`.
- Thêm các biến môi trường còn lại:

  | Env | Giá trị | Ghi chú |
  |---|---|---|
  | `AUTH_SECRET` | `openssl rand -base64 33` | bắt buộc |
  | `AUTH_URL` | domain app (bước 5) | bắt buộc |
  | `AUTH_TRUST_HOST` | `true` | NextAuth v5 sau proxy |
  | `ENCRYPTION_KEY` | `openssl rand -hex 32` | đúng 64 ký tự hex |
  | `MENU_GEN_CONCURRENCY` | số job song song | tùy chọn |
  | `MEALIO_OLLAMA_NUM_CTX` | mặc định 8192 | tùy chọn |
  | `MEALIO_OLLAMA_TEMPERATURE` | mặc định 0.7 | tùy chọn |

## 5. Domain + HTTPS

- Đặt domain cho app trong Coolify → bật SSL (Let's Encrypt tự động).
- Cập nhật `AUTH_URL` khớp domain (vd `https://mealio.example.com`) → redeploy.

## 6. Deploy lần đầu

- Bấm Deploy → entrypoint tự chạy `prisma migrate deploy` (tạo schema từ đầu).
- (Tùy chọn) seed dữ liệu mẫu: mở terminal container app → `yarn db:seed`.

## 7. Cấu hình AI trong app

Cấu hình AI **không** qua env — lưu trong DB, nhập qua UI:

- Đăng nhập app → **Cài đặt AI**.
- Provider: **Ollama**; Base URL: `http://<tên-service-ollama>:11434`.
- Chọn model đã pull (bước 3) → **Test** → **Lưu**.

## 8. Kiểm tra auto-deploy

- Sửa vặt ở repo → `git push` nhánh `main`.
- Coolify nhận webhook → build + migrate + swap container tự động.

## Ghi chú vận hành

- **Ollama managed chạy CPU** (trừ khi VPS có GPU + cấu hình thêm) → phản hồi AI có
  thể chậm. Muốn dùng Ollama native trên host thay thế: chỉ đổi Base URL ở Cài đặt
  AI, **không** đổi code/deploy.
- **Migration lỗi** → entrypoint dừng (`set -e`), container không start, Coolify giữ
  container cũ → an toàn, không sập bản đang chạy.

## Xử lý sự cố (build lần đầu)

- **`COPY ... @prisma/engines` (hoặc `.prisma`) lỗi "not found"**: layout Prisma đổi
  giữa các bản. Vào builder stage kiểm tra đường dẫn thật:
  `docker run --rm <builder-image> ls node_modules/@prisma`, rồi sửa dòng `COPY`
  tương ứng trong `Dockerfile` sao cho `./node_modules/.bin/prisma` chạy được và
  `@prisma/client` có engine query ở runtime.
- **`prisma migrate deploy` báo không kết nối được DB**: kiểm tra app đã **link**
  Postgres chưa (bước 4) và `DATABASE_URL` đã được Coolify set.
- **App start nhưng tạo menu lỗi gọi AI**: kiểm tra Base URL Ollama ở Cài đặt AI
  và model đã pull (bước 3, 7).
