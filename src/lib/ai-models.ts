// Danh sách model gợi ý cho UI Cài đặt AI. Tất cả model Claude dưới đây đều
// hỗ trợ vision (đọc ảnh) nên dùng được cho tính năng nhận dạng ảnh thành viên.
// Model ID lấy theo tài liệu Anthropic hiện hành.

export type ModelOption = {
  id: string;
  label: string;
  hint: string;
};

export const ANTHROPIC_MODELS: ModelOption[] = [
  {
    id: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    hint: "Mạnh nhất, đa năng — khuyến nghị",
  },
  {
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    hint: "Cân bằng tốc độ & chi phí",
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    hint: "Nhanh và tiết kiệm nhất",
  },
  {
    id: "claude-fable-5",
    label: "Claude Fable 5",
    hint: "Cao cấp nhất, cho tác vụ khó (đắt)",
  },
];

// Endpoint OpenAI-compatible rất đa dạng (OpenAI, tự host, Ollama…) nên chỉ gợi ý.
export const OPENAI_MODEL_SUGGESTIONS = [
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4.1",
  "gpt-4.1-mini",
];

export const CUSTOM_MODEL = "__custom__";

// Model Ollama phổ biến. llava / llama3.2-vision có thị giác (cho nhận dạng ảnh).
export const OLLAMA_MODEL_SUGGESTIONS = [
  "llama3.1",
  "llama3.2",
  "qwen2.5",
  "qwen3-coder:30b",
  "mistral",
  "llava",
  "llama3.2-vision",
];
