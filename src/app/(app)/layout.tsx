import Link from "next/link";
import { requireFamily } from "@/lib/tenant";
import { logoutAction } from "@/lib/actions/auth";

// Layout cho khu vực đã đăng nhập & đã có gia đình. requireFamily sẽ tự
// redirect về /login hoặc /onboarding nếu chưa đủ điều kiện.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await requireFamily();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-4 py-3">
          <Link href="/dashboard" className="font-bold text-emerald-700">
            🍚 Mealio
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/dashboard" className="text-zinc-600 hover:text-zinc-900">
              Bảng chính
            </Link>
            <Link href="/menu/new" className="text-zinc-600 hover:text-zinc-900">
              Tạo thực đơn
            </Link>
            <Link href="/catalog" className="text-zinc-600 hover:text-zinc-900">
              Kho món
            </Link>
            <Link
              href="/settings/members"
              className="text-zinc-600 hover:text-zinc-900"
            >
              Thành viên
            </Link>
            <Link
              href="/settings/ai"
              className="text-zinc-600 hover:text-zinc-900"
            >
              Cài đặt AI
            </Link>
            <form action={logoutAction}>
              <button className="text-zinc-500 hover:text-red-600">
                Đăng xuất
              </button>
            </form>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        {children}
      </main>

      <footer className="border-t border-zinc-200 py-4 text-center text-xs text-zinc-400">
        Mealio · {user.name ?? user.email}
      </footer>
    </div>
  );
}
