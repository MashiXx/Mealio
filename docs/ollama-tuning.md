# Tinh chỉnh Ollama cho Mealio

Mealio dùng **API native của Ollama** (`/api/chat`, `/api/tags`) cho provider
Ollama — không dùng lớp OpenAI `/v1`. Lý do: chỉ API native mới cho phép app đặt
`num_ctx` (cửa sổ ngữ cảnh) mỗi request, nhờ đó prompt (hồ sơ gia đình + kho thực
phẩm + đoạn "Món Việt tham khảo") **không bị cắt ngầm** khi vượt context mặc định
của model.

## Biến môi trường (đặt trước khi chạy `next start`/`next dev`)

| Biến | Mặc định | Ý nghĩa |
|------|----------|---------|
| `MEALIO_OLLAMA_NUM_CTX` | `8192` | Cửa sổ ngữ cảnh mỗi request. Tăng nếu prompt dài (nhiều thành viên/kho lớn); giảm nếu thiếu VRAM. |
| `MEALIO_OLLAMA_TEMPERATURE` | `0.7` | Độ ngẫu nhiên. Hạ ~0.4–0.5 cho ổn định; tăng cho đa dạng. |

Ví dụ (`.env`):

```
MEALIO_OLLAMA_NUM_CTX=8192
MEALIO_OLLAMA_TEMPERATURE=0.6
```

> `num_ctx` càng lớn càng tốn VRAM. 8192 đủ cho thực đơn thường ngày. Với gia đình
> đông người + kho lớn, cân nhắc 12288–16384 nếu model & GPU cho phép.

## Reverse proxy

Nếu Ollama nằm sau reverse proxy, proxy phải cho tới **cả `/api/*`** (không chỉ
`/v1`). Nút **Test kết nối** ở trang Cài đặt AI gọi `/api/tags` — nếu báo lỗi,
kiểm tra proxy đã mở `/api/*` chưa. Basic auth vẫn được gửi qua header
`Authorization`.

Nếu proxy của bạn CHỈ mở `/v1` và không đổi được, hãy đặt context ở phía server
Ollama thay cho app: khởi động Ollama với `OLLAMA_CONTEXT_LENGTH=8192` (áp dụng
cho mọi request), hoặc tạo model có `PARAMETER num_ctx 8192` trong Modelfile.

## Về "few-shot" kho món

Kho 69 món được lọc theo dị ứng/kiêng khem + vùng khẩu vị của gia đình, rồi chèn
vào prompt dưới mục "Món Việt tham khảo" + "Mâm cơm mẫu". Đây là ngữ cảnh tại mỗi
request — **không phải fine-tune**, nên áp dụng cho mọi model Ollama ngay lập tức.
System prompt đã yêu cầu model ưu tiên chọn/biến tấu từ danh sách này.
