# TRACE 线上实时调查｜上线门槛和真实验收

本文件只定义产品使用能力的验收；与报名、提交材料无关。

## 当前实现

- 前端主页：当 `GET /api/investigate` 返回 `live: true` 时，允许输入新问题。
- `/#/live`：提交 → 真实 SearchPro → 原文抓取/规则核验 → 相关来源、出处、缺证据项 → 追加搜索 → JSON 导出。
- 查询与证据来源只有服务端返回；历史 V14 回放继续作为独立示例。
- 服务器无数据库。追加查询使用短期 HMAC 签名证据记录，浏览器标签页可恢复。
- 每次匿名提交消耗调用额度，限 IP 每小时5次、全站每天100次，最多3轮；达到限制会明确报错。

## 服务器必备配置（必须配置在 Vercel 项目 Environment Variables，不写在 GitHub）

| 变量 | 设置方式 |
| --- | --- |
| `PLATFORM_WSA_API_KEY` | 腾讯云元宝 SearchPro 的正式服务密钥（Secret） |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis HTTPS REST Endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | 对应只供服务端使用的 Redis Token（Secret） |
| `TRACE_SNAPSHOT_SECRET` | 使用安全随机数生成的至少32字符服务端签名密钥（Secret） |
| `TRACE_PUBLIC_ORIGIN` | `https://trace-showcase-eight.vercel.app`，无尾斜杠 |

配齐后，后端 `GET /api/investigate` 应返回 `{ "live": true, ... }`。
缺少任意配置则返回 `live:false`，POST 返回 503，前端明确显示当前无法发起联网调查。

**禁止把密钥写进 `VITE_*`、`showcase-data.js`、`vercel.json` 或截图日志。**
公共跨域 Origin 校验只是一道限制，真正的防刷由 Redis 持久额度和全站上限共同承担。上线前核对 Vercel 项目费用与腾讯云 SearchPro 额度。

## 构建 / Vercel 目录

项目的源文件在 `tooling/trace-live-api.ts`；编译好的 `api/investigate.js` 经 `tooling/trace-showcase-refresh.mjs` 生成，不需要放入主仓库。

```bash
npm ci
npm run typecheck
npm run check:frontend
node tooling/trace-showcase-refresh.mjs
node tooling/trace-serverless-smoke.mjs
```

Vercel 部署根目录保持 `delivery/trace-showcase`；该目录生成 `vercel.json` 和 `api/investigate.js`。确认项目归属、生产别名及环境变量后，再从同一目录做预览部署，不能绕过已有的脱敏审计。

注意：本仓库 CI 默认不持有真实 API 密钥，因此只证明代码与安全降级链路；CI 通过不等于线上 SearchPro 已成功调用。

## 必须从浏览器完成的真实验收（未完成之前禁止声称“在线交付”）

1. 匿名打开首页 → 输入**此前未演示过**的一条具体可核查说法 → 点击“发起真实调查” → 进入 `/#/live`。
2. 在服务器/浏览器日志确认真实 SearchPro 请求 ID，结果包含实际 URL、站点、原句以及“正文/摘要”标注；无来源时明确不能定案。
3. 输入新的针对性检索词 → 发生新的元宝请求 → 搜索轮次由1变2 → 证据累计重新评估。审查旧证据未被客户端篡改。
4. 输入“为什么2024年新能源汽车产量有两组不同数字”类问题 → 不把开放式问句硬判为真/假；各来源数字必须能直接打开原始出处，未证实的差异原因必须写未知。
5. 验证查询额度：错误/超额/密钥失效时显示可理解的错误，不给预写结果；不能让匿名请求绕过全站限额。
6. 桌面1440×900和手机390px：内容重点为结论、数字或关键证据、缺证据项与继续追查。没有假按钮、水平溢出或无法打开的来源卡。
7. 导出本次调查 JSON，确认内容对应真实当前检索而非 V14 旧案例。返回首页仍可浏览历史案卷。

## 尚未声称完成

- 生产 SearchPro 调用：需要在可管理的 Vercel 项目配置真实密钥后实测。
- 多主体开放式问题的自动拆解：目前只对明确说法和有数字的来源对照做保守处理；无法归因的问题直接呈现未知。
- 长期云端调查归档与账号体系：尚未提供，当前浏览器会话为短期保存。
- 全领域语义理解与历史经验自主学习：没有此保证。

**发布与实际验收结束前，本功能状态为开发分支上的可运行实现，不能标为生产已交付。**
