# TRACE 公网运行时镜像。
#
# npm workspaces 必须整仓复制才能解析依赖（workspace 声明在根 package.json）。
# 构建上下文由根目录 .dockerignore 收窄，排除 node_modules、data 与交付素材。
FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PLATFORM_PORT=4313 \
    PLATFORM_DATA_DIR=/data

WORKDIR /app

COPY . .

# 只装运行时依赖：runtime 通过 tsx 直接执行 TS 源码，tsx 是它的 dependency。
RUN npm ci --omit=dev

RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 4313

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PLATFORM_PORT||4313)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "tsx", "services/runtime/src/server.ts"]
