import OpenAI from "openai";

// Basic auth cho endpoint tự host nằm sau reverse proxy (Ollama, OpenAI-compatible…).
export type BasicAuth = { user: string; pass: string };

/** Header "Basic base64(user:pass)". */
export function basicAuthHeader(auth: BasicAuth): string {
  const token = Buffer.from(`${auth.user}:${auth.pass}`).toString("base64");
  return `Basic ${token}`;
}

/** Tách chuỗi "user:pass" đã giải mã. Split ở dấu ':' đầu tiên (pass có thể chứa ':'). */
export function parseBasicAuth(raw: string): BasicAuth {
  const idx = raw.indexOf(":");
  if (idx === -1) return { user: raw, pass: "" };
  return { user: raw.slice(0, idx), pass: raw.slice(idx + 1) };
}

export type OpenAIClientOpts = {
  apiKey?: string;
  baseUrl?: string;
  basicAuth?: BasicAuth;
};

/**
 * Dựng OpenAI client dùng chung cho OpenAI-compatible & Ollama.
 * Khi có basicAuth: gửi Authorization: Basic ... qua defaultHeaders — SDK áp
 * defaultHeaders SAU authHeaders (openai/client.js) nên header này THAY cho
 * Bearer mặc định. HTTP chỉ cho một header Authorization.
 * apiKey rỗng vẫn truyền giá trị giả để SDK không ném lỗi khởi tạo.
 *
 * CẢNH BÁO: việc override Bearer dựa vào thứ tự merge header nội bộ của SDK
 * (không có trong tài liệu công khai). Đã xác minh đúng ở openai@6.45.0 — vì
 * vậy version bị PIN chính xác trong package.json. Khi nâng cấp `openai`, chạy
 * lại smoke test Basic auth (request qua reverse proxy phải trả 200, không 401).
 */
export function buildOpenAIClient(opts: OpenAIClientOpts): OpenAI {
  return new OpenAI({
    apiKey: opts.apiKey && opts.apiKey.length > 0 ? opts.apiKey : "unused",
    ...(opts.baseUrl ? { baseURL: opts.baseUrl } : {}),
    ...(opts.basicAuth
      ? { defaultHeaders: { Authorization: basicAuthHeader(opts.basicAuth) } }
      : {}),
  });
}
