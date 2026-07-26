# Realtime Worker — Cloud Run 배포 (docs/02 §5)
# min-instances=1 권장: 콜드 스타트가 봇 입장 지연이 되면 UX가 무너진다.
FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml package.json ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter worker...

COPY packages ./packages
COPY apps/worker ./apps/worker

ENV PORT=8080
EXPOSE 8080
CMD ["pnpm", "--filter", "worker", "start"]
