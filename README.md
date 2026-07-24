This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Chạy bằng Docker Compose

Compose chỉ dựng service `app`; Postgres là container có sẵn ở stack khác, app join vào network của nó.

1. Copy `.env.example` thành `.env` rồi điền:
   - `DB_NETWORK` — tên network mà container Postgres đang nằm trong đó:
     `docker inspect -f '{{json .NetworkSettings.Networks}}' <ten-container-postgres>`
   - `DB_HOST` — **tên container Postgres**, không phải `localhost`.
   - `AUTH_SECRET`, `ENCRYPTION_KEY` — sinh theo hướng dẫn trong `.env.example`.
2. `docker compose up -d --build`

Entrypoint chạy `prisma migrate deploy` trước khi khởi động Next. Nếu DB chưa sẵn sàng, container sẽ thoát và `restart: unless-stopped` thử lại.

Ollama chạy trên máy host thì điền endpoint là `http://host.docker.internal:11434` trong phần cài đặt AI.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
