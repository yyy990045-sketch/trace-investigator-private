# TRACE 公网部署（Docker + Caddy）

本目录是在一台具备持久磁盘的 Linux 主机上，把 Runtime 与前端跑成「可真实联网调查」的公网服务所需的全部文件。

## 组成

| 文件 | 作用 |
|---|---|
| `Dockerfile` | Runtime 镜像：整仓复制 + `npm ci --omit=dev`，`tsx` 直跑 TS 源码，数据卷 `/data` |
| `Web.Dockerfile` | 前端镜像：构建 `@personal/trace` 静态产物，交给 Caddy |
| `Caddyfile` | 站点配置：静态托管 + `/api/*` 反代到 `runtime:4313` + SPA 回落 |
| `docker-compose.yml` | 两个服务 + 持久卷 + 日志轮转 + 健康检查 |

## 一、服务器目录约定

```
/opt/trace/
├── app/              # 仓库源码（rsync 上传，含 deploy/）
├── data/             # SQLite + 档案文件（持久卷，容器重建不丢）
├── caddy-data/       # Caddy 数据
├── docker-compose.yml
└── .env              # 服务端密钥与配额，权限 600，不提交仓库
```

## 二、必需的环境变量（写进 `/opt/trace/.env`）

```
PLATFORM_PUBLIC=1
PLATFORM_PORT=4313
PLATFORM_DATA_DIR=/data

# 访问控制与成本闸门
PLATFORM_ADMIN_TOKEN=<随机长串>
PLATFORM_SESSION_RUNS_PER_DAY=3
PLATFORM_IP_RUNS_PER_DAY=12
PLATFORM_SESSION_CONCURRENT_RUNS=1
PLATFORM_DAILY_RUN_BUDGET=100
PLATFORM_DAILY_SEARCH_BUDGET=300
PLATFORM_RUN_MAX_SEARCHES=8
PLATFORM_RUN_TIMEOUT_MS=300000
# 等待人工确认超过30分钟会自动取消并保留审计记录
PLATFORM_APPROVAL_WAIT_TIMEOUT_MS=1800000
PLATFORM_REQUESTS_PER_MINUTE=90
PLATFORM_SESSIONS_PER_HOUR_PER_IP=10

# 元宝搜索与模型（只在服务端）
PLATFORM_WSA_ENABLED=true
PLATFORM_WSA_API_KEY=...
PLATFORM_WSA_ENDPOINT=https://api.wsa.cloud.tencent.com/SearchPro
PLATFORM_TRACE_FETCH_ENABLED=true
PLATFORM_MODEL_ENABLED=true
PLATFORM_MODEL_BASE_URL=https://api.deepseek.com
PLATFORM_MODEL_NAME=deepseek-flash
PLATFORM_MODEL_API_KEY=...
```

## 三、部署

```sh
# 1. 上传源码（排除 node_modules / data / .git）
rsync -az --exclude node_modules --exclude .git --exclude data \
  -e ssh ./ user@host:/opt/trace/app/

# 2. compose 文件放在 /opt/trace（构建上下文指向 ./app）
cp /opt/trace/app/deploy/docker-compose.yml /opt/trace/docker-compose.yml

# 3. 构建并启动
cd /opt/trace && docker compose build && docker compose up -d

# 4. 自检
curl -s http://127.0.0.1:8081/api/v1/health
curl -s -H "x-admin-token: $PLATFORM_ADMIN_TOKEN" http://127.0.0.1:8081/api/v1/admin/metrics
```

## 四、HTTPS 的两种方式

**正式长期交付请使用 [命名隧道和固定域名操作手册](stable-tunnel.md)。** 临时 `trycloudflare.com` 域名仅用于短期演示，重启会变化。

1. **已备案域名**：把 `Caddyfile` 的站点地址从 `http://:80` 改成你的域名，并加上 `tls { email ... }`，Caddy 会自动签发证书；compose 里把 `80:80`、`443:443` 暴露出去。
2. **未备案域名（当前用法）**：直接对外开放 80/443 会被云厂商拦截校验，因此只在容器内监听 `:80`（宿主 `127.0.0.1:8081`），由前置隧道终止 TLS：

```sh
docker run -d --name trace-tunnel --restart unless-stopped --network host \
  cloudflare/cloudflared:latest tunnel --no-autoupdate --url http://127.0.0.1:8081
docker logs trace-tunnel 2>&1 | grep -o "https://[a-z0-9-]*\.trycloudflare\.com" | head -1
```

> 临时隧道地址在容器重启后会变化。当前正式 compose 配置已收紧为 **只监听 127.0.0.1:8081**，不再对外暴露宿主 80/443。固定域名交付请按 [stable-tunnel.md](stable-tunnel.md) 操作。

## 五、运维

```sh
cd /opt/trace
docker compose ps                 # 状态
docker compose logs -f runtime    # 运行日志
docker compose up -d --build runtime   # 改代码后重建
sqlite3 data/platform.sqlite "select id,status,created_at from runs order by created_at desc limit 5"  # 需装 sqlite3
```

`runtime` 启动时会先删除 `/data/runtime.lock`（该卷只挂给这一个容器），否则容器重建后旧 PID 会误判为「已有进程占用」。
