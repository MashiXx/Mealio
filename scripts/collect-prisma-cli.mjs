// Gom Prisma CLI + đúng closure phụ thuộc runtime của nó vào một node_modules riêng,
// để image runtime chạy được `prisma migrate deploy` mà không phải kéo cả node_modules dev.
// Chạy trong stage builder: node scripts/collect-prisma-cli.mjs <thư-mục-đích>
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve("node_modules");
const DEST = path.resolve(process.argv[2] ?? "/prisma-cli/node_modules");

// Tìm package theo cách Node resolve: từ thư mục hiện tại leo dần lên các node_modules cha.
function findPackage(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const seen = new Set();
function walk(name, fromDir) {
  const pkgDir = findPackage(name, fromDir);
  if (!pkgDir) throw new Error(`Không tìm thấy package "${name}" (từ ${fromDir})`);
  if (seen.has(pkgDir)) return;
  seen.add(pkgDir);
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  for (const dep of Object.keys(pkg.dependencies ?? {})) walk(dep, pkgDir);
}

walk("prisma", path.dirname(SRC));

fs.rmSync(DEST, { recursive: true, force: true });
for (const pkgDir of seen) {
  // Chỉ giữ các package nằm ở node_modules gốc; package lồng nhau đi kèm khi copy cả thư mục cha.
  if (!pkgDir.startsWith(SRC + path.sep)) continue;
  const target = path.join(DEST, path.relative(SRC, pkgDir));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(pkgDir, target, { recursive: true, dereference: false });
}

console.log(`Đã gom ${seen.size} package Prisma CLI vào ${DEST}`);
