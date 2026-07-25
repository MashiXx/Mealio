import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // Khớp alias "@/*" của tsconfig. Không có dòng này, file được test import
    // gián tiếp mà dùng "@/..." sẽ gãy với "Cannot find package", trong khi tsc
    // và Next vẫn xanh -> lỗi chỉ lộ ra lúc chạy test.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
