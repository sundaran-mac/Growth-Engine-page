# syntax=docker/dockerfile:1.7
# Growth Desk API and worker image (same image, different command).

# 1. Only the package manifests, so the npm install layer stays cached until a manifest changes.
FROM node:22-alpine AS manifests
WORKDIR /src
COPY . .
RUN find . -path ./node_modules -prune -o -type f ! -name package.json ! -name package-lock.json -print | xargs rm -f \
 && find . -type d -empty -delete

# 2. Install the API and contract workspaces (plus root dev tools for the build).
FROM node:22-alpine AS deps
WORKDIR /app
COPY --from=manifests /src ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace @growth-desk/api --workspace @growth-desk/contract --include-workspace-root --no-audit --no-fund

# 3. Build contract then API to plain JavaScript.
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/contract ./packages/contract
COPY apps/api ./apps/api
RUN npm run build -w @growth-desk/contract && npm run build -w @growth-desk/api

# 4. Production dependencies only.
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY --from=manifests /src ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --workspace @growth-desk/api --workspace @growth-desk/contract --no-audit --no-fund

# 5. Runtime.
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/packages/contract/package.json ./packages/contract/package.json
COPY --from=build --chown=node:node /app/packages/contract/dist ./packages/contract/dist
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/drizzle ./apps/api/drizzle
WORKDIR /app/apps/api
USER node
EXPOSE 4000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
