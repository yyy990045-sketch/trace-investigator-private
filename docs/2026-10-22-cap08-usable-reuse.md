# CAP-08 使用体验与项目复用交付（2026-10-22）

## 现在可以做什么

在 Studio“能力与来源”检索 CAP-08，打开“工作流轨迹核验”详情：

1. 查看用途、输入要求和 Runtime 返回的实际可用/验收状态。
2. 点击“开始试运行”，创建独立真实项目；填写状态、资料来源及可选说明。
3. 授权本机处理后提交到原 Runtime，审阅并批准后下载真实报告。
4. 修改可视化能力配置，选择当前或其他项目，保存此能力及配置；同版本不重复添加。

这些入口使用原有 createProject / saveProject / execute API 与 expectedRevision，不创建前端成功记录。试运行项目和运行记录都保留。改变能力配置会清除已准备的试运行表单，需重新准备项目，避免显示新配置却执行旧配置。

本轮完成前端操作和项目复用验收；真实模型仍待操作者本地配置，不能称为 AI 核验已通过。

## 正式根与保护边界

- 源码：`/Users/xieweikai/Projects/personal-ai-capability-platform`。
- 分支：`codex/local-capability-integration`。
- 原版基线 `e44134dd6a97dc52fa482228ab9ade0f03cc8f0d`；CAP-08迁移提交 `5e6acf81b8fc2f2622b3fa5612e548ca274955d9`；上轮文档提交 `5520d56d4744002389bd456dca04c8379d0c9b9c` 保留。
- 本轮前的 SQLite 一致性备份：`data/cap08-usable-reuse-20261022/before.sqlite`；所有原表逐行记录：`evidence/prior-rows.json`。
- 全部原30条运行（原22+新增8）、12个原文件与所有原表行保持不变；本轮只增加2个项目、2次真实运行和4个报告文件。
- Portfolio保持只读，摘要仍为 `73dc44cfa20519071a31b6af67e7aca0b439cb55facffa655b18105227280e7f`。
- 没有修改 Runtime、CAP-08 原算法、SDK/API契约、历史项目或物流系统，没有生产连接或公网部署。

上述证据、截图和下载位于被Git忽略的 `data/cap08-usable-reuse-20261022/`。敏感配置、SQLite、用户输入、运行日志和截图不提交Git。

## 使用过程的具体变化

### 能力详情

- 用途与限制、文件要求、运行状态优先；SHA、Commit、代码映射及原始Schema都在高级详情中。
- CAP-08详情直接创建真实试运行项目，保留人工确认和报告导出。
- 可将上方能力配置保存到所选项目；已有同版本更新配置，不复制算法、不重复添加步骤。
- 选定目标项目时读取并固定其revision，保存使用这个已读取版本，不临时换成最新revision；其他标签在详情打开后更新项目，会由原服务端拒绝覆盖。
- 当前项目配置未加载或读取失败时，不允许准备试运行或覆盖项目配置；请求期间锁定配置输入。

### 配置与输入

- 配置表单根据Runtime返回的configSchema生成，使用已有Ajv执行Schema校验；轨迹标识、结束状态要求、检索问题和引用条数均有普通表单控件。
- CAP-08默认“填写状态”：初始状态为空，操作者须主动选择2—200个中文状态、填写真实资料来源；自动生成documents/claims及嵌套states内容，自动匹配已保存的轨迹标识。
- “上传或粘贴文件”继续保留，文件名可编辑。明确区分 `.json` 文件名、JSON文件格式、documents内容结构和轨迹text中的states数组。
- 执行前拦截错误后缀、无效JSON、缺少documents、资料来源/正文为空、空claim字段、未选择/未知状态、轨迹标识缺失/重复、配置Schema错误和超大输入。上传期间阻止执行；读取结果须匹配当前文件选择代次，过期结果不能覆盖新文件或手动输入。
- **前端不复制转换规则表，也不以结构校验宣称轨迹通过。** 状态转换合法性由CAP-08实际Runtime步骤判定，失败仍记录真实原因。
- 原JSON配置保留在高级折叠中；无效配置继续阻止保存/执行。授权、模型资料外发授权和项目revision保护沿用原接口。

### 移动端实际发现与修复

- 目录长SHA导致横向溢出：移入高级来源详情。
- 单选控件被旧form全宽规则撑开、文字竖排：限定单选控件尺寸，改为可换行输入方式布局。
- 数字配置无边框：补普通配置字段的完整样式，字段上下排列。
- Business审批摘要在默认弹窗中横向溢出：折叠为高级输入摘要；审批契约未变。
- Tab遍历会经过关闭details中的不可见内容：Modal筛除关闭详情的后代并明确循环焦点；Escape恢复打开弹窗的按钮。
- 弹窗标题与关闭按钮保持可见；长内容可滚动；Agent待确认操作在手机底部可达。

## 两次实际运行

| 用途 | 项目 | 运行与结果 |
| --- | --- | --- |
| Studio详情直接试运行 | `project_2c775e6a-ffbf-47f3-ad2c-2968fa037116` | `run_4cb8a766-97b1-4b6e-8c80-0d2b75810efa`，completed；独立Agent审批；2个真实文件 |
| 第二项目复用 | `project_9709bf26-70f7-4e34-bc4f-6c8f0e6c5773` | `run_0901340d-8ae8-487a-bc7e-173c7411213b`，completed；独立Agent发起，Business同ID审批并下载；2个真实文件 |

输入均明确标为本轮授权非敏感合成资料。审批确认人标注Ego代操作，不冒称用户亲自审批。第一条轨迹含人工挂起/恢复，共4次转换；第二条轨迹为待处理→执行中→已完成，共2次转换。

复用操作记录：

1. Studio创建“CAP-08复用验证 · 第二项目 · 20261022”，选择商业布局，初始revision 1。
2. 在能力目录选择同一个 `workflow.transition-check@1.0.0`；配置轨迹标识 `reuse-trace`、要求终态。
3. 点击“加入并保存到当前项目”，得到revision 2，能力位于解析/范围检查之后、确认/导出之前。
4. 在同一详情将此配置复制到另一试运行项目；只更新该项目CAP-08配置，不重复添加步骤；试运行历史保留其原revision 1及输入快照。
5. 第二项目用可视化字段设置检索问题“人工介入”，保存revision 3。
6. 独立Agent选第二项目，填写来源和可选说明，直接提交，无需手写执行JSON。
7. Business打开同一run审阅，批准并实际点击下载报告；Agent重开同ID查看完成步骤和文件。

后续实际双页并发检查：详情保持revision 3草稿，另一页改动第二项目至revision 4，旧详情保存返回冲突且未覆盖对方配置；另一页再明确恢复配置到revision 5。此检查没有创建新运行，前述成功运行仍保留revision 3快照。证据 `evidence/project-conflict.json`。

**本次新增项目复用所需重复业务代码为0，新增Runtime/算法代码为0。** 操作仍需要创建项目、选择能力、填写配置与授权；不对节省比例作推测。UI接入代码见下方变更清单。

完整input、step input/output、事件、审批、证据、artifact元数据与最终凭证见 `evidence/<runId>.json`、`evidence/<runId>-receipt.json`。汇总见 `evidence/new-runs.json`。第二项目下载的Markdown摘要与Runtime登记值一致，见 `evidence/preservation.json`。

实际报告包含轨迹核验、资料、来源、本地词项检索引用和人工确认。没有事实声明时明确写“未核验”，没有模型时明确写“未执行模型核验”；不宣称外部工作流已完成。

## Ego真实浏览器与390px截图

本轮只使用Ego，TaskSpace 3。已实际操作详情→试运行、第二项目装配/保存、独立Agent发起、步骤切换/证据、Agent审批、Business审阅/下载、弹窗关闭/焦点恢复。

三个应用均在390×844视口记录 innerWidth=390、scrollWidth=390；最终截图为真实浏览器PNG。属于浏览器移动尺寸模拟，未宣称实体手机或软键盘设备验收。结构测量是辅助，截图已逐张实际看图。

| 实际画面 | `screenshots/`内文件 |
| --- | --- |
| Studio能力说明、配置与高级信息折叠 | `studio-detail-current-390.png` |
| 项目配置与检索问题/数字输入 | `studio-config-final-390.png` |
| 复制配置到另一项目后的真实保存提示 | `studio-copy-project-390.png` |
| Agent输入方式和状态选择 | `agent-input-modes-current-390.png` |
| 错误内容结构的具体提示、执行按钮阻止 | `input-schema-hint-final-390.png` |
| Agent手机步骤证据/确认 | `agent-evidence-390.png`、`agent-confirm-390.png` |
| Agent第二项目真实完成 | `agent-reuse-completed-390.png` |
| Business手机审阅 | `business-review-final-390.png` |
| Business同run交付/报告下载入口 | `business-reuse-completed-390.png` |
| 桌面能力详情 | `studio-detail-desktop.png` |

修复后的状态输入从空白开始，最终截图另有 `input-blank-states-390.png`。

尺寸及页面路径见 `evidence/mobile-viewports.json`；最终焦点检查见 `evidence/mobile-focus.json`。诊断截图和修复前的焦点记录单独保留，不作为最终验收证明。

## 模型状态与操作者配置

截至本轮验收，`.env.platform`不存在，model.verify仍为registered_missing_dependencies、没有真实验收记录，model_calls仍为0。操作者已表示将在本地私密配置后通知；本轮没有读取旧项目API Key，也没有外部模型请求。

私密配置步骤：

1. 在正式项目根根据 `.env.platform.example` 创建 `.env.platform`，权限600；不要把密钥发到聊天或终端输出。
2. 设置 `PLATFORM_MODEL_ENABLED=true`、`PLATFORM_MODEL_BASE_URL`（授权OpenAI兼容HTTPS地址，通常以/v1结尾；仅本机可HTTP）、`PLATFORM_MODEL_NAME`、`PLATFORM_MODEL_API_KEY`。
3. 配置完成后停止本平台现有local runner，再运行 `npm run start:local`，避免重复启动；核对 `/v1/catalog` 的实际依赖状态。
4. Studio加入model.verify，放在本地检索后、人工确认前，授予model:invoke与data:external，并对每次非敏感资料勾选模型外发授权。
5. 再验证真实正常响应、返回Schema、失败、超时及取消，检查model_calls中的实际响应和原因，并人工审阅引用与结论。

现有Provider已具备JSON summary/verdict/citations校验、引用集合检查、HTTP失败、AbortSignal超时/取消记录。现有合成Provider协议检查不是实际AI验收；本轮没有用其冒充真实模型调用。

## 代码变化与支持检查

- `apps/studio/src/main.tsx`：详情试运行、项目配置复用、基于Schema的配置表单、正确步骤位置及来源折叠。
- `packages/agent-ui/src/workflow-input.tsx`：可视化状态输入、配置字段、结构预检及装配辅助；不含状态转换规则实现。
- `packages/agent-ui/src/runtime.tsx`：三个应用共用的真实输入/授权/execute表单。
- `packages/agent-ui/src/runtime.css`：仅表单、详情、手机操作相关样式。
- `packages/business-ui/src/runtime.tsx`：审批摘要按需展开。
- `packages/ui-core/src/index.tsx`：弹窗可见控件的Tab循环。
- Agent包及lockfile：声明平台原已安装的Ajv依赖；没有新增技术栈或升级库。

typecheck及三入口构建通过，日志在 `evidence/typecheck.log` 和 `evidence/build.log`。仅针对输入真实风险做了使用实时Runtime Schema的本地检查，确认错误输入未创建运行，见 `evidence/input-checks.json`。另对快速A/B文件选择进行了仅输入读取的延迟顺序检查（恢复原生File.text后结束），不调用Runtime、不伪造能力输出；见 `evidence/file-read-race.json`。没有重跑会批量创建历史记录的验收脚本。产品结论仍以本轮实际操作、真实报告和截图为依据。

## 收口

本轮前端与项目复用已交付；模型配置及真实Provider五类场景仍待操作者提供配置。没有继续建设行业产品或扩建平台骨架。内部审查逐项处置在本轮归档任务review.md；本地Git提交与最终证据摘要见 `data/cap08-usable-reuse-20261022/evidence/git-final.json`。
