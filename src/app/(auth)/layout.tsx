import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 block text-center">
          <span className="text-2xl font-bold tracking-tight text-emerald-700">
            🍚 Mealio
          </span>
          <p className="mt-1 text-sm text-zinc-500">
            Thực đơn gia đình, gọn gàng và lành mạnh
          </p>
        </Link>
        {children}
      </div>
    </div>
  );
}
