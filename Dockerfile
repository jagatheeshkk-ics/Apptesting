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

# --workspaces --include-workspace-root: some build environments (seen on
# Render) set an implicit npm workspace scope, which makes a bare `npm ci`
# fail with "Include the workspace root when workspaces are enabled for a
# command." These flags make the intent explicit regardless of environment:
# install every workspace (server, web) plus the root, unconditionally.
RUN npm ci --workspaces --include-workspace-root

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "server/dist/index.js"]
