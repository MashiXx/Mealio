import type { MenuContext } from "./types";

// Dựng prompt cho AI từ hồ sơ gia đình + kho thực phẩm + lịch sử.
// Trả về { system, user } dùng chung cho cả Anthropic và OpenAI-compatible.

// Prompt cho việc nhận dạng thành viên từ ảnh. AI chỉ ước lượng nhóm tuổi
// (đáng tin nhất) và đưa gợi ý ăn uống mềm theo độ tuổi; KHÔNG bịa tên/dị ứng.
export function buildRecognitionPrompt(): { system: string; user: string } {
  const system = [
    "Bạn là trợ lý dinh dưỡng. Bạn nhận một ảnh chân dung và ước lượng NHÓM TUỔI của người trong ảnh để hỗ trợ lên thực đơn.",
    "QUY TẮC:",
    "- Chỉ ước lượng nhóm tuổi dựa trên diện mạo. Không suy đoán tên, dị ứng, bệnh lý.",
    "- suggestedLikes: vài món/nhóm thực phẩm PHÙ HỢP theo độ tuổi (gợi ý tham khảo, tiếng Việt).",
    "- notes: một câu ngắn gợi ý lưu ý ăn uống theo độ tuổi (vd: trẻ nhỏ nên món mềm, ít gia vị).",
    "- Nếu ảnh không rõ người, chọn nhóm tuổi ADULT và để suggestedLikes rỗng.",
    "CHỈ trả về JSON, KHÔNG giải thích, KHÔNG markdown.",
    'Cấu trúc: {"ageGroup":"BABY|CHILD|TEEN|ADULT|SENIOR","suggestedLikes":["string"],"notes":"string"}',
    "Ý nghĩa nhóm tuổi: BABY (<2), CHILD (2-12), TEEN (13-17), ADULT (18-59), SENIOR (60+).",
  ].join("\n");

  const user =
    "Hãy xác định nhóm tuổi của người trong ảnh và trả về JSON theo đúng cấu trúc.";

  return { system, user };
}

const REGION_LABEL: Record<string, string> = {
  MIEN_BAC: "miền Bắc",
  MIEN_TRUNG: "miền Trung",
  MIEN_NAM: "miền Nam",
  KHONG_CO_KHAU_VI: "không cố định (linh hoạt)",
};

const SPICE_LABEL: Record<string, string> = {
  NONE: "không cay",
  MILD: "cay nhẹ",
  MEDIUM: "cay vừa",
  HOT: "cay nhiều",
};

const BUDGET_LABEL: Record<string, string> = {
  LOW: "tiết kiệm",
  MEDIUM: "trung bình",
  HIGH: "thoải mái",
};

const MEALTYPE_LABEL: Record<string, string> = {
  BREAKFAST: "bữa sáng",
  LUNCH: "bữa trưa",
  DINNER: "bữa tối",
};

export function buildMenuPrompt(ctx: MenuContext): {
  system: string;
  user: string;
} {
  const system = [
    "Bạn là trợ lý ẩm thực gia đình người Việt, chuyên lên thực đơn cân bằng và lành mạnh.",
    "Nhiệm vụ: đề xuất món ăn cho từng bữa được yêu cầu, kèm công thức ngắn gọn.",
    "QUY TẮC BẮT BUỘC:",
    "- TUYỆT ĐỐI không dùng nguyên liệu gây dị ứng của bất kỳ thành viên nào.",
    "- Tôn trọng các kiêng khem (ăn chay, không thịt bò, v.v.).",
    "- Ưu tiên món/nguyên liệu hợp khẩu vị, tránh món bị ghét.",
    "- Ưu tiên tận dụng thực phẩm đang có trong kho để giảm lãng phí.",
    "- Không lặp lại các món đã ăn gần đây.",
    "- Đảm bảo cân bằng dinh dưỡng (đủ đạm, rau, tinh bột) và gắn nhãn định tính phù hợp.",
    "- Nếu phần dưới có 'Món Việt tham khảo', hãy ƯU TIÊN chọn hoặc biến tấu từ danh sách đó để món quen thuộc, đúng ẩm thực Việt (vẫn phải tránh dị ứng/kiêng khem và không lặp món gần đây).",
    "- Món ăn và công thức viết bằng tiếng Việt.",
    "CHỈ trả về JSON đúng cấu trúc, KHÔNG kèm giải thích, KHÔNG markdown.",
    "Cấu trúc JSON:",
    `{"meals":[{"date":"yyyy-mm-dd","mealType":"BREAKFAST|LUNCH|DINNER","recipe":{"name":"string","servings":number,"cookMinutes":number,"steps":["string"],"nutritionLabels":["string"],"ingredients":[{"name":"string","quantity":number,"unit":"string"}]}}]}`,
    'Ví dụ nhãn dinh dưỡng: "nhiều rau", "ít dầu mỡ", "thanh đạm", "giàu đạm", "ít tinh bột".',
  ].join("\n");

  const p = ctx.profile;
  const membersText =
    ctx.members
      .map((m, i) => {
        const parts = [`  ${i + 1}. ${m.name} (${m.ageGroup})`];
        if (m.allergies.length) parts.push(`dị ứng: ${m.allergies.join(", ")}`);
        if (m.dietaryRestrictions.length)
          parts.push(`kiêng: ${m.dietaryRestrictions.join(", ")}`);
        if (m.likes.length) parts.push(`thích: ${m.likes.join(", ")}`);
        if (m.dislikes.length) parts.push(`ghét: ${m.dislikes.join(", ")}`);
        return parts.join(" — ");
      })
      .join("\n") || "  (chưa có thông tin thành viên)";

  const pantryText =
    ctx.pantry.map((x) => `  - ${x.name}: ${x.quantity} ${x.unit}`).join("\n") ||
    "  (kho trống)";

  const slotsText = ctx.slots
    .map((s) => `  - ${s.date}: ${MEALTYPE_LABEL[s.mealType] ?? s.mealType}`)
    .join("\n");

  const user = [
    `Số người trong gia đình: ${ctx.familySize}`,
    "",
    "Thành viên & sở thích:",
    membersText,
    "",
    "Hồ sơ ăn uống:",
    `  - Khẩu vị vùng: ${REGION_LABEL[p.cuisineRegion] ?? p.cuisineRegion}`,
    `  - Độ cay: ${SPICE_LABEL[p.spiceLevel] ?? p.spiceLevel}`,
    `  - Ngân sách: ${BUDGET_LABEL[p.budgetLevel] ?? p.budgetLevel}`,
    `  - Thời gian nấu tối đa mỗi món: ${p.maxCookMinutes} phút`,
    `  - Mục tiêu healthy: ${p.healthGoals.length ? p.healthGoals.join(", ") : "cân bằng chung"}`,
    p.notes ? `  - Ghi chú: ${p.notes}` : "",
    "",
    "Thực phẩm đang có trong kho:",
    pantryText,
    "",
    "Món đã ăn gần đây (TRÁNH lặp lại):",
    ctx.recentRecipeNames.length
      ? ctx.recentRecipeNames.map((n) => `  - ${n}`).join("\n")
      : "  (chưa có)",
    "",
    "Công thức đã có trong kho gia đình (có thể tái sử dụng nếu phù hợp):",
    ctx.availableRecipeNames.length
      ? ctx.availableRecipeNames.map((n) => `  - ${n}`).join("\n")
      : "  (chưa có)",
    "",
    "Hãy lên thực đơn cho ĐÚNG các bữa sau (mỗi bữa một món chính phù hợp):",
    slotsText,
    "",
    catalogReferenceText(ctx),
    "Trả về JSON theo đúng cấu trúc đã nêu, mỗi phần tử meals ứng với một bữa ở trên.",
  ]
    .filter((l) => l !== "")
    .join("\n");

  return { system, user };
}

/**
 * Đoạn "Món tham khảo" chèn vào prompt: gợi ý các món Việt quen thuộc (đã lọc
 * theo dị ứng/kiêng của gia đình) + vài mâm mẫu, để AI bám sát ẩm thực thật.
 * Trả về "" nếu không có tham chiếu.
 */
function catalogReferenceText(ctx: MenuContext): string {
  const ref = ctx.catalogReference;
  if (!ref || (ref.dishNames.length === 0 && ref.setMenus.length === 0)) {
    return "";
  }
  const lines: string[] = [
    "Món Việt tham khảo (gợi ý phong cách, KHÔNG bắt buộc chọn nguyên văn; có thể",
    "biến tấu cho hợp khẩu vị/kho thực phẩm; các món này đã hợp dị ứng & kiêng khem):",
  ];
  if (ref.dishNames.length) {
    lines.push("  - " + ref.dishNames.join(", "));
  }
  if (ref.setMenus.length) {
    lines.push("Mâm cơm mẫu tham khảo:");
    for (const m of ref.setMenus) {
      lines.push(`  - ${m.name}: ${m.dishNames.join(", ")}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
