FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/dashboard ./apps/dashboard

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @split402/dashboard... build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/dashboard ./apps/dashboard

RUN pnpm install --prod --frozen-lockfile

USER node
EXPOSE 4027

CMD ["node", "apps/dashboard/dist/index.js"]
