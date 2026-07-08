# Thêm provider Ollama + hỗ trợ Basic auth

Ngày: 2026-07-08

## Mục tiêu

- Thêm Ollama thành một provider AI riêng ("Ollama - tự host") trong app Mealio, bên cạnh `ANTHROPIC` và `OPENAI_COMPATIBLE`.
- Cho phép request tới endpoint tự host đi kèm **HTTP Basic auth** (`Authorization: Basic base64(user:pass)`), vì Ollama gốc không có xác thực và thường đặt sau reverse proxy chặn bằng Basic auth.

## Bối cảnh

- Kiến trúc AI hiện tại: interface `AIProvider` (`src/lib/ai/types.ts`) với `generateMenu()` + `recognizeMember()`; hai adapter `AnthropicProvider` và `OpenAICompatibleProvider`; factory `getAIProvider()` (`src/lib/ai/index.ts`) đọc `AISettings`, giải mã key và trả provider.
- BYOK: mỗi gia đình nhập cấu hình riêng, `apiKeyEncrypted` mã hoá AES-256-GCM (`src/lib/crypto.ts`), chỉ giải mã ở server.
- Ollama nói được API **OpenAI-compatible ở `/v1`**, nên adapter Ollama có thể tái dùng logic của `OpenAICompatibleProvider`.

## Quyết định thiết kế (đã chốt với người dùng)

1. Ollama là **provider riêng** (enum `OLLAMA`), không chỉ là preset của OpenAI-compatible — UX rõ ràng cho người dùng cuối.
2. Ô Basic auth dùng cho **cả Ollama và OpenAI-compatible** (hai loại endpoint tự host). Anthropic không có.

## Thay đổi chi tiết

### 1. Data model (Prisma — `prisma/schema.prisma`)

- Thêm giá trị `OLLAMA` vào `enum AIProvider`.
- Thêm cột `basicAuthEncrypted String?` vào model `AISettings` — lưu chuỗi `"user:pass"` đã mã hoá AES-256-GCM, cùng cơ chế với `apiKeyEncrypted`.
- Tạo một migration mới và áp lên Postgres remote (host thật trong `.env`).

### 2. Adapter AI (`src/lib/ai/`)

- Thêm `src/lib/ai/ollama.ts` — `OllamaProvider`, tái dùng logic của `OpenAICompatibleProvider`.
  - baseURL mặc định `http://localhost:11434/v1` khi người dùng để trống.
  - Không bắt buộc API key (Ollama không cần) — dùng key giả `"ollama"` để thoả mãn OpenAI SDK.
- **Xử lý Basic auth:** khi có cặp `user:pass`, build header `Authorization: Basic base64(user:pass)` và truyền qua `defaultHeaders` của OpenAI SDK; header này phải **thay** (không thêm) header `Bearer` mặc định, vì HTTP chỉ cho một header `Authorization`.
  - Kiểm tra thứ tự ưu tiên header trong `node_modules/openai` lúc code để chắc chắn `defaultHeaders` override được auth header; nếu không, dùng custom `fetch` để ép header.
- Tách phần dựng client + header (baseURL, apiKey, basic auth) ra một helper dùng chung cho `OpenAICompatibleProvider` và `OllamaProvider`, tránh lặp code.
- Basic auth áp dụng cho cả hai adapter tự host.

### 3. Factory (`src/lib/ai/index.ts`)

- Giải mã thêm `basicAuthEncrypted` (nếu có) → tách thành `{ user, pass }`.
- `provider === "OLLAMA"` → `OllamaProvider`; truyền basic auth vào cả `OllamaProvider` và `OpenAICompatibleProvider`.
- Với Ollama, không ném lỗi "chưa cấu hình" chỉ vì thiếu `apiKeyEncrypted` (Ollama có thể chạy không cần auth).

### 4. Server action (`src/lib/actions/settings.ts`)

- Zod schema: thêm `"OLLAMA"` vào enum `provider`; thêm field optional `basicAuthUser`, `basicAuthPass`.
- Với `OLLAMA`: bỏ ràng buộc "lần đầu cấu hình cần nhập API key".
- Lưu `basicAuthEncrypted = encrypt(user + ":" + pass)` nếu người dùng nhập; để trống thì giữ nguyên giá trị cũ (giống pattern apiKey). Nếu người dùng chủ động xoá thì hỗ trợ cờ để clear (cân nhắc lúc implement; mặc định giữ nguyên).

### 5. UI + hằng số

- `src/lib/enums.ts`: thêm mục `OLLAMA` vào `AI_PROVIDERS` với nhãn "Ollama (tự host)".
- `src/lib/ai-models.ts`: thêm danh sách gợi ý model Ollama (vd `llama3.1`, `qwen2.5`, `llava`, `llama3.2-vision`).
- `src/app/(app)/settings/ai/SettingsForm.tsx`:
  - Thẻ provider thứ 3 "Ollama (tự host)".
  - Tab Ollama: ô Base URL (placeholder/mặc định `http://localhost:11434/v1`), ô Model (datalist gợi ý), API key ẩn/optional.
  - Khối "Basic auth (tuỳ chọn)" gồm 2 ô username + password, hiển thị cho **Ollama và OpenAI-compatible**, kèm ghi chú dùng khi endpoint sau reverse proxy.
  - Ghi chú: nhận dạng ảnh cần model Ollama có thị giác (vd `llava`, `llama3.2-vision`).
- `page.tsx` (`settings/ai`): truyền thêm cờ `hasBasicAuth` (không lộ giá trị) xuống form giống `hasKey`.

## Kiểm thử / xác minh

- `next build` phải pass.
- Kiểm tra thủ công: chọn Ollama, lưu cấu hình (không key), tạo thực đơn → gọi được endpoint local.
- Với Basic auth: bật user/pass, xác nhận header `Authorization: Basic …` được gửi (log/kiểm tra ở adapter hoặc endpoint test).

## Ngoài phạm vi (YAGNI)

- Nút "Test kết nối" trong UI.
- Basic auth cho Anthropic.
- Hỗ trợ hai header auth đồng thời (Basic cho proxy + Bearer cho upstream) — trường hợp hiếm.
