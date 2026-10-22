# Personal AI Capability Platform 0.3.0

0.3.0历史基线见 [0.3.0最终验收说明](docs/0.3.0-final-acceptance.md)。本轮CAP-08使用体验、第二项目复用与390px实际操作结果见 [后续交付记录](docs/2026-10-22-cap08-usable-reuse.md)；模型仍待本地私密配置。

本机单用户能力装配与执行工作台。Studio、独立Agent应用和独立商业应用共享真实SQLite运行记录，未使用固定演示记录冒充执行。模型未配置，AI核验尚未验收。

## 启动与使用

需要Node.js24以上。

```sh
cd /Users/xieweikai/Projects/personal-ai-capability-platform
npm ci
npm run start:local
```

- Studio http://127.0.0.1:4310 ：新建项目、检索能力、保存组合、上传资料、执行。
- Agent http://127.0.0.1:4311 ：真实任务、当前步骤、输入输出、证据、取消/拒绝/审批。
- 商业应用 http://127.0.0.1:4312 ：资料对象、待确认事项、成果与下载。
- Runtime http://127.0.0.1:4313/v1/health ：本机Fastify服务。

先创建项目，在能力库检索CAP编号或Runtime ID。选择目标项目后加入能力，配置执行顺序/权限并保存。标准组合可直接上传 `examples/authorized-inputs/资料处理测试.txt`，勾选本机处理授权，执行后停在人工确认。审阅来源后批准生成真实Markdown和JSON文件；拒绝或取消不会生成正式交付。冲突和范围拒绝样例在同一目录。项目/步骤/审批/证据保存在 `data/platform.sqlite`；停止服务不会删除历史记录。

## 源码边界

```text
apps/studio                   项目/能力装配管理，自有路由
apps/agent-example            任务工作区，自有 /new /missions/:runId /sources
apps/business-example         成果工作区，自有 /intake /deliverables/:runId /materials
packages/app-shell            配置式导航、路由容器、主题，不定义业务路由
packages/ui-core              基础组件、状态和设计令牌
packages/agent-ui              真实执行表单、过程/步骤/证据交互
packages/business-ui           成果、引用、审批与交付交互
packages/capability-sdk        Schema/状态契约、版本化装配与HTTP SDK
services/runtime              注册、SQLite、执行、审批、Provider、文件生成
services/runtime/plugins      受信任本地能力扩展
 templates/agent-app           独立Agent应用模板
 templates/business-app        独立商业应用模板
 tooling/create-app.mjs        应用生成器，拒绝覆盖已有应用
```

## 已有能力与真实边界

所有下列版本为1.0.0，实时可用性及验收运行由 `/v1/catalog` 返回，前端不写死“已验收”。

|Runtime能力|用途|历史关系|
|---|---|---|
|documents.parse|UTF-8 txt/md/json实际解析|平台新实现|
|documents.scope-check|资料范围、重复ID、来源、冲突核验|CAP-04设计参考，独立实现|
|knowledge.search|本次上传资料词项检索与来源引用|CAP-02接口设计参考，新本地Provider|
|evidence.record|SQLite证据、内容摘要|CAP-01设计参考，独立实现|
|runtime.snapshot|真实持久化状态读取|CAP-08设计参考，独立实现|
|human.confirm|输入摘要绑定的人工决定|新实现，未复用历史shadow gate|
|report.export|确认后生成Markdown和JSON文件|平台新实现|
|text.metrics|独立插件计算资料字符数|扩展接口验证|
|model.verify|明确配置后的真实OpenAI兼容调用|当前缺模型配置，不可用|
|knowledge.remote.search|历史远端RAG接口|未适配、未授权，不可用|

CAP-01/04/08只复用设计语义，没有复制历史代码；本地词项检索不是历史RAG接通或向量搜索。未形成运行Adapter的CAP/UI登记仅保留来源，不能执行。历史ID和Runtime ID独立，来源映射包括正式登记源摘要、文件路径/提交锚点、当前文件摘要、Adapter和关系类型。

## 新能力接入

在 `services/runtime/plugins/` 新增导出 `CapabilityDefinition` 的 `.ts` 文件，声明精确版本、协议、输入/输出/配置JSON Schema、权限、副作用和执行函数。参考 `text-metrics.ts`。重启Runtime后由注册器发现，不修改Engine。每步输出传给下一步，协议/配置/权限/依赖不符会阻止执行。

插件是受信任本机代码，拥有Node进程权限，不是可运行不可信代码的沙箱。禁止把任意下载模块直接放入插件目录。受控ctx.model和ctx.artifact额外检查声明、运行授权与审批；取消后拒绝晚到上下文访问，关闭SQLite前等待受控异步操作清理。任意插件直接系统调用无法由AbortSignal强制终止；外部写入若结果未确认，状态为失败且标明结果不确定，不称已取消，禁止直接重试。

审批默认绑定步骤和输入哈希。显式 `approvalScope: delivery` 表示同一输入的交付授权，可从人工确认传给报告导出；受信任插件若声明此范围也加入此授权范围。外部写入始终要求项目external:write权限和该步骤自己的确认。审批人的文字是本机操作者自述，不是认证身份；当前不提供多用户鉴权，不可直接公网暴露。

## 新应用和业务模块

```sh
npm run create:app -- agent my-agent --port 4316 --title 我的任务应用 --project-id project_UUID
npm install
npm run build --workspace @personal/my-agent
npm run dev --workspace @personal/my-agent
```

商业应用把agent换成business。应用各自拥有导航、主题、路由和dist构建，使用同一SDK；固定项目ID后只读写该项目的运行页面。`apps/agent-example/src/modules/sources.tsx` 是应用自有模块示例：新增路由和模块不改Shell或Engine。生成器只新增apps目录；npm install更新工作区链接及lockfile。当前为monorepo内独立构建与部署，不声称共享包已可脱仓发布。静态部署需配置HTML深链回退及Runtime代理，但本阶段不部署公网。

## 2026-10-22 本机适配补充

本轮已建立原版0.3.0安全Git基线，并将CAP-08纯状态转换原算法通过独立插件 `workflow.transition-check@1.0.0` 接入现有Runtime。Studio可选装配，独立Agent创建任务、Business同run确认并下载真实报告；示例为 `examples/authorized-inputs/工作流轨迹测试.json`。仅本轮授权私人本机复用，不代表旧派发系统或外部服务已迁移。

完整来源、8次新运行、备份校验和真实阻塞见 `docs/2026-10-22-local-capability-integration.md`。父会话后续已获准通过原生CUA选择Ego Lite，完成Studio来源详情、Agent完成结果、Business同run交付结果的可见桌面截图及看图；清单见受限的 `data/local-integration-20261022/screenshots/manifest.json`。三文件沿用.png文件名，但文件头实际为JPEG，原文件未转换或覆盖；不是1440×900或390px定尺截图，不代表整体UI设计验收。**模型缺配置、390px手机视觉仍未验收，整体部分完成**。父会话重启的四服务已只读核对PID/cwd及health，本次未重启或终止服务。旧0.3.0结果原样保留。

## 当前平台模型配置

复制 `.env.platform.example` 为 `.env.platform`，填写当前平台明确授权的OpenAI兼容地址、模型、密钥，并启用。启动命令只加载此文件，不读历史项目凭证。把model.verify加到检索之后/确认之前，授予model:invoke与data:external权限；执行时还必须勾选本次资料外发授权。实际返回、耗时、请求摘要与错误写入model_calls。默认无配置即阻止AI步骤执行，不生成替代AI结果。当前交付只验收规则流程，AI验收明确阻塞。

## API与恢复

SDK在 `packages/capability-sdk/src/runtime.ts`；API实现见 `services/runtime/src/app.ts`。完整接口与持久化说明见 `services/runtime/README.md`。

等待审批的任务重启后保留，可继续确认；执行中意外中断会标失败，不能假定成功或盲目重放。项目更新采用revision冲突校验；执行也提交页面确认的revision。失败任务若项目已变化，必须重新核对组合创建新运行。

工程辅助检查：`npm run typecheck`、`npm run test:runtime`、`npm run build`。真实浏览器验收使用可见WebKit，证据和截图见本次交付目录；测试通过不代替实际产品审阅。


## 0.3.0收尾整合说明（2026-10-22）

正式源码仍是当前目录，三个默认应用均使用真实Runtime SDK。前端审阅目录是历史设计对照，不是第二套正式平台；未整体覆盖源码或数据。

- Studio以真实项目为上下文，模块入口、能力选择和装配保存使用SQLite项目与revision；Agent步骤主从和Business顶部模块分别复用共享底座。
- 中文本地检索使用Unicode词项/中文二元词的加权覆盖率，仅为词项相关度。空问题不执行检索，不把所有资料赋满分。
- JSON资料必须显式包含非空source；声明source指向document id。相同规范化事实键有不同值时阻止交付，不能关闭。声明值需见于指定来源原文；这是字面一致性规则，不证明资料真实或语义正确。无claims时显示未核验，不能表述为已验证无冲突。
- 输入文件数与段落记录数区分：一次上传1个文件，解析出N条资料记录；检索引用数另计。
- 新导出的JSON含generatedAt和intermediateExecutionSnapshot；该快照可能为running，描述的是当时执行状态，不是交付最终状态。只有真实运行completed后才能下载正式文件。
- 新增只读下载 `/v1/runs/:id/receipt`。它核对SQLite最终状态、run.completed事件、report.export对应step.completed事件、批准记录和文件摘要后，输出最终运行凭证。凭证含生成时间与最终状态时间，不重写原报告；是本机审计记录，没有外部签名。
- 历史运行及原文件保持不变。旧实现创建的待确认任务仍可读取；继续执行会受能力实现摘要门禁约束，变更后需重新核对并创建新运行，不能强行沿用旧审批。

当前没有 `.env.platform` 授权模型配置，真实AI验收为BLOCKED_MODEL_NOT_CONFIGURED。配置应由操作者在本项目按 `.env.platform.example` 创建：明确启用、OpenAI兼容HTTPS地址（通常以/v1结尾）、模型名和密钥，再重启Runtime。禁止从历史项目取密钥；不要在终端输出或提交密钥。将model.verify置于检索之后/人工确认之前，并授予model:invoke、data:external，任务表单还需本次外发授权。模型返回仅接受JSON summary/verdict/citations，supported必须有提供过的引用；引用存在也不等于语义结论正确，仍需人工审阅。

`checks/integration-quality.test.ts` 内的本机合成响应只检查Provider协议、错误、超时、取消与Schema，不是真实AI验收。实际规则记录由 `checks/acceptance-integration.mjs` 创建，浏览器操作由 `checks/browser-integration.cjs` 复现，均使用标记清晰的授权合成资料，不读取客户或历史生产数据。重复运行会新增标记的验收项目与运行记录。
