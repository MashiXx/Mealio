# syntax=docker/dockerfile:1

# ---- deps: cài toàn bộ dependencies (gồm dev) để build ----
FROM node:22-slim AS deps
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json yarn.lock ./
# Cache mount giữ gói đã tải giữa các lần build: khi layer bị vô hiệu (Coolify hay
# prune image), yarn vẫn cài từ đĩa thay vì tải lại toàn bộ từ registry.
RUN --mount=type=cache,target=/root/.yarn-cache \
    yarn install --frozen-lockfile --prefer-offline --cache-folder /root/.yarn-cache

# ---- builder: prisma generate + next build (standalone) ----
FROM node:22-slim AS builder
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Dummy DATABASE_URL để build không gãy nếu có code đọc env lúc build; runtime dùng env thật.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN yarn prisma generate
RUN yarn build
# Gom Prisma CLI + toàn bộ phụ thuộc runtime của nó (33 package) cho stage runner.
RUN node scripts/collect-prisma-cli.mjs /prisma-cli/node_modules

# ---- runner: image runtime gọn từ standalone ----
FROM node:22-slim AS runner
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# App standalone
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Prisma runtime: client đã generate + schema/migrations + CLI (kèm đủ phụ thuộc) cho migrate deploy
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /prisma-cli/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma

COPY --chmod=755 docker-entrypoint.sh ./docker-entrypoint.sh

# COPY chạy bằng root nên /app/.next thuộc root; runtime Next ghi cache ảnh + ISR
# vào .next/cache dưới user nextjs -> phải chuyển quyền, nếu không EACCES.
RUN mkdir -p .next/cache && chown -R nextjs:nodejs .next

USER nextjs
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
