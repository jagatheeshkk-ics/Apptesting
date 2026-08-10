# Base image ships Chromium + all its system libraries preinstalled, matching
# the exact Playwright version pinned in server/package.json — keep these in
# sync (bump both together) or the browser binary won't match the driver.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

WORKDIR /app

# Install deps first so this layer is cached unless a package.json/lockfile/
# schema changes. server/prisma is needed here too since `npm ci` triggers
# the server's postinstall (`prisma generate`), which needs schema.prisma.
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY server/prisma server/prisma
COPY web/package.json web/package.json

# `prisma generate` (server's postinstall) reads schema.prisma's env("DATABASE_URL")
# / env("DIRECT_URL") references — it only needs *some* value at build time, not
# a reachable database. The real values are injected by the hosting platform at
# container runtime and override these.
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
ENV DIRECT_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"

RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "server/dist/index.js"]
