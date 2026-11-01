# Two stages: compile TypeScript with the dev tools, then ship only compiled JS + production dependencies.
FROM docker.io/library/node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM docker.io/library/node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
COPY openapi.yaml ./
USER node
EXPOSE 8000
# 1) apply database migrations  2) load demo data (only when SEED_ON_START=true)  3) serve.
# A failed migration stops the container before the API starts. `exec` lets SIGTERM reach Node for a graceful shutdown.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/scripts/seed.js && exec node dist/server.js"]
