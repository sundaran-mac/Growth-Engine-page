# syntax=docker/dockerfile:1.7
# Growth Desk web: Vite build served by nginx, /api proxied to the api service.

FROM node:22-alpine AS manifests
WORKDIR /src
COPY . .
RUN find . -path ./node_modules -prune -o -type f ! -name package.json ! -name package-lock.json -print | xargs rm -f \
 && find . -type d -empty -delete

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=manifests /src ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace @growth-desk/web --workspace @growth-desk/contract --include-workspace-root --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/contract ./packages/contract
COPY apps/web ./apps/web
# Same-origin API through nginx, so the browser calls /api/v1.
ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build -w @growth-desk/contract && npm run build -w @growth-desk/web

FROM nginx:1.29-alpine AS runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
