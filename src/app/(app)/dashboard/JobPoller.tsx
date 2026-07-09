"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Trong khi còn job đang tạo, refresh server component mỗi vài giây để cập nhật
// trạng thái/kết quả mà không cần queue hay websocket. Dừng khi unmount (job xong
// -> dashboard render lại không còn <JobPoller/>).
export function JobPoller({ intervalMs = 3000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
