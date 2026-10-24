# TRACE V16 固定域名交付｜Cloudflare 命名隧道

## 为什么必须更换

当前 `*.trycloudflare.com` 是临时演示隧道，进程重启会更换随机地址，无法作为持续可访问的正式投稿链接。
此问题不是 Runtime 代码缺陷，必须绑定有权限管理的 Cloudflare 域名。稳定域名部署不需要把腾讯云主机的 80/443 对公网开放。

## 用户需要做的唯一外部授权

1. 使用自己的 Cloudflare 账号，添加一个**本人可以管理、已接入 Cloudflare DNS**的域名。没有域名时先完成域名准备。不要把账号密码、域名管理令牌、Tunnel Token 通过聊天发送。
2. 打开 Cloudflare **Networking → Tunnels → Create Tunnel**，命名为 `trace-live`。
3. 在该隧道下 **Routes → Add route → Published application**，设置一个固定子域名（如 `trace.example.com`，必须替换为自己的域名），后端目标填 `http://localhost:8081`。
4. 获取这个命名隧道的 `TUNNEL_TOKEN`；仅写入服务器 `/opt/trace/tunnel.env`，内容为 `TUNNEL_TOKEN=...`，权限 `chmod 600`。**不要提交仓库**。

## 服务器操作（用户已授权的服务器，由本机执行方运行）

只在新域名和路由配置都完成后执行：

```bash
# 先确保当前 V16 服务健康、Docker 端口仅限回环。
cd /opt/trace
docker compose ps
docker compose config
curl -fsS http://127.0.0.1:8081/api/v1/health

# 新增一个命名隧道容器，先与老临时隧道并行，不中断现有演示地址。
test -f /opt/trace/tunnel.env
chmod 600 /opt/trace/tunnel.env
docker run -d --name trace-tunnel-stable --restart unless-stopped \
  --network host --env-file /opt/trace/tunnel.env \
  cloudflare/cloudflared:latest tunnel --no-autoupdate run

docker logs --tail 40 trace-tunnel-stable
```

**注意：** 以上是执行步骤，不能将它们当作已执行。部署修改的 Docker Compose 端口配置后，应重建 `web` 容器并用 `docker ps`、`ss -ltn` 核对 80/443 未对公网监听；若同机有其它业务依赖这些端口，先核对后操作，不能贸然覆盖。

## 正式验收

- 使用浏览器无登录访问新的 HTTPS 域名，刷新和深链都可以正常打开。
- 新浏览器开启会话 → 真实搜索 → 证据 → 人工确认 → 档案下载；只使用一次真实查询即可验证，不消耗大量查询预算。
- 两种会话交叉访问历史运行应被拒绝；无令牌读取运行数据得到 401；达到配额时展示正确文案。
- 公共目录不泄露密钥/内部地址；后台 `/api/v1/admin/metrics` 不带令牌返回拒绝，带管理员令牌可看到真实用量和判定类型分布。
- **重启 `trace-tunnel-stable` 后固定 HTTPS 域名保持不变**（URL 固定，短暂重连可以接受）。
- 验收成功后才替换参赛表单/交付文档中的临时地址，停止旧 `trace-tunnel`（不要先停旧隧道）。
- 保留 V15 的静态 Vercel 地址作为演示与故障时的兜底，清楚标识为历史回放。

## 故障处理

- 固定域名无法访问：先检查 Cloudflare DNS/路由、命名隧道状态、`docker logs trace-tunnel-stable`、`curl http://127.0.0.1:8081/api/v1/health`。不要临时打开无鉴权的 Runtime 4313。
- 域名仍在备案限制下：请核对 Cloudflare DNS、边缘代理及本地主机回环端口状态；避免声称任意方式可以规避所在地法规。
- 没有域名或 Cloudflare 权限：继续保留原公网静态演示，同时**明确标注固定实时入口未完成**。不伪造固定 URL 或编造已通过测试。

官方操作说明：https://developers.cloudflare.com/tunnel/get-started/
