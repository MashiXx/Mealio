import { prisma } from "@/lib/db";
import { requireFamily } from "@/lib/tenant";
import { MembersForm } from "./MembersForm";

export default async function MembersPage() {
  const { familyId } = await requireFamily();
  const members = await prisma.familyMember.findMany({
    where: { familyId },
    orderBy: { name: "asc" },
  });

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight">Thành viên gia đình</h1>
      <p className="mt-1 mb-6 text-sm text-zinc-500">
        Thêm, sửa hoặc xoá thành viên. Thông tin dị ứng và kiêng khem được dùng
        để AI lên thực đơn an toàn.
      </p>

      <MembersForm
        initialMembers={members.map((m) => ({
          id: m.id,
          name: m.name,
          image: m.image,
          ageGroup: m.ageGroup,
          allergies: m.allergies,
          dietaryRestrictions: m.dietaryRestrictions,
          likes: m.likes,
          dislikes: m.dislikes,
        }))}
      />
    </div>
  );
}
