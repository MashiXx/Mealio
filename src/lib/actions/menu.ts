"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { requireFamily } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { getActiveJob, pumpJobs } from "@/lib/jobs";
import { matchKey, staticKind } from "@/lib/pantry";
import type { MealTypeStr } from "@/lib/ai/types";

export type GenerateState = { error?: string };

const MEAL_TYPES: MealTypeStr[] = ["BREAKFAST", "LUNCH", "DINNER"];

/**
 * Tạo job tạo thực đơn rồi CHẠY NGẦM: trả về/redirect ngay, việc gọi AI diễn ra
 * sau response qua after() nên user rời trang cũng không mất. Mỗi gia đình chỉ
 * 1 job active tại một thời điểm (chống trùng).
 */
export async function startGenerationAction(
  _prev: GenerateState,
  formData: FormData,
): Promise<GenerateState> {
  const { familyId } = await requireFamily();

  const date = String(formData.get("date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: "Vui lòng chọn ngày hợp lệ." };
  }

  const selected = formData
    .getAll("mealTypes")
    .map(String)
    .filter((m): m is MealTypeStr => (MEAL_TYPES as string[]).includes(m));

  if (selected.length === 0) {
    return { error: "Chọn ít nhất một bữa (sáng/trưa/tối)." };
  }

  // "auto" hoặc rỗng -> null (server tự tính theo số người); ngược lại 1..5.
  const rawCount = String(formData.get("dishCount") ?? "");
  let dishCount: number | null = null;
  if (rawCount && rawCount !== "auto") {
    const n = parseInt(rawCount, 10);
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      return { error: "Số món phải từ 1 đến 5." };
    }
    dishCount = n;
  }

  // Số ngày sinh liên tiếp, tính từ `date`. Mặc định 1 = hành vi cũ.
  const rawDays = String(formData.get("days") ?? "1");
  const days = parseInt(rawDays, 10);
  if (!Number.isInteger(days) || days < 1 || days > 7) {
    return { error: "Số ngày phải từ 1 đến 7." };
  }

  // Chỉ hai giá trị hợp lệ; mọi thứ khác rơi về FLEXIBLE (kho chỉ là gợi ý).
  const pantryMode =
    String(formData.get("pantryMode") ?? "") === "AVAILABLE_ONLY"
      ? ("AVAILABLE_ONLY" as const)
      : ("FLEXIBLE" as const);

  // "Nấu bằng đồ có sẵn" chỉ có nghĩa cho MỘT ngày: kho hiện có cạn ngay sau một
  // hai bữa, nên bảy ngày thuần bằng kho là yêu cầu không có lời giải. Chốt này
  // cũng giữ cho luồng nhiều ngày luôn là FLEXIBLE, nhờ đó đường một ngày (kèm
  // verifyMenuAgainstPantry) không phải đụng tới.
  if (pantryMode === "AVAILABLE_ONLY" && days > 1) {
    return {
      error:
        'Chế độ "Nấu bằng đồ có sẵn" chỉ tạo được cho 1 ngày, vì kho nhà không đủ cho nhiều ngày liên tiếp. Chọn 1 ngày, hoặc đổi sang chế độ Thoải mái.',
    };
  }

  // Chế độ "đồ có sẵn" mà kho rỗng thì không có gì để nấu — chặn ngay, đừng tạo
  // job. Chỉ đếm nguyên liệu MAIN: kho chỉ có mắm muối không phải là "có đồ".
  //
  // Phải đếm trong JS chứ KHÔNG lọc bằng `where: { ingredient: { kind: "MAIN" } }`:
  // Ingredient.kind là nullable và addPantryItemAction CỐ Ý để NULL (chỉ nút "đổi
  // nhóm" mới ghi giá trị cụ thể), mà SQL `kind = 'MAIN'` không khớp NULL. Lọc
  // bằng SQL thì nhà nhập cả chục nguyên liệu nhưng chưa từng bấm "đổi nhóm" sẽ
  // ra count = 0 và bị báo "kho trống" dù kho đầy, không có đường thoát. Kind
  // hiệu lực = cờ của gia đình, thiếu thì tra bảng gia vị tĩnh — cùng cách tính
  // với /pantry và actions/pantry.ts. Kho nhà tối đa vài chục dòng.
  if (pantryMode === "AVAILABLE_ONLY") {
    const items = await prisma.pantryItem.findMany({
      where: { familyId },
      select: { ingredient: { select: { name: true, kind: true } } },
    });
    const count = items.filter(
      (i) =>
        (i.ingredient.kind ?? staticKind(matchKey(i.ingredient.name))) === "MAIN",
    ).length;
    if (count === 0) {
      return {
        error:
          "Kho nhà đang trống. Thêm vài nguyên liệu ở trang Kho nhà, hoặc chọn chế độ Thoải mái.",
      };
    }
  }

  // Chống trùng: đã có job đang chạy thì không tạo thêm.
  const active = await getActiveJob(familyId);
  if (active) {
    return { error: "Đang có thực đơn được tạo, vui lòng đợi hoàn tất." };
  }

  // Đưa vào hàng đợi (PENDING); bộ điều phối sẽ quyết khi nào chạy.
  await prisma.generationJob.create({
    data: {
      familyId,
      date: new Date(`${date}T00:00:00`), // midnight local; ngày ĐẦU của khoảng
      days,
      mealTypes: selected,
      dishCount,
      pantryMode,
      status: "PENDING",
    },
  });

  // Kích bộ điều phối sau response: pump sẽ chạy job này nếu còn chỗ, hoặc để
  // nó xếp hàng PENDING tới lượt. Đăng ký TRƯỚC redirect (redirect ném lỗi để
  // ngắt; after vẫn chạy).
  after(() => pumpJobs());

  redirect(`/dashboard?date=${date}`);
}

/** Bỏ qua (xoá) một job FAILED để không hiện thẻ lỗi nữa. */
export async function ackJobAction(formData: FormData): Promise<void> {
  const { familyId } = await requireFamily();
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) return;
  // deleteMany + điều kiện familyId: đảm bảo chỉ xoá job của chính gia đình mình.
  await prisma.generationJob.deleteMany({
    where: { id: jobId, familyId, status: "FAILED" },
  });
}
