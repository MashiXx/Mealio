import Link from "next/link";
import { requireFamily } from "@/lib/tenant";
import { getActiveJob } from "@/lib/jobs";
import { NewMenuForm } from "./NewMenuForm";

function formatDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export default async function NewMenuPage() {
  const { familyId } = await requireFamily();
  const active = await getActiveJob(familyId);

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-bold tracking-tight">Tạo thực đơn</h1>
      <p className="mt-1 mb-6 text-sm text-zinc-500">
        Chọn ngày và các bữa cần gợi ý. Mealio sẽ đề xuất món phù hợp khẩu vị,
        tránh dị ứng, ưu tiên đồ có sẵn trong kho.
      </p>

      {active ? (
        // Đã có job đang chạy: chặn tạo trùng, dẫn về dashboard để theo dõi.
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          <p className="font-medium">
            ⏳ Đang tạo thực đơn cho ngày {formatDay(active.date)}…
          </p>
          <p className="mt-1 text-amber-700">
            Mỗi lần chỉ tạo được một thực đơn. Vui lòng đợi lần này hoàn tất.
          </p>
          <Link
            href="/dashboard"
            className="mt-4 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Về trang chủ theo dõi
          </Link>
        </div>
      ) : (
        <NewMenuForm />
      )}
    </div>
  );
}
