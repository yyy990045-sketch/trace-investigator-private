# 2026-10-22 本机真实适配交付记录

## 结论与边界

本轮正式源码只在 `/Users/xieweikai/Projects/personal-ai-capability-platform`；首条终端命令核对逻辑与物理根目录，后续命令均显式指定该目录。保留0.3.0既有架构、界面分工、22次历史运行及8个交付文件，未写入其他项目或Portfolio。没有公网部署、Git远端、推送或全局Git配置修改。

**可使用**：Studio选择并装配CAP-08迁移能力，上传本轮明确授权的非敏感合成资料，执行轨迹核验、本地检索、人工确认及真实报告导出；Agent创建任务，Business审阅同一run，下载报告，再从Agent历史重开。

**不宣称整体验收完成**：真实模型缺配置；Ego页面操作成功，但截图接口持续超时，原生窗口工具也未获准访问Ego。没有得到可查看的截图，桌面/390px视觉交付仍未完成。DOM/页面文本、构建成功均不替代截图或视觉验收。

旧 `docs/0.3.0-final-acceptance.md` 原样保留。本记录补充本轮事实，不覆盖或改写旧结果。

## 原版可恢复基线

所有备份和原始证据位于Git忽略的 `data/local-integration-20261022/`；目录700、文件600。源码备份排除实际.env/密钥、SQLite、上传、运行日志、node_modules、dist及备份目录自身，不递归归档自己。

| 原始备份（相对上述目录） | SHA-256 |
| --- | --- |
| `baseline/source-0.3.0.tar.gz` | `0460c1316a3a3ac94c938ac4b286f172327c46532546c253d15e35f1663789f5` |
| `baseline/platform-0.3.0.sqlite`（一致性备份） | `a8ff2fd2c136c801ff34b1593333f8e82a75b8356daa3aeb181edb99f823fc52` |
| `baseline/artifacts-0.3.0.tar.gz` | `9f73bc1805ed62f138a0fbf17313362bedbf8ac3bfcf024e82cf210fb2b2dc7c` |

- `baseline/source-manifest.json`：115个原源码文件逐文件摘要；macOS `._*`元数据不算源码。
- `baseline/database-rows.json`、`baseline/artifact-manifest.json`：原数据库逐行与8文件摘要。
- 原版提交：`e44134dd6a97dc52fa482228ab9ade0f03cc8f0d`；tree `9f6dc7d5a02a9a59a4e0a41f7c4b142f7ef6d049`。
- 本地标记：`baseline/0.3.0-local-20261022`；实施分支：`codex/local-capability-integration`。
- Git最初被沙箱拒绝；恢复后通过正规逐项审批初始化。从原tar向Git对象/索引重建115个文件，逐项摘要确认后提交，**没有回滚工作区，没有把新适配代码或新增.gitignore规则伪装成原版**。证明见 `baseline/git-baseline-reconstruction.json`。
- 实施提交及完整最终清单见 `evidence/git-final.json` 和本地 `git log`；不把提交本身的哈希写入其自身内容。

恢复时先停止本平台进程并保留当前新增记录；在本项目内新的受限恢复目录解包源码，再按清单校验。SQLite与原产物是分开的恢复材料，不能仅恢复源码就覆盖现存数据，也不能把旧SQLite直接覆盖正在运行的数据库。本轮未执行回滚或覆盖恢复。

安全检查未发现高置信硬编码密钥。data、实际.env、SQLite、上传、日志、密钥扩展名、构建结果不进入Git。秘密扫描仅输出位置/分类，不输出密钥。最终暂存清单及扫描结果与证据摘要存放在受限证据目录。

## 本机服务身份

按现有README的 `npm run start:local` 正规审批启动，只监听127.0.0.1，没有更换端口或放宽主机检查。

| 入口 | 端口 | 核对时PID | 实际cwd（相对正式根） |
| --- | --- | --- | --- |
| Studio | 4310 | 30218 | `apps/studio` |
| Agent任务实验室 | 4311 | 30197 | `apps/agent-example` |
| Business成果工作室 | 4312 | 30221 | `apps/business-example` |
| Runtime | 4313 | 30234 | `services/runtime` |

额度中断后原服务已无监听；本次收尾通过正规审批从正式根重启原四服务，未新增验收运行。`lsof`、`ps`、Runtime health实际结果见 `evidence/preservation-and-listeners.json`、`evidence/health.json`；前次PID证据另存 `evidence/preservation-and-listeners-before-resume.json`。PID是记录时事实，不保证重启后不变。

## CAP-08：真实代码迁移，不是历史系统整体复用

只筛选CAP-01与CAP-08两个登记候选；没有全面调查17项目，也未进一步读取CAP-01项目源码。选CAP-08的纯算法，因源码明确、无网络/数据库依赖、适合可控本机复用。

| 项目 | 本轮事实 |
| --- | --- |
| 原编号/登记名称 | CAP-08，会议纪要派发状态机 |
| 登记源 | Portfolio v0.4.0，SHA-256 `73dc44cfa20519071a31b6af67e7aca0b439cb55facffa655b18105227280e7f` |
| 原始文件（只读） | `/Users/xieweikai/Projects/my-app/src/lib/state-machine.ts` |
| 原提交 | `9b1eb4cdffc612569d2ff25e2a4f62ccee7b7d9a` |
| 原文件摘要 | `ad7ec11cf751b81faab6c0a65d632b8cadea124fe333ba32cba59d4dcaf20ace` |
| 迁移文件 | `services/runtime/adapters/cap08/state-machine.ts` |
| 迁移文件摘要 | `6a4c91ff2314814066111976cfe1f8f959d2981dcd98cd5a7573c1b5e4e64b00` |
| 使用方式 | `code_migration`，不是 `design_reference`、重新实现或旧服务 `runtime_reuse` |
| 独立Adapter/新Runtime ID | `WorkflowTransitionAdapter` / `workflow.transition-check@1.0.0` |
| 权限/许可事实 | 用户本轮明确授权私人本机复用；原项目private，未找到LICENSE，不宣称开源或获得公开分发许可 |

实际迁移原六状态 `PipelineState`、完整 `VALID_TRANSITIONS` 表，以及 `validateTransition`、`isTerminal`、`isSuspended`、`getStateLabel`。原文件定位：13–19、26–33、40–45、52–70行。仅去除注释、调整格式，未迁移无关类型/超时函数。主会话用TypeScript AST打印后比对六个定义，全部与原码一致；见 `evidence/cap08-provenance.json`，不是凭接口名称判断迁移。

适配工作量为一个纯算法迁移文件、一个现有插件接口封装、SDK来源类型、Registry来源状态及Studio来源标签的小范围调整；无新增依赖、Engine分支、新框架或旧服务连接。未迁移Supabase、飞书派发、ASR、定时任务或旧系统审批。原 `runtime.snapshot` 仍是历史设计参考的新实现，不能与新迁移能力混称。

### 输入、输出与失败处理

- 复用现有 `document.bundle.v1` 输入/输出Schema：必需filename/documents/claims；每条document必需id/text/source/scope。通过现有资料解析器上传JSON时须保留 `.json` 扩展名。
- 插件配置Schema严格要求 `documentId`（非空字符串，最长180）、`requireTerminal`（布尔）；不接受额外配置。本项目使用 `{"documentId":"workflow","requireTerminal":true}`。
- 选中唯一document后解析其text为JSON对象；states必须为2–200项、仅含原六状态，每条边实际调用迁移的原 `validateTransition`。
- 成功透传原bundle，增加 `workflowValidation`（CAP编号、迁移摘要、资料id/来源、完整states、转换次数、末态/中文标签、终态/挂起标记）、工作流规则check和 `workflow.transition-checked` 证据。
- 匹配缺失/重复：`WORKFLOW_SOURCE_INVALID`；错误结构/未知状态：`WORKFLOW_TRACE_INVALID`；非法边：`WORKFLOW_TRANSITION_INVALID`并写rejected证据；要求终态而未结束：`WORKFLOW_NOT_TERMINAL`。
- 项目权限：`document:read`、`document:validate`、`evidence:write`；无外部副作用，幂等。文件输出由既有report.export及其权限/确认门控制，不给插件额外文件或网络权限。
- 原算法把FAILED也视为终态，因此 `requireTerminal` **不等于要求成功**。输出明确区分最终状态。核验上传轨迹合法，不证明任何外部工作确实派发或完成。
- 迁移文件摘要进入插件manifest，继而进入Registry实现摘要；验收状态须匹配当前定义摘要且step/run实际完成。当前实现摘要 `f40f57bab33fa2429de630bfdbfab2a2b99bfd817d8ba555d061b63d314ce34c`，不靠前端硬编码已验收。

## 实际运行与产物

Ego任务空间2。真实页面新建项目 `project_38eb755f-0f48-4164-b26b-9087b8fb5593`，名称“本机授权合成验收 · CAP-08 · 20261022”，保存为revision 2：

资料解析 → 范围/冲突核验 → 工作流轨迹核验 → 上传资料检索 → 证据记录 → 执行状态快照 → 人工确认 → 报告导出。

授权示例：`examples/authorized-inputs/工作流轨迹测试.json`。轨迹PENDING → PROCESSING → SUSPENDED_HITL → PROCESSING → SUCCEEDED，共4次转换；检索问题为“工作流 人工介入 挂起 恢复执行”。实际命中instruction资料，保留来源与引用id。是本地词项检索，不是语义RAG或AI置信度。

| 新run ID | 真实入口与结果 |
| --- | --- |
| `run_1f0976fa-81de-4e83-8ee9-6390ea4c1d74` | Studio实际上传执行，Ego代操作批准，completed；2个真实文件 |
| `run_8a5b5cb9-dcd6-488f-a18b-3e6333cf35a2` | Agent实际创建 → Business打开**同run**审阅批准 → 下载报告 → Agent历史点击重开；completed，2个真实文件 |
| `run_7bf822d6-41fb-45af-bf7b-faeb895c94c3` | Agent最初粘贴JSON但filename仍是资料.txt，解析为纯文本，真实failed：WORKFLOW_SOURCE_INVALID；保留该记录，不改输入掩盖错误 |
| `run_f6a19832-23c9-4258-9de6-1651d4dee992` | Agent上传.json并将轨迹改为PENDING → SUCCEEDED，真实failed：WORKFLOW_TRANSITION_INVALID；无交付文件 |
| `run_bf4f090c-b53d-4acb-87bf-4747dbfcdd89` | Business实际新建并在人工节点明确拒绝，rejected；无交付文件 |
| `run_f884ea31-131c-402f-a262-1ba2a177310b` | Agent实际新建并在待批准节点点击取消，canceled；无交付文件 |
| `run_3d4a45f1-cf1e-4259-a187-ff12bd5d9d3a` | 共享SDK补充的单次合成范围反例，SCOPE_DENIED；后续不执行，无交付文件 |
| `run_0d3c3923-c8b0-4559-88c8-f0397728ff6b` | 共享SDK补充的单次合成声明冲突反例，UNRESOLVED_CONFLICT；后续不执行，无交付文件 |

各run完整input、step input/output、events/hash链、approval、evidence、artifacts、错误及modelCalls存于 `evidence/<runId>.json`。汇总 `evidence/new-runs.json`，仅新增本表8次，不重跑原批量脚本。所有实际页面操作都是Ego，不是进程内模拟。

共享SDK路径为 `packages/capability-sdk/src/runtime.ts` 的 `createRuntimeClient`。三个应用调用同一Runtime；独立Agent/Business沿用现有独立路由和共享组件，没有复制能力实现。

### 真实报告质量与下载校验

主会话已读Ego实际点击下载的 `evidence/business-downloaded-report.md`，其内容包含本轮轨迹、4次转换核验、范围/声明规则说明、原资料/来源、真实本地检索引用、人工确认，并明确“未执行模型核验”“不能证明外部任务完成”。它是可复核的确定性轨迹报告，不是AI生成报告，也不夸大为业务系统成功。

- Agent/Business共享成功run的Markdown SHA-256：`4982d620242ecbfd2f49a61d77e2ee98d518d944b01b3685ce8f320e5473dc97`。
- 同run JSON SHA-256：`7a446b4483123debb911a398651ff90ecd883be59921e2db03b27dd9c6e64c9b`。
- Ego下载文件与Runtime登记摘要完全一致，见 `evidence/ego-download-verification.json`、`evidence/business-report-download.json`。
- 最终凭证见 `evidence/<runId>-receipt.json`，核对最终completed事件、导出完成事件、批准输入摘要和真实文件摘要；不重写中间执行快照。该凭证是本机审计记录，不是外部签名。

## 模型状态：BLOCKED_MODEL_NOT_CONFIGURED

本项目没有 `.env.platform`；实际catalog的platform-model.available=false，model.verify状态为registered_missing_dependencies；SQLite model_calls仍为0。未读历史项目密钥、未调用外部模型，未以本地规则或合成Provider冒充真实AI成功。

正常输出、请求失败、超时、Schema不匹配、模型调用取消等**真实Provider场景均未验收**。本轮人工节点取消只证明本机规则流程取消，不能冒称模型取消成功。现有适配器的HTTPS/本机HTTP限制、项目权限、本次外发授权及summary/verdict/citations校验原样保留，没有降低门槛。

需操作者提供当前平台明确授权配置：

1. 在正式根目录把 `.env.platform.example` 复制为 `.env.platform`，权限设600，用私密编辑器填写，不在终端打印或Git提交密钥。
2. 设置 `PLATFORM_MODEL_ENABLED=true`、`PLATFORM_MODEL_BASE_URL`（授权OpenAI兼容HTTPS基址，通常以/v1结尾；本机服务才可HTTP）、`PLATFORM_MODEL_NAME`、`PLATFORM_MODEL_API_KEY`。不从旧项目取值。
3. 停止本平台当前local runner，再在正式根执行 `npm run start:local`，避免重复监听。Studio“能力与来源”检索 `model.verify` / “模型核验”，查看实际依赖说明；本轮缺配置页面证据为 `evidence/studio-model-blocked-ui.txt`。
4. 配置完成后，把model.verify置于检索之后、人工确认之前，明确授予 `model:invoke` 与 `data:external`，保存有效组合。每次执行还需本次资料外发授权，只用非敏感授权资料。
5. 再真实检查Provider响应、来源引用与上述失败分支；supported须有提供过的引用，但引用存在不代表语义结论正确，仍需人工审阅。

## 浏览器事实与截图阻塞

- 已使用用户首选Ego，读取指定SKILL及当前v2.1.0指引，所有操作复用任务空间2和p1/p2/p3，没有启用Chrome、Chrome for Testing或Playwright Chromium。
- 创建项目、Portfolio/CAP检索、加入能力、步骤调整、保存、上传、执行、批准、拒绝、取消、Agent历史重开、Business真实报告点击下载均已完成；原始页面文本证据在evidence目录。
- Studio来源页已实际展开，显示“历史代码迁移（本机授权）”“来源文件摘要”、原commit/SHA和真实验收run链接；修复了把冻结历史摘要误叫“当前文件摘要”的文案。
- 原生 `page.screenshot()`（默认、raw、清除尺寸模拟后）以及针对可见视口的 `Page.captureScreenshot` 均实际返回 `CdpRequestTimeoutError: CDP request timed out: Page.captureScreenshot`。激活当前页仍失败，未伪造PNG。
- 窗口工具选择Ego Lite返回 `Computer Use was not approved to use ego lite`；没有通过别的GUI技术绕过该拒绝，也未擅自切换到Chrome。
- `screenshots/` **没有成功截图**。Studio、Agent和Business的1440×900/390×844结构尺寸已记录，页面scrollWidth分别为1440/390；见 `evidence/responsive-structure-observations.json`，明确visualAcceptance=false，**不作为截图或视觉通过证明**。
- 恢复条件：修复/批准Ego截图接口或明确授权可见Ego窗口截图，再对三入口逐张截图、实际看图并补主要流程视觉验收。此前不宣称前端视觉可交付。
- 额度恢复后的唯一一次同空间诊断返回 `Error: task space not found: 2`，未另建空间、未重复无变化截图重试。本会话页面操作已停止；父会话后续如获准可独立做原生Ego视觉核验，结果不能预先算入本报告。

## 历史保护与审查

`evidence/preservation-and-listeners.json`逐原行比较所有原表，允许合法新增，但原行字段必须完全相同；原22次运行及原8文件均保持不变。历史状态仍为completed4、failed9、rejected2、canceled5、waiting_approval2；新8次另计。Portfolio与CAP-08原文件末次摘要仍与上表一致。

辅助类型检查与三入口构建通过；没有为通过改旧数据，没有新增测试工程，没有重跑会批量写入记录的脚本。没有用这些工程检查宣称视觉或AI验收。

同Codex内部只读审查已执行；未授权把私人项目外传给antigravity/Claude等外部审查服务。finding逐项处置记录见归档任务的review.md：来源摘要文案已修并实际页面核对；终态FAILED语义保留并明确说明；登记源变更后迁移来源标签需重验的非关键增强作为已知边界记录，没有无关重构。

**整体状态：部分完成，有明确阻塞**。安全基线、实际迁移及本机共享执行已交付；模型配置与真实Provider验收阻塞，截图与桌面/手机视觉验收阻塞。没有隐藏失败或用离线结果替代这些未完成项。
