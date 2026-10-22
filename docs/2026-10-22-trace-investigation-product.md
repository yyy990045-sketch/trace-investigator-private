# 溯证 TRACE｜1024 侦探赛道交付记录

基线：`772a42c`（在 `e1e7ef3` 之后的能力改进版本之上开发）。本轮没有重建通用框架，也没有改动 17 个历史项目、物流工作台或 Portfolio 原始登记。

## 一、这一轮做出了什么

一个独立应用 `apps/trace`（端口 4316），加上五个调查能力插件和一个元宝搜索服务端适配器。
调查闭环在真实 Runtime 上跑通：**立案 → 事实与检索式确认 → 多轮真实检索与原文取证 → 证据核验与保守结论 → 人工确认 → 调查档案导出**。

| 能力 | 作用 | 复用的公共部分 |
|---|---|---|
| `trace.case.intake` | 规范化问题、待核查说法、人工确认的事实与检索式 | 上传契约 + 证据表 |
| `trace.facts.confirm` | 校验/合并检索式、冻结检索预算与检索配置快照 | 证据表 |
| `trace.web.search` | 调元宝搜索 SearchPro，逐条记录请求，抓取原文正文 | 证据表、步骤超时与取消 |
| `trace.evidence.verify` | 同源转载合并、支持/反对判定、保守结论 | 证据表 |
| `human.confirm`（既有） | 人工确认节点，审批绑定输入摘要 | 完全复用，未改写 |
| `trace.archive.export` | 生成可下载的 `调查档案.md` / `.json` | 审批范围、SHA-256 文件写入、最终凭证 |

公共运行时只做了两处最小适配（无框架重构）：

1. `uploadSchema` / `UploadInput` 增加可选 `payload`（结构化案件）与 `dataConsent`（外发检索授权）；
2. `engine.createRun` 的外发授权判定：发往模型看 `modelConsent`，发往外部检索服务看 `dataConsent`。

`/v1/catalog` 增加 `tencent-wsa-search` provider 条目，前端只读可用性，永远拿不到密钥。

## 二、元宝搜索接入（官方契约）

来源：<https://cloud.tencent.com.cn/document/product/1806/130615>、<121799 购买方式>、<121804 常见问题>。

- `POST https://api.wsa.cloud.tencent.com/SearchPro`，`Authorization: Bearer sk-...`，请求体 `{"Query":"..."}`。
- 响应 `{"Response":{"Pages":[...],"Query":"...","RequestId":"..."}}`，**`Pages` 每一项都是被二次序列化的 JSON 字符串**（`passage/score/date/title/url/site/images/favicon`）。适配器做第二次 `JSON.parse`，解析失败的条目计为 malformed 而不是丢弃整次响应。
- 错误码映射：`UnauthorizedOperation → SEARCH_UNAUTHORIZED`、`ResourceNotFound → SEARCH_NOT_OPENED`（未开通）、`ResourceUnavailable → SEARCH_QUOTA_UNAVAILABLE`（欠费）、`RequestLimitExceeded → SEARCH_RATE_LIMITED`（指数退避重试）、`InternalError → SEARCH_PROVIDER_ERROR`；另有 `SEARCH_TIMEOUT`、`SEARCH_NETWORK_ERROR`、`SEARCH_RESPONSE_INVALID`。
- 密钥只从进程环境读取（`PLATFORM_WSA_API_KEY`），不写日志、不回传前端、不落盘。
- 官方口径：QPS 20（极速版/标准版）、平均时延 600–800ms、P99 约 1200ms、**不含微信公众号内容**。因此适配器默认串行检索并留 350ms 间隔，且产品不承诺覆盖公众号。

### 邀请码福利与额度的实际关系（不自行假定）

官方「购买方式」与「常见问题」文档未记载邀请码福利与账户额度的换算或叠加关系，因此：

- 代码与界面**不假设**任何邀请码已领取、已激活或已产生额度；
- 唯一判据是接口的真实返回：未开通显示 `SEARCH_NOT_OPENED`，欠费/额度不足显示 `SEARCH_QUOTA_UNAVAILABLE`；
- 需要人工在腾讯云控制台确认服务状态与资源包余量，产品不自造结论。

## 三、当前阻塞（必须如实说明）

本机没有配置 `PLATFORM_WSA_API_KEY`（也不存在 `.env.platform`），因此：

- `/v1/catalog` 的 `tencent-wsa-search.available = false`；
- 调查入口显示「联网检索当前不可用」并**禁用开始按钮**（不会假装开始）；
- 若以 API 直接发起运行，`trace.web.search` 会以 `SEARCH_NOT_CONFIGURED` 失败，运行状态为 `failed`，不会产生任何来源或结论；
- **A/B/C 三个真实案例、真实来源与调查档案尚未产出**，因为唯一能产出它们的路径是真实调用元宝搜索。

复现这一状态（本机已实测）：

```
状态 failed｜trace.case.intake completed｜trace.facts.confirm completed
trace.web.search failed SEARCH_NOT_CONFIGURED
"未配置 PLATFORM_WSA_API_KEY。…在此之前不执行联网检索，也不给出联网结论。"
```

## 四、可靠性设计（为什么不会把命中当真相）

- **独立来源**：同站同内容、跨站高度雷同（分片 Jaccard ≥ 0.55）、同段摘要前缀相同者合并为一个来源簇；同簇只算一条独立证据，并在界面标注「与 cluster-N 同源，不计入独立证据」。
- **原文依据**：支持性来源必须至少一条取得原文正文（去标签后的页面文字），否则结论降级为「只有搜索摘要，缺少原文依据」→ `insufficient`。
- **时效**：事实可指定 `timeScope`，来源发布时间不在范围内即 `out_of_range`，不计入支持性来源。
- **主体/地区**：`subjectScope` 未在来源中出现时显式记录「适用性存疑」。
- **矛盾**：同一来源出现否定表述（不是/并非/不实/辟谣…）或数值与事实冲突时判为反对；同时存在支持与反对 → `disputed`，不单方面下结论。
- **结论类型**只有五种：有依据支持 / 存在反证 / 存在争议 / 信息过期或原文不足 / 证据不足；每种都带理由，且「证据不足」时明确拒绝下结论。
- **原文抓取安全**：仅 http/https、DNS 解析后拒绝环回/私有网段/链路本地地址、手动跟随重定向并逐跳校验、限制字节数与时长。

## 五、验证方式与结果

自动化（`npx vitest run`，42/42 通过，其中 11 条为本轮新增）：

- `checks/trace-pipeline.test.ts`
  - 未配置密钥 → `SEARCH_NOT_CONFIGURED` 且零网页；
  - 二次序列化 `Pages` 正确解析，URL/时间/passage 原样保留；
  - 429 限流退避重试成功，`attempts ≥ 2`；
  - `UnauthorizedOperation` 映射为 `SEARCH_UNAUTHORIZED`，不是空结果；
  - 无结果与失败是两种状态；
  - 原文抓取拒绝环回地址；
  - 雷同转载合并为同一来源簇；只有摘要 → `insufficient`；两独立来源+原文 → `supported`；出现相反说法 → `disputed`；
  - 端到端：真实 `createPlatform` 跑完立案→检索→核验→人工确认→导出，产出 `调查档案.md`，内容含真实来源 URL。

本地真实运行（同一台机、同一 Runtime）：

- `GET /v1/health` → `{"status":"ok"}`；`/v1/catalog` 列出 5 个 trace 能力；
- 通过 API 真实立案并执行，得到上文「当前阻塞」里那条真实失败记录；
- 截图：`docs/screenshots/`（1440×900 与 390×844 各一张，均为该真实状态）。

## 六、可下载档案

档案只在人工确认通过、导出步骤真实执行后生成（`requiresApproval` + `approvalScope: delivery`），写入 `data/artifacts/<runId>/`，记录 SHA-256 与字节数，可通过 `GET /v1/runs/:id/artifacts/:artifactId` 下载，最终状态以 `GET /v1/runs/:id/receipt` 为准。
本轮因密钥缺失，没有生成真实档案文件——不提供替代品。

## 七、密钥就绪后的验收步骤（一条命令）

```sh
cd /Users/xieweikai/Projects/personal-ai-capability-platform
cp .env.platform.example .env.platform      # 在 PLATFORM_WSA_API_KEY 后填入 sk-...
npm run runtime                              # 重启 Runtime 使配置生效
node tooling/trace-acceptance.mjs            # 跑 A/B/C 三案例
node checks/trace-screenshots.mjs http://127.0.0.1:4316 <runId>
```

`trace-acceptance.mjs` 会真实立案、等待人工确认、以「验收脚本」身份记录批准、下载档案，并把每个案例的检索请求（query/RequestId/HTTP/结果数/耗时/重试/错误）、来源网址、逐条事实判定、结论与文件路径写入 `data/trace-acceptance/<case>/acceptance.json` 与 `summary.json`。检索不可用时脚本以退出码 2 终止并打印阻塞原因，不产出任何伪造记录。

## 八、未完成与已知边界

- 未配置模型：事实拆解只能人工确认，界面与档案均标注「人工确认，未使用 AI 拆解」，不显示为 AI 已完成。
- 未接入模型对结论做二次复核；`model.verify` 保持原状（未配置即不可用）。
- 只覆盖文字与网页线索；官方不含微信公众号内容，产品也不承诺覆盖。
- 原文抓取对脚本渲染页面、付费墙、需登录页面会失败，此时按「只有搜索摘要」处理并在档案里写明。
- 检索上限：单次调查最多 6 条事实、12 条检索式、抓取 6 个网址原文（可在项目装配里调整上限内的值）。
- 不支持多用户鉴权，Runtime 只监听本机；不可直接公网暴露。
