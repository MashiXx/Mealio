// Ngưỡng thời gian cho MỘT lời gọi AI, và các ngưỡng suy ra từ nó.
//
// Vì sao gom một chỗ: ngưỡng "job treo" ở jobs.ts và timeout HTTP ở adapter PHẢI
// ăn khớp. Nếu timeout HTTP dài hơn ngưỡng treo thì reaper giết job trước khi
// lời gọi kịp hỏng — job đang chạy đàng hoàng vẫn bị đánh FAILED, đúng cái lỗi
// đã làm hỏng việc sinh thực đơn nhiều ngày. Suy ra từ một hằng số thay vì đặt
// hai con số rời khiến chúng không thể trôi lệch, kể cả khi ai đó chỉnh env.

const DEFAULT_AI_TIMEOUT_MS = 8 * 60 * 1000; // 8 phút

/**
 * Thời gian tối đa cho một lời gọi AI. Chỉnh qua `MEALIO_AI_TIMEOUT_MS` (ms).
 *
 * Mặc định rộng tay vì Ollama tự host trên CPU mất hàng phút mỗi vòng; ở đây thà
 * chờ lâu còn hơn cắt ngang một lời gọi sắp xong.
 */
export function aiTimeoutMs(): number {
  const n = parseInt(process.env.MEALIO_AI_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_AI_TIMEOUT_MS;
}

/**
 * Ngưỡng coi một job RUNNING là đã treo.
 *
 * Phải phủ trọn job DÀI NHẤT: đường một ngày ở chế độ "đồ có sẵn" gọi AI tối đa
 * HAI lần (sinh + sinh lại khi vi phạm kho). Cộng thêm ít phút cho phần ghi DB.
 */
export function staleJobMs(): number {
  return aiTimeoutMs() * 2 + 2 * 60 * 1000;
}

/**
 * AbortSignal tự huỷ sau `aiTimeoutMs()`. Trả kèm `clear` để dọn timer khi lời
 * gọi xong sớm — thiếu bước này thì tiến trình giữ timer sống tới hết ngưỡng.
 */
export function aiAbortSignal(): { signal: AbortSignal; clear: () => void } {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), aiTimeoutMs());
  return { signal: ac.signal, clear: () => clearTimeout(id) };
}

/** Câu lỗi thống nhất khi một lời gọi AI quá hạn. */
export function aiTimeoutError(): Error {
  const minutes = Math.round(aiTimeoutMs() / 60000);
  return new Error(
    `AI không phản hồi sau ${minutes} phút. Model có thể quá chậm hoặc endpoint đang treo — thử model nhẹ hơn, hoặc tăng MEALIO_AI_TIMEOUT_MS.`,
  );
}
