import { redirect } from "next/navigation";
import { auth } from "./auth";

// Helper cô lập tenant: mọi trang/hành động server phải đi qua đây để lấy
// familyId, đảm bảo truy vấn luôn được scope theo gia đình của user đăng nhập.

export async function getCurrentUser() {
  const session = await auth();
  return session?.user ?? null;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user?.id) redirect("/login");
  return user;
}

/** Yêu cầu user đã đăng nhập VÀ đã có Family (đã qua onboarding). */
export async function requireFamily() {
  const user = await requireUser();
  if (!user.familyId) redirect("/onboarding");
  return { userId: user.id, familyId: user.familyId, user };
}
