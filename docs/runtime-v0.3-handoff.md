# 真实能力框架阶段交付 · 0.3.0

2026-10-22。本轮在现有仓库继续，已打通本机规则处理、能力装配和真实交付闭环；没有公网部署。AI链路因缺少当前平台模型配置而阻塞，不能给出AI验收通过结论。

## 现在能做什么

打开 http://127.0.0.1:4310 ，创建真实项目，检索Portfolio来源，装配运行能力并保存。上传有权处理的UTF-8 txt/md/json，执行解析→范围/冲突核验→检索引用→证据→字数统计扩展→状态快照→人工确认→文件导出。可查看每步真实输入/输出、证据，批准、拒绝或取消，并重开历史运行。

当前可执行8项能力，均为1.0.0，具体映射/依赖/验收运行见 [能力接入清单](/Users/xieweikai/Documents/Codex/2026-10-21/new-chat/outputs/runtime-v0.3/能力接入清单.md) 和 [实时目录快照](/Users/xieweikai/Documents/Codex/2026-10-21/new-chat/outputs/runtime-v0.3/catalog.json)。CAP-01/04/08根据Gate2作为历史设计参考独立实现；CAP-02仅实现新本地上传资料词项检索Provider，未接通历史远程RAG。没有把代码参考写成复制复用。

## 自己上手

1. Studio点击“新建项目”；或打开现有[跨能力资料处理项目](http://127.0.0.1:4310/projects/project_ba4abdd4-cf69-4c67-ab8a-19f098ffaa17)。
2. 能力与来源页检索CAP-01、CAP-04、CAP-08、CAP-02或Runtime ID，展开来源和依赖。选择目标项目，加入已注册可用能力。
3. 配置项目步骤、JSON配置与权限后保存。输入输出协议、版本、依赖、权限、无效配置不通过会阻止执行。
4. 上传源码目录 `examples/authorized-inputs/资料处理测试.txt`，勾选本机处理授权，点击创建并执行。
5. 到人工确认节点核对来源，再批准或拒绝；也可取消。完成后下载核验报告.md和核验数据.json。
6. 直接[打开保留给你的待确认任务](http://127.0.0.1:4311/missions/run_d64f23e1-227b-4d7c-abbc-eb6afbb2edc9)即可测试决定会影响真实状态。

重启启动方式见[源码README](/Users/xieweikai/Projects/personal-ai-capability-platform/README.md)：Node24，npm ci，npm run start:local。当前服务保持本机运行。

## 真实运行与交付物

|路径|运行ID|实际结果|证据|
|---|---|---|---|
|成功|run_564038c1-0122-46a4-b7ec-80c3ca58e19d|8步实际执行，确认后完成，2个文件|[成功记录](/Users/xieweikai/Documents/Codex/2026-10-21/new-chat/outputs/runtime-v0.3/success-run.json)、[报告](/Users/xieweikai/Documents/Codex/2026-10-21/new-chat/outputs/runtime-v0.3/交付-核验报告.md)、[数据](/Users/xieweikai/Documents/Codex/2026-10-21/new-chat/outputs/runtime-v0.3/交付-核验数据.json)|
|失败|run_eb668c3f-4011-4d2f-9d07-4c7da265b63c|UNRESOLVED_CONFLICT，范围核验实际拒绝冲突|[失败记录](/Users/xieweikai/Documents/Codex/2026-10-21/new-chat/outputs/runtime-v0.3/failure-run.json)|
|拒绝|run_4d7d6aab-5e0d-43f6-9cd1-b993b2d25fdf|rejected，无正式交付文件|[拒绝记录](/Users/xieweikai/Documents/Codex/2026-10-21/new-chat/outputs/runtime-v0.3/rejected-run.json)|
|取消|run_87ddde44-7f8e-418d-bf39-f4e1ebf8d817|canceled，待确认终止，无正式交付文件|[取消记录](/Users/xieweikai/Documents/Codex/2026-10-21/new-chat/outputs/runtime-v0.3/canceled-run.json)|
|重启恢复|run_f910c6fe-4686-4c0a-8318-94cc965b7322|待确认记录完全保留，之后实际确认并完成|[进程与记录对比](/Users/xieweikai/Documents/Codex/2026-10-21/new-chat/outputs/runtime-v0.3/restart-proof.json)、[完成记录](/Users/xieweikai/Documents/Codex/2026-10-21/new-chat/outputs/runtime-v0.3/restart-completed.json)|

成功运行可分别从[独立Agent](http://127.0.0.1:4311/missions/run_564038c1-0122-46a4-b7ec-80c3ca58e19d)和[独立商业应用](http://127.0.0.1:4312/deliverables/run_564038c1-0122-46a4-b7ec-80c3ca58e19d)打开，读取同一个真实运行ID。浏览器实际下载文件摘要已核对，见[浏览器记录](/Users/xieweikai/Documents/Codex/2026-10-21/new-chat/outputs/runtime-v0.3/browser-acceptance.json)。

重启不是只做数据库单元用例：实际停止PID70370，启动PID74527，同一待确认运行JSON完全一致，前6步attempts保持1，之后批准完成。没有重新执行已完成步骤。

## 独立应用复用

从当前模板生成 `apps/runtime-reuse-agent`，项目ID固定为本次真实项目，独立dist构建并在 http://127.0.0.1:4416 运行。它通过SDK创建了真实运行、读取真实步骤并执行取消；自有 `/sources` 模块能展开解析资料。生成前后packages及Runtime源码摘要相同，见[复用证据](/Users/xieweikai/Documents/Codex/2026-10-21/new-chat/outputs/runtime-v0.3/application-reuse-proof.json)、[浏览器操作](/Users/xieweikai/Documents/Codex/2026-10-21/new-chat/outputs/runtime-v0.3/reuse-browser-acceptance.json)和[该应用创建的运行](/Users/xieweikai/Documents/Codex/2026-10-21/new-chat/outputs/runtime-v0.3/generated-application-run.json)。

Agent拥有侧栏任务路由 `/new /missions/:runId /sources`；Business拥有顶部模块导航 `/intake /deliverables/:runId /materials`，围绕资料对象与交付物组织。共享Shell不定义业务路由，业务主工作区可替换，未用同页面换标题冒充不同产品。

新增能力示例 `services/runtime/plugins/text-metrics.ts` 实际参加了本次8步执行，注册器自动加载；Engine没有该能力ID分支。新增业务应用复用导航、主题、执行表单、状态、审批、证据和SDK，不再重复建设这些公共内容。每个应用仍需实现自己的业务领域、模块和API；不声称可以免开发生成任意产品。

## 六张最终真实截图

|页面|1440×900桌面|390×844移动|
|---|---|---|
|Studio|[桌面](/Users/xieweikai/Documents/Codex/2026-10-21/new-chat/outputs/runtime-v0.3/screenshots/studio-desktop.png)|[移动](/Users/xieweikai/Documents/Codex/2026-10-21/new-chat/outputs/runtime-v0.3/screenshots/studio-mobile.png)|
|Agent|[桌面](/Users/xieweikai/Documents/Codex/2026-10-21/new-chat/outputs/runtime-v0.3/screenshots/agent-desktop.png)|[移动](/Users/xieweikai/Documents/Codex/2026-10-21/new-chat/outputs/runtime-v0.3/screenshots/agent-mobile.png)|
|商业产品|[桌面](/Users/xieweikai/Documents/Codex/2026-10-21/new-chat/outputs/runtime-v0.3/screenshots/business-desktop.png)|[移动](/Users/xieweikai/Documents/Codex/2026-10-21/new-chat/outputs/runtime-v0.3/screenshots/business-mobile.png)|

所有截图为可见WebKit实际页面，已逐张打开检查；没有Chrome/Chromium。Agent截图展示保留的真实待确认任务，Business截图展示已完成运行。同一成功运行双视图额外证据为 agent-completed-desktop.png 与 business-desktop.png。完整页面图、失败、证据、模型不可用和新应用见 screenshots/，摘要见[截图索引](/Users/xieweikai/Documents/Codex/2026-10-21/new-chat/outputs/runtime-v0.3/screenshots/index.json)。

Studio以最近实际使用的项目为先；Agent桌面保留步骤主从关系，手机折叠全步骤并让当前确认操作在第一屏；Business用单一成果画布、来源与按需审阅/审计弹层，无固定右侧KV属性栏。删除了当前应用入口中的固定DEMO任务、模拟审批与假完成、旧预览版本标识和重复错误提示。旧预览fixture仅保留在历史预览源码中，当前三个入口和生成模板均使用真实SDK。

已实际操作项目创建、能力检索/加入/排序/保存、无效JSON阻止执行、授权上传、步骤切换、证据展开、商业审批、报告下载、失败/拒绝/取消、刷新重开、移动步骤导航、键盘开关弹层和焦点恢复、独立应用创建任务、模型禁用状态。加载/空态在实际空库初始验收中观察；不存在运行的错误页实际打开。没有将测试通过或截图存在等同于视觉最终认可，最终体验待用户审查。

## Gate 3–5结论和边界

- Gate3：真实Registry/SQLite/Schema/版本/权限/副作用/顺序编排/超时可控重试/审批/取消/证据/文件能力已实现，源码见 services/runtime。
- Gate4：Studio装配、Agent/Business共享运行和独立模板SDK接通已验证。
- Gate5：确定性规则流程、成功/失败/拒绝/取消、真实进程重启、独立应用及浏览器下载有证据。AI验收为 BLOCKED_MODEL_NOT_CONFIGURED，不能称全链路AI通过。

自动检查日志为 automated-checks.log、typecheck.log、build.log、generated-build.log；内部审查及逐项处理见[审查与处理](/Users/xieweikai/Documents/Codex/2026-10-21/new-chat/outputs/runtime-v0.3/审查与处理.md)。它们只支持运行正确性，实际页面和文件仍需用户判断。

## 尚未实现和下一阶段

1. 当前平台模型未配置，实际模型调用次数为0；没有伪造模型返回。授权配置后需单独验收真实响应/耗时/错误与引用。
2. 历史远端RAG、向量检索、外部业务工具未接入；未适配CAP/UI不显示可执行。
3. 资料解析仅UTF-8 txt/md/json，未支持PDF/OCR/Office。
4. 本机单用户，审批人为自述记录，尚无多用户认证/租户/生产部署；插件是可信Node代码，不是不可信插件沙箱。
5. 崩溃遗留未登记结果文件不会交付，自动孤儿清理尚未实现。共享包尚未脱离monorepo发布。
6. 长列表仍需后续按实际项目数量增加筛选/分页；来源模块按运行展示会重复同一资料。当前没有复杂画布或通用业务领域包。

已具备继续扩展新能力和新产品应用的本地基础，但不等于历史全部AI能力已接通，更不等于生产级商业平台。下一阶段最有价值的是明确配置一个当前平台授权模型，完成真实AI核验，再挑选一个权属清楚的历史Provider做定点适配。本阶段停止，不提前开发参赛或行业产品。

保护范围证据：[integrity.json](/Users/xieweikai/Documents/Codex/2026-10-21/new-chat/outputs/runtime-v0.3/integrity.json)。正式Portfolio摘要与开工时一致；本轮未修改历史项目、生产数据库或线上部署，未读取旧凭证或上传历史客户数据。源码恢复包不包含node_modules、dist、data数据库或.env密钥。
