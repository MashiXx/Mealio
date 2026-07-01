import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./db";

// Auth.js v5 — đăng nhập bằng email/mật khẩu (Credentials) + phiên JWT.
// familyId được nhúng vào token và làm mới từ DB mỗi lần để phản ánh
// trạng thái sau onboarding (khi user vừa được gán vào một Family).

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Mật khẩu", type: "password" },
      },
      authorize: async (creds) => {
        const email = (creds?.email as string | undefined)?.trim().toLowerCase();
        const password = creds?.password as string | undefined;
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user?.passwordHash) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        return { id: user.id, email: user.email, name: user.name ?? undefined };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      if (token.uid) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.uid as string },
          select: { familyId: true },
        });
        token.familyId = dbUser?.familyId ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.uid as string) ?? "";
        session.user.familyId = (token.familyId as string | null) ?? null;
      }
      return session;
    },
  },
});
