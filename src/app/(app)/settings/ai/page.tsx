import { prisma } from "@/lib/db";
import { requireFamily } from "@/lib/tenant";
import { SettingsForm } from "./SettingsForm";

export default async function AISettingsPage() {
  const { familyId } = await requireFamily();
  const settings = await prisma.aISettings.findUnique({ where: { familyId } });

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-bold tracking-tight">Cài đặt AI</h1>
      <p className="mt-1 mb-6 text-sm text-zinc-500">
        Mealio dùng API key của riêng bạn (BYOK) để tạo thực đơn. Bạn kiểm soát
        chi phí và dữ liệu.
      </p>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6">
        <SettingsForm
          provider={settings?.provider ?? "ANTHROPIC"}
          model={settings?.model ?? "claude-opus-4-8"}
          baseUrl={settings?.baseUrl ?? ""}
          hasKey={Boolean(settings?.apiKeyEncrypted)}
        />
      </div>
    </div>
  );
}
