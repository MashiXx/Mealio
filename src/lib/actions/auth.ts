"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { prisma } from "@/lib/db";
import { signIn, signOut } from "@/lib/auth";

// Server actions cho đăng ký / đăng nhập / đăng xuất.
// Dùng với useActionState ở client (signature: (prevState, formData)).

export type AuthState = {
  error?: string;
  fieldErrors?: Partial<Record<"name" | "email" | "password", string[]>>;
};

const registerSchema = z.object({
  name: z.string().trim().min(1, "Vui lòng nhập tên"),
  email: z.string().trim().toLowerCase().email("Email không hợp lệ"),
  password: z.string().min(6, "Mật khẩu tối thiểu 6 ký tự"),
});

export async function registerAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "Email này đã được đăng ký." };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({ data: { name, email, passwordHash } });

  // Đăng nhập luôn sau khi đăng ký. signIn ném lỗi redirect (NEXT_REDIRECT)
  // khi thành công -> phải để lỗi đó lọt ra ngoài, chỉ bắt AuthError.
  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: "/onboarding",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Tạo tài khoản xong nhưng đăng nhập tự động thất bại." };
    }
    throw error;
  }
  return {};
}

export async function loginAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { error: "Nhập email và mật khẩu." };
  }

  try {
    await signIn("credentials", { email, password, redirectTo: "/" });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Email hoặc mật khẩu không đúng." };
    }
    throw error;
  }
  return {};
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}
