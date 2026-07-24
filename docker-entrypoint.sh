#!/bin/sh
set -e

echo "▶ prisma migrate deploy..."
node ./node_modules/prisma/build/index.js migrate deploy

echo "▶ starting Next.js (node server.js)..."
exec node server.js
