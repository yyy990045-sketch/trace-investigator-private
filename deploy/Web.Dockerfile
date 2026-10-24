# 前端镜像：构建 @personal/trace 静态产物，交给 Caddy 托管并反代 /api。
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN npm ci
# 公网版本走同源 /api（Caddy 反代到 runtime:4313），不写死任何域名。
ENV VITE_RUNTIME_API_URL=/api
RUN npm run build --workspace @personal/trace

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/trace/dist /srv
EXPOSE 80 443
