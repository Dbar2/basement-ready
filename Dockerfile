# Basement Ready: web + API + scan worker in one image. ffmpeg does the video work.
FROM node:24-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

ENV NODE_ENV=production
EXPOSE 8080
CMD ["pnpm", "start"]
