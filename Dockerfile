FROM node:24-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM base AS build
COPY package.json pnpm-lock.yaml tsconfig.json ./
RUN pnpm install --frozen-lockfile
COPY src ./src
RUN pnpm build

FROM node:24-slim AS runtime
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=deps  /app/node_modules ./node_modules
COPY package.json ./
COPY data/people.db ./data/people.db
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "dist/index.js", "serve"]
