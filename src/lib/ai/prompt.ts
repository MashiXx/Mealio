import type {
  MenuContext,
  EditContext,
  MealPrepContext,
  CatalogReference,
} from "./types";
import { DISH_ROLE_LABEL } from "../enums";
import { MAIN_PROTEINS } from "./schema";
import { SEASONINGS_VI } from "@/data/seasonings";

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

/** Khối "Thành viên & sở thích" — dùng chung cho prompt sinh mâm và prompt khung. */
function membersBlock(members: MenuContext["members"]): string {
  return (
    members
      .map((m, i) => {
        const parts = [`  ${i + 1}. ${m.name} (${m.ageGroup})`];
        if (m.allergies.length) parts.push(`dị ứng: ${m.allergies.join(", ")}`);
        if (m.dietaryRestrictions.length)
          parts.push(`kiêng: ${m.dietaryRestrictions.join(", ")}`);
        if (m.likes.length) parts.push(`thích: ${m.likes.join(", ")}`);
        if (m.dislikes.length) parts.push(`ghét: ${m.dislikes.join(", ")}`);
        return parts.join(" — ");
      })
      .join("\n") || "  (chưa có thông tin thành viên)"
  );
}

/**
 * Luật healthy cho phần SYSTEM — chốt cứng theo nhu cầu người dùng, không có
 * knob cấu hình.
 *
 * Cố ý KHÔNG có bộ verify đi kèm: "hạn chế chiên rán" là mức độ chứ không phải
 * luật nhị phân, mà bắt theo từ khoá tên món sẽ đánh oan "chả rán" hay "bò né áp
 * chảo" rồi đốt một vòng sinh lại cho thứ không sai hẳn — cùng lập luận đã dùng
 * để tha vai trò DO_CHUA khỏi R3.
 */
/**
 * Luật cho trường prepAheadNote. Tách riêng vì hai prompt CÓ công thức
 * (sinh mâm, sửa mâm) đều cần, còn prompt khung nhiều ngày thì không — khung chỉ
 * có tên món, chưa tới lúc bàn chuyện sơ chế.
 */
const PREP_AHEAD_RULE =
  "- prepAheadNote: MỘT câu ngắn nói việc có thể làm trước để tối về nấu nhanh (vd \"chiều ướp sẵn thịt, tối chỉ việc kho\"). Món không có gì làm trước được thì để chuỗi rỗng, ĐỪNG bịa.";

const HEALTHY_RULES = [
  "QUY TẮC HEALTHY (bắt buộc):",
  "- Ưu tiên các cách chế biến: HẤP, LUỘC, ÁP CHẢO, KHO ÍT DẦU, NƯỚNG.",
  "- HẠN CHẾ: món chiên/rán ngập dầu, thực phẩm chế biến sẵn, quá nhiều tinh bột, quá nhiều dầu mỡ.",
  "- Món tráng miệng ưu tiên TRÁI CÂY tươi theo mùa, không phải đồ ngọt nhiều đường.",
];

/**
 * Lưu ý theo nhóm tuổi có mặt trong nhà. `ageGroup` vốn đã vào prompt ở phần
 * thành viên, nhưng chỉ như một nhãn — không kéo theo luật nào, nên "nhà có ông
 * bà" và "nhà toàn người lớn" ra thực đơn y hệt nhau.
 *
 * Trả "" khi không có nhóm nào đáng lưu ý, để .filter ở nơi gọi tự loại dòng.
 */
export function ageNotesBlock(members: MenuContext["members"]): string {
  const groups = new Set(members.map((m) => m.ageGroup));
  const notes: string[] = [];
  if (groups.has("SENIOR")) {
    notes.push(
      "- Nhà có NGƯỜI CAO TUỔI: ưu tiên món mềm, dễ nhai, ninh/hấp cho nhừ; giảm muối, giảm dầu mỡ.",
    );
  }
  if (groups.has("CHILD") || groups.has("TEEN")) {
    notes.push(
      "- Nhà có TRẺ ĐANG LỚN: bảo đảm đủ đạm và canxi, món dễ ăn, không quá cay.",
    );
  }
  if (groups.has("BABY")) {
    notes.push("- Nhà có EM BÉ: cần món mềm, nhạt, cắt nhỏ được.");
  }
  if (notes.length === 0) return "";
  return ["Lưu ý theo độ tuổi trong nhà (BẮT BUỘC tính đến):", ...notes].join(
    "\n",
  );
}

/**
 * Câu luật cho phần SYSTEM về ý muốn riêng của người dùng.
 *
 * Bắt buộc đi kèm mỗi khi prompt có userNote: người dùng gõ "nay thèm tôm" mà
 * nhà có người dị ứng hải sản thì tôm VẪN phải bị loại. Đặt ở system (nơi chứa
 * luật an toàn) chứ không ở user (nơi chứa ý muốn) để thứ tự ưu tiên rõ ràng.
 */
const USER_NOTE_RULE =
  "- Ý muốn riêng của người dùng cho lần này chỉ được điều chỉnh TRONG PHẠM VI các luật an toàn ở trên. Nếu nó mâu thuẫn với dị ứng hoặc kiêng khem, LUẬT AN TOÀN THẮNG.";

/** Khối ý muốn riêng cho phần USER. Trả "" khi không có gợi ý. */
function userNoteBlock(note: string | null | undefined): string {
  if (!note) return "";
  return [
    "Ý muốn riêng của người dùng CHO LẦN NÀY (ưu tiên cao, nhưng không được phá luật dị ứng/kiêng khem):",
    `  ${note}`,
  ].join("\n");
}

/** Bảng slot "ngày · bữa: N món — vai trò" dùng chung cho hai prompt. */
function slotsBlock(slots: MenuContext["slots"]): string {
  return slots
    .map((s) => {
      const roles = s.dishRoles.map((r) => DISH_ROLE_LABEL[r] ?? r).join(", ");
      return `  - ${s.date} · ${MEALTYPE_LABEL[s.mealType] ?? s.mealType}: ${s.dishRoles.length} món — ${roles}`;
    })
    .join("\n");
}

export function buildMenuPrompt(ctx: MenuContext): {
  system: string;
  user: string;
} {
  const system = [
    "Bạn vừa là CHUYÊN GIA DINH DƯỠNG, vừa là ĐẦU BẾP gia đình người Việt giàu kinh nghiệm.",
    "Nhiệm vụ: lên MÂM CƠM cho từng bữa được yêu cầu, mỗi mâm gồm nhiều món theo đúng cơ cấu chỉ định, kèm công thức ngắn gọn.",
    "QUY TẮC BẮT BUỘC (an toàn):",
    "- TUYỆT ĐỐI không dùng nguyên liệu gây dị ứng của bất kỳ thành viên nào.",
    "- Tôn trọng các kiêng khem (ăn chay, không thịt bò, v.v.).",
    "- Ưu tiên món/nguyên liệu hợp khẩu vị, tránh món bị ghét.",
    "- Không lặp lại các món đã ăn gần đây.",
    ...(ctx.userNote ? [USER_NOTE_RULE] : []),
    ...HEALTHY_RULES,
    "QUY TẮC CÂN BẰNG CẢ MÂM (chuyên môn):",
    "- Mỗi mâm phải cân đối nhóm chất: đủ đạm (món mặn), rau xanh (xào/luộc/canh), tinh bột (cơm trắng ngầm định, KHÔNG cần liệt kê).",
    "- Đa dạng phương pháp chế biến trong một mâm — KHÔNG hai món cùng kiểu (tránh 2 món chiên/rán).",
    "- Tránh trùng nguyên liệu chính giữa các món trong mâm (đừng để cả mâm đều thịt heo).",
    "- Món canh phải 'đưa cơm', hài hoà với món mặn.",
    "- Ưu tiên nguyên liệu theo mùa và tận dụng thực phẩm đang có trong kho.",
    "- Gắn nhãn dinh dưỡng phù hợp cho TỪNG món.",
    "- Nếu có 'Món Việt tham khảo', ưu tiên chọn/biến tấu từ đó cho quen thuộc, đúng ẩm thực Việt.",
    "- Mỗi bữa phải trả ĐÚNG SỐ MÓN và ĐÚNG VAI TRÒ được yêu cầu bên dưới.",
    "- Tên món và công thức viết bằng tiếng Việt.",
    PREP_AHEAD_RULE,
    "CHỈ trả về JSON đúng cấu trúc, KHÔNG kèm giải thích, KHÔNG markdown.",
    "Cấu trúc JSON:",
    `{"meals":[{"date":"yyyy-mm-dd","mealType":"BREAKFAST|LUNCH|DINNER","dishes":[{"name":"string","dishRole":"MON_MAN|MON_XAO|CANH_SUP|RAU_LUOC|LAU|COM_BUN_PHO|MON_CUON|TRANG_MIENG|DO_CHUA","servings":number,"cookMinutes":number,"steps":["string"],"nutritionLabels":["string"],"prepAheadNote":"string","ingredients":[{"name":"string","quantity":number,"unit":"string"}]}]}]}`,
    'Ví dụ nhãn dinh dưỡng: "nhiều rau", "ít dầu mỡ", "thanh đạm", "giàu đạm", "ít tinh bột".',
  ].join("\n");

  const p = ctx.profile;
  const membersText = membersBlock(ctx.members);

  // Kho vào prompt theo hai giọng khác hẳn nhau: AVAILABLE_ONLY biến kho thành
  // DANH SÁCH TRẮNG (luật cứng), FLEXIBLE chỉ nêu kho như gợi ý ưu tiên.
  const availableOnly = ctx.pantryMode === "AVAILABLE_ONLY";

  const pantryNames = ctx.pantry.map(
    (x) => `  - ${x.name}${x.expiringSoon ? "  ⚠ nên dùng sớm" : ""}`,
  );

  const pantryBlock = availableOnly
    ? [
        "NGUYÊN LIỆU ĐƯỢC PHÉP DÙNG — nhà chỉ có bấy nhiêu:",
        pantryNames.join("\n") || "  (kho trống)",
        // In cả 36 mục có dấu từ nguồn chân lý chung với isSeasoning, thay vì
        // liệt kê tay 7 thứ: bản cũ vô tình cấm gừng/sả/hành lá/chanh/ớt nên
        // gần như không còn món canh hay món kho Việt nào hợp lệ.
        `Gia vị luôn có, dùng thoải mái: ${SEASONINGS_VI.join(", ")}.`,
        "",
        "LUẬT CỨNG: KHÔNG dùng bất kỳ nguyên liệu nào ngoài hai danh sách trên.",
        "Nghĩ món Việt quen thuộc từ đúng những thứ này.",
        // Đặt SAU phần system bắt "đúng số món & vai trò" và nói thẳng là thắng
        // luật đó: không có lối thoát này, một slot "Rau luộc" trong khi kho
        // không còn cọng rau nào sẽ dồn model vào thế buộc phải bịa nguyên liệu.
        // Đặc tả 4.4 vốn đã chấp nhận mâm thiếu món và có sẵn cảnh báo ở bảng chính.
        "Nếu kho không đủ cho một vai trò món, BỎ HẲN vai trò đó và trả ít món hơn.",
        "Luật này THẮNG yêu cầu 'đúng số món và đúng vai trò' nêu ở trên: thà thiếu",
        "món còn hơn thay bằng nguyên liệu ngoài danh sách.",
      ].join("\n")
    : [
        "Thực phẩm nhà đang có (ưu tiên dùng, được phép mua thêm):",
        pantryNames.join("\n") || "  (kho trống)",
      ].join("\n");

  // Công thức cũ của gia đình gần như chắc chắn dùng nguyên liệu ngoài kho; mời
  // tái sử dụng chúng ngay dưới một luật cứng là tự mâu thuẫn. Bỏ hẳn khối này
  // ở chế độ danh sách trắng.
  const availableRecipesBlock = availableOnly
    ? ""
    : [
        "Công thức đã có trong kho gia đình (có thể tái sử dụng nếu phù hợp):",
        ctx.availableRecipeNames.length
          ? ctx.availableRecipeNames.map((n) => `  - ${n}`).join("\n")
          : "  (chưa có)",
      ].join("\n");

  // Nhắc lại danh sách trắng ở DÒNG CUỐI, ngay trước câu chốt định dạng: luật
  // đứng gần cuối được model tuân tốt hơn hẳn luật nằm giữa một prompt dài.
  const pantryTail = availableOnly
    ? [
        `NHẮC LẠI — chỉ được dùng: ${ctx.pantry.map((x) => x.name).join(", ") || "(kho trống)"} + các gia vị kể trên.`,
        "Món nào cần thứ khác thì BỎ món đó, đừng thay nguyên liệu.",
      ].join("\n")
    : "";

  // Hai câu này lặp lại "đúng số món và vai trò" ở hai vị trí model đọc kỹ nhất
  // (ngay trên danh sách bữa, và DÒNG CUỐI CÙNG của prompt). Ở AVAILABLE_ONLY
  // chúng chọi thẳng với luật "thiếu nguyên liệu thì bỏ vai trò" — giữ nguyên
  // thì lời cuối cùng model nghe được lại chính là lời xúi nó bịa nguyên liệu.
  const slotsHeader = availableOnly
    ? "Hãy lên MÂM CƠM cho các bữa sau. Vai trò ghi kèm là MỤC TIÊU, không phải hạn ngạch bắt buộc — kho không đủ thì trả ít món hơn:"
    : "Hãy lên MÂM CƠM cho ĐÚNG các bữa sau — mỗi bữa đúng số món và vai trò ghi kèm:";

  const closingLine = availableOnly
    ? "Trả về JSON theo đúng cấu trúc: mỗi phần tử meals ứng một bữa, dishes chỉ gồm những món nấu được bằng danh sách nguyên liệu trên."
    : "Trả về JSON theo đúng cấu trúc: mỗi phần tử meals ứng một bữa, dishes có đúng số món & vai trò yêu cầu.";

  const slotsText = slotsBlock(ctx.slots);

  const user = [
    `Số người trong gia đình: ${ctx.familySize}`,
    "",
    "Thành viên & sở thích:",
    membersText,
    "",
    ageNotesBlock(ctx.members),
    "",
    "Hồ sơ ăn uống:",
    `  - Khẩu vị vùng: ${REGION_LABEL[p.cuisineRegion] ?? p.cuisineRegion}`,
    `  - Độ cay: ${SPICE_LABEL[p.spiceLevel] ?? p.spiceLevel}`,
    `  - Ngân sách: ${BUDGET_LABEL[p.budgetLevel] ?? p.budgetLevel}`,
    `  - Thời gian nấu tối đa mỗi món: ${p.maxCookMinutes} phút`,
    `  - Cả mâm nên nấu xong trong khoảng ${p.maxCookMinutes} phút — các món nấu song song được.`,
    `  - Mục tiêu healthy: ${p.healthGoals.length ? p.healthGoals.join(", ") : "cân bằng chung"}`,
    p.notes ? `  - Ghi chú: ${p.notes}` : "",
    "",
    userNoteBlock(ctx.userNote),
    "",
    pantryBlock,
    "",
    "Món đã ăn gần đây (TRÁNH lặp lại):",
    ctx.recentRecipeNames.length
      ? ctx.recentRecipeNames.map((n) => `  - ${n}`).join("\n")
      : "  (chưa có)",
    "",
    availableRecipesBlock,
    "",
    slotsHeader,
    slotsText,
    "",
    catalogReferenceText(ctx.catalogReference),
    // Khung cả đợt khi đang NỞ một ngày của thực đơn nhiều ngày; rỗng ở luồng
    // một ngày nên prompt cũ không đổi.
    ctx.planContext
      ? [
          "Khung thực đơn cả đợt (các ngày khác đã có gì — TRÁNH lặp nguyên liệu chính):",
          ctx.planContext,
        ].join("\n")
      : "",
    // Câu nhắc khi sinh lại do mâm trước vi phạm kho; rỗng thì .filter bên dưới
    // tự loại, không để lại dòng trắng thừa.
    ctx.retryNote ?? "",
    pantryTail,
    closingLine,
  ]
    .filter((l) => l !== "")
    .join("\n");

  return { system, user };
}

/**
 * Prompt PHA 1: dựng khung cho cả khoảng ngày. Cố ý KHÔNG đòi nguyên liệu và
 * các bước — đó là việc của pha 2. Nhờ vậy model thấy trọn khoảng ngày trong
 * một lượt (điều kiện để xoay vòng đạm và cân dinh dưỡng thật) mà output vẫn
 * nhỏ hơn một ngày đầy đủ công thức.
 */
export function buildWeekPlanPrompt(ctx: MenuContext): {
  system: string;
  user: string;
} {
  const p = ctx.profile;
  const dates = [...new Set(ctx.slots.map((s) => s.date))].sort();

  const system = [
    "Bạn vừa là CHUYÊN GIA DINH DƯỠNG, vừa là ĐẦU BẾP gia đình người Việt giàu kinh nghiệm.",
    `Nhiệm vụ: lên KHUNG thực đơn cho ${dates.length} ngày liên tiếp — chỉ TÊN MÓN, vai trò, đạm chính và nhãn dinh dưỡng.`,
    "TUYỆT ĐỐI KHÔNG trả về nguyên liệu hay các bước nấu ở bước này.",
    "QUY TẮC BẮT BUỘC (an toàn):",
    "- TUYỆT ĐỐI không dùng nguyên liệu gây dị ứng của bất kỳ thành viên nào.",
    "- Tôn trọng các kiêng khem (ăn chay, không thịt bò, v.v.).",
    "- Ưu tiên món hợp khẩu vị, tránh món bị ghét.",
    ...(ctx.userNote ? [USER_NOTE_RULE] : []),
    ...HEALTHY_RULES,
    "QUY TẮC CẢ ĐỢT (đây là lý do bạn được xem hết các ngày cùng lúc):",
    "- KHÔNG có hai món trùng tên trong toàn bộ khoảng ngày (riêng đồ chua ăn kèm thì được lặp).",
    "- Món mặn của hai ngày LIỀN NHAU phải khác đạm chính.",
    "- Xoay vòng đạm chính cho đều cả đợt; trải đều nhãn dinh dưỡng, không dồn món nhiều dầu mỡ vào cùng vài ngày.",
    "- Ưu tiên dùng sớm thực phẩm nhà đang có, nhất là thứ sắp hết hạn.",
    `- mainProtein CHỈ được là một trong: ${MAIN_PROTEINS.join(", ")}.`,
    "CHỈ trả về JSON, KHÔNG giải thích, KHÔNG markdown.",
    'Cấu trúc: {"meals":[{"date":"yyyy-mm-dd","mealType":"BREAKFAST|LUNCH|DINNER","dishes":[{"name":"string","dishRole":"MON_MAN|MON_XAO|CANH_SUP|RAU_LUOC|LAU|COM_BUN_PHO|MON_CUON|TRANG_MIENG|DO_CHUA","mainProtein":"...","nutritionLabels":["string"]}]}]}',
  ].join("\n");

  const user = [
    `Số người trong gia đình: ${ctx.familySize}`,
    "",
    "Thành viên & sở thích:",
    membersBlock(ctx.members),
    "",
    ageNotesBlock(ctx.members),
    "",
    userNoteBlock(ctx.userNote),
    "",
    "Hồ sơ ăn uống:",
    `  - Khẩu vị vùng: ${REGION_LABEL[p.cuisineRegion] ?? p.cuisineRegion}`,
    `  - Độ cay: ${SPICE_LABEL[p.spiceLevel] ?? p.spiceLevel}`,
    `  - Ngân sách: ${BUDGET_LABEL[p.budgetLevel] ?? p.budgetLevel}`,
    `  - Thời gian nấu tối đa mỗi món: ${p.maxCookMinutes} phút`,
    `  - Cả mâm nên nấu xong trong khoảng ${p.maxCookMinutes} phút — các món nấu song song được.`,
    `  - Mục tiêu healthy: ${p.healthGoals.length ? p.healthGoals.join(", ") : "cân bằng chung"}`,
    p.notes ? `  - Ghi chú: ${p.notes}` : "",
    "",
    "Thực phẩm nhà đang có (ưu tiên dùng sớm):",
    ctx.pantry.length
      ? ctx.pantry
          .map((x) => `  - ${x.name}${x.expiringSoon ? "  ⚠ nên dùng sớm" : ""}`)
          .join("\n")
      : "  (kho trống)",
    "",
    "Món đã ăn gần đây (TRÁNH lặp lại):",
    ctx.recentRecipeNames.length
      ? ctx.recentRecipeNames.map((n) => `  - ${n}`).join("\n")
      : "  (chưa có)",
    "",
    "Hãy lên KHUNG cho ĐÚNG các bữa sau — mỗi bữa đúng số món và vai trò ghi kèm:",
    slotsBlock(ctx.slots),
    "",
    catalogReferenceText(ctx.catalogReference),
    ctx.retryNote ?? "",
    "Nhắc lại: CHỈ trả tên món + vai trò + đạm chính + nhãn dinh dưỡng. Không nguyên liệu, không các bước.",
  ]
    .filter((l) => l !== "")
    .join("\n");

  return { system, user };
}

/**
 * Prompt xin mẹo meal prep cho cả đợt.
 *
 * Cố ý KHÔNG gửi công thức đầy đủ: mẹo là chuyện sắp xếp công việc (ướp sẵn, sơ
 * chế trước, tận dụng nước luộc) chứ không phải chuyện nấu từng món, mà nhồi 14
 * công thức vào đây thì prompt phình lên vô ích và Ollama trên CPU không kham.
 */
export function buildMealPrepPrompt(ctx: MealPrepContext): {
  system: string;
  user: string;
} {
  const system = [
    "Bạn là đầu bếp gia đình người Việt, chuyên tổ chức bếp cho nhà bận rộn.",
    "Nhiệm vụ: đưa ĐÚNG 5 mẹo chuẩn bị trước (meal prep) cho đợt thực đơn dưới đây.",
    "QUY TẮC:",
    "- Mẹo phải BÁM VÀO các món có thật trong danh sách, nêu tên món cụ thể khi có thể.",
    "- Mỗi mẹo là một câu hoặc hai câu, hành động được ngay, không nói chung chung.",
    "- Ưu tiên việc làm được từ tối hôm trước hoặc lúc rảnh cuối tuần.",
    "- Viết bằng tiếng Việt.",
    "CHỈ trả về JSON, KHÔNG giải thích, KHÔNG markdown.",
    'Cấu trúc: {"tips":["string","string","string","string","string"]}',
  ].join("\n");

  const user = [
    `Gia đình ${ctx.familySize} người, thực đơn ${ctx.days} ngày.`,
    `Hiện mỗi mâm nấu mất khoảng ${ctx.maxCookMinutes} phút — các mẹo cần kéo xuống còn 20-30 phút.`,
    "",
    "Các món trong đợt:",
    ctx.dishNames.length
      ? ctx.dishNames.map((n) => `  - ${n}`).join("\n")
      : "  (chưa có món nào)",
    "",
    ctx.topIngredients.length
      ? `Nguyên liệu dùng nhiều trong đợt: ${ctx.topIngredients.join(", ")}.`
      : "",
    "",
    "Trả về JSON đúng cấu trúc với đúng 5 mẹo.",
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
function catalogReferenceText(ref: CatalogReference | undefined): string {
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

// Prompt cho việc SỬA mâm: nêu trạng thái mâm hiện tại + lịch sử chat + lệnh mới.
export function buildEditPrompt(ctx: EditContext): {
  system: string;
  user: string;
} {
  const scopeRule =
    ctx.scope === "DISH"
      ? `Chỉ thay ĐÚNG 1 MÓN có vai trò "${DISH_ROLE_LABEL[ctx.targetRole ?? "MON_MAN"]}". Trả về đúng 1 phần tử trong dishes, khác hẳn món hiện tại, vẫn hợp vai trò đó.`
      : ctx.scope === "ADD"
        ? "Đề xuất ĐÚNG 1 MÓN MỚI bổ sung cho mâm (không trùng món đang có, cân bằng thêm cho mâm). Trả về đúng 1 phần tử trong dishes."
        : "Viết lại DANH SÁCH ĐẦY ĐỦ các món của mâm sau khi áp yêu cầu (có thể thêm/bớt/đổi món). Trả về toàn bộ dishes của mâm.";

  const system = [
    "Bạn vừa là CHUYÊN GIA DINH DƯỠNG, vừa là ĐẦU BẾP gia đình người Việt giàu kinh nghiệm.",
    "Nhiệm vụ: CHỈNH SỬA mâm cơm theo yêu cầu người dùng, giữ cân bằng dinh dưỡng và đúng ẩm thực Việt.",
    "QUY TẮC BẮT BUỘC:",
    "- TUYỆT ĐỐI không dùng nguyên liệu gây dị ứng; tôn trọng kiêng khem.",
    "- Không lặp lại món đã ăn gần đây; tránh trùng nguyên liệu chính với các món còn lại trong mâm.",
    "- Gắn nhãn dinh dưỡng cho từng món; công thức bằng tiếng Việt.",
    PREP_AHEAD_RULE,
    `- ${scopeRule}`,
    "CHỈ trả về JSON, KHÔNG giải thích, KHÔNG markdown.",
    `Cấu trúc JSON: {"dishes":[{"name":"string","dishRole":"MON_MAN|MON_XAO|CANH_SUP|RAU_LUOC|LAU|COM_BUN_PHO|MON_CUON|TRANG_MIENG|DO_CHUA","servings":number,"cookMinutes":number,"steps":["string"],"nutritionLabels":["string"],"prepAheadNote":"string","ingredients":[{"name":"string","quantity":number,"unit":"string"}]}]}`,
  ].join("\n");

  const p = ctx.profile;
  const membersText =
    ctx.members
      .map((m, i) => {
        const parts = [`  ${i + 1}. ${m.name} (${m.ageGroup})`];
        if (m.allergies.length) parts.push(`dị ứng: ${m.allergies.join(", ")}`);
        if (m.dietaryRestrictions.length)
          parts.push(`kiêng: ${m.dietaryRestrictions.join(", ")}`);
        if (m.dislikes.length) parts.push(`ghét: ${m.dislikes.join(", ")}`);
        return parts.join(" — ");
      })
      .join("\n") || "  (chưa có thông tin thành viên)";

  const currentText = ctx.currentDishes
    .map(
      (d) =>
        `  - [${DISH_ROLE_LABEL[d.dishRole] ?? d.dishRole}] ${d.name} — nguyên liệu: ${d.ingredientNames.join(", ") || "?"}`,
    )
    .join("\n");

  const historyText = ctx.history.length
    ? ctx.history
        .map(
          (t) => `  ${t.role === "user" ? "Người dùng" : "Trợ lý"}: ${t.content}`,
        )
        .join("\n")
    : "";

  const user = [
    `Bữa: ${MEALTYPE_LABEL[ctx.mealType] ?? ctx.mealType} · ${ctx.servings} người`,
    `Khẩu vị vùng: ${REGION_LABEL[p.cuisineRegion] ?? p.cuisineRegion} · độ cay: ${SPICE_LABEL[p.spiceLevel] ?? p.spiceLevel} · ngân sách: ${BUDGET_LABEL[p.budgetLevel] ?? p.budgetLevel}`,
    "",
    "Thành viên & hạn chế:",
    membersText,
    "",
    "Mâm hiện tại:",
    currentText || "  (mâm trống)",
    "",
    historyText ? "Lịch sử trao đổi (cũ → mới):" : "",
    historyText,
    `YÊU CẦU MỚI: ${ctx.instruction}`,
    "",
    "Món đã ăn gần đây (TRÁNH lặp):",
    ctx.recentRecipeNames.length
      ? ctx.recentRecipeNames.map((n) => `  - ${n}`).join("\n")
      : "  (chưa có)",
    "",
    catalogReferenceText(ctx.catalogReference),
    "Trả về JSON đúng cấu trúc đã nêu.",
  ]
    .filter((l) => l !== "")
    .join("\n");

  return { system, user };
}
