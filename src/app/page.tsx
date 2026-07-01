import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

// Trang gốc chỉ điều hướng theo trạng thái: chưa đăng nhập -> /login,
// đã đăng nhập nhưng chưa có gia đình -> /onboarding, còn lại -> /dashboard.
export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.familyId) redirect("/onboarding");
  redirect("/dashboard");
}
