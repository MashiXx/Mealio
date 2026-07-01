"use server";

import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { requireFamily } from "@/lib/tenant";
import { getAIProvider } from "@/lib/ai";
import type { ImageMediaType, MemberImage } from "@/lib/ai/types";
import type { MemberRecognition } from "@/lib/ai/schema";

// Nhận data URL ảnh từ client: lưu thành file avatar dưới /public/uploads và
// (nếu đã cấu hình AI) chạy nhận dạng nhóm tuổi + gợi ý. Lỗi nhận dạng KHÔNG
// làm hỏng việc lưu ảnh — trả về recognitionError để hiển thị nhẹ nhàng.

const ALLOWED: Record<string, ImageMediaType> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

const MAX_BYTES = 6 * 1024 * 1024; // 6MB sau khi client đã resize

export type ProcessImageResult =
  | {
      ok: true;
      image: string;
      recognition: MemberRecognition | null;
      recognitionError?: string;
    }
  | { ok: false; error: string };

export async function processMemberImage(
  dataUrl: string,
): Promise<ProcessImageResult> {
  const { familyId } = await requireFamily();

  const match = /^data:(image\/[a-z]+);base64,(.+)$/i.exec(dataUrl ?? "");
  if (!match) {
    return { ok: false, error: "Ảnh không hợp lệ." };
  }

  const mediaType = match[1].toLowerCase();
  const base64 = match[2];
  const buffer = Buffer.from(base64, "base64");

  if (buffer.byteLength === 0) {
    return { ok: false, error: "Ảnh rỗng." };
  }
  if (buffer.byteLength > MAX_BYTES) {
    return { ok: false, error: "Ảnh quá lớn (tối đa 6MB)." };
  }

  const ext = mediaType.split("/")[1];
  const normalizedType = ALLOWED[ext];
  if (!normalizedType) {
    return { ok: false, error: "Định dạng ảnh không hỗ trợ (JPEG/PNG/WEBP)." };
  }

  // Lưu file vào public/uploads (đường dẫn phục vụ tĩnh: /uploads/<file>).
  const dir = path.join(process.cwd(), "public", "uploads");
  await mkdir(dir, { recursive: true });
  const filename = `${randomUUID()}.${ext === "jpg" ? "jpeg" : ext}`;
  await writeFile(path.join(dir, filename), buffer);
  const image = `/uploads/${filename}`;

  // Nhận dạng (không bắt buộc). Chuẩn hoá media_type cho AI vision.
  const memberImage: MemberImage = { base64, mediaType: normalizedType };
  try {
    const provider = await getAIProvider(familyId);
    const recognition = await provider.recognizeMember(memberImage);
    return { ok: true, image, recognition };
  } catch (e) {
    return {
      ok: true,
      image,
      recognition: null,
      recognitionError:
        e instanceof Error ? e.message : "Không nhận dạng được ảnh.",
    };
  }
}
