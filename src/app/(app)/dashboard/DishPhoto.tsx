import Image from "next/image";
import { resolveDishVisual } from "@/lib/dish-image";

// KHÔNG đặt "use client": component này dùng ở cả dashboard (client) lẫn
// history/catalog (server), giống DishInfo.tsx.

type Size = "hero" | "thumb";

// fill yêu cầu phần tử cha có position: relative (đã có trong BOX).
const BOX: Record<Size, string> = {
  hero: "relative w-full aspect-[16/9] overflow-hidden rounded-xl",
  thumb: "relative w-full aspect-square overflow-hidden rounded-lg",
};

const SIZES: Record<Size, string> = {
  hero: "(max-width: 768px) 100vw, 640px",
  thumb: "(max-width: 768px) 50vw, 160px",
};

const EMOJI_SIZE: Record<Size, string> = {
  hero: "text-6xl",
  thumb: "text-3xl",
};

export function DishPhoto({
  name,
  dishRole,
  size,
  className = "",
}: {
  name: string;
  dishRole: string;
  size: Size;
  className?: string;
}) {
  const v = resolveDishVisual(name, dishRole);

  return (
    <div
      className={`${BOX[size]} ${v.imageUrl ? "bg-zinc-100" : v.gradientClass} ${className}`}
    >
      {v.imageUrl ? (
        <Image
          src={v.imageUrl}
          alt={name}
          fill
          sizes={SIZES[size]}
          // Next 16 đã deprecate `priority`; tài liệu khuyên dùng loading="eager"
          // cho ảnh nằm trên màn hình đầu thay vì preload.
          loading={size === "hero" ? "eager" : "lazy"}
          className="object-cover"
        />
      ) : (
        <div
          className={`flex h-full w-full items-center justify-center opacity-40 ${EMOJI_SIZE[size]}`}
        >
          {v.emoji}
        </div>
      )}
    </div>
  );
}

/**
 * Dòng ghi công nguồn ảnh. BẮT BUỘC hiển thị ở nơi món được trình bày chi tiết
 * khi ảnh có giấy phép CC BY / CC BY-SA. Trả null nếu món không dùng ảnh ngoài.
 */
export function DishPhotoCredit({
  name,
  dishRole,
}: {
  name: string;
  dishRole: string;
}) {
  const v = resolveDishVisual(name, dishRole);
  if (!v.imageUrl || !v.credit) return null;
  return (
    <p className="mt-1 text-[10px] leading-tight text-zinc-400">
      Ảnh: {v.credit}
    </p>
  );
}
