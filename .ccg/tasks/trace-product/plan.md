1. 官方接口与本地授权核实（完成）。契约已核实：POST /SearchPro + Bearer Key，Pages 为二次序列化 JSON 字符串，错误码 UnauthorizedOperation/ResourceNotFound/ResourceUnavailable/RequestLimitExceeded；官方不含微信公众号内容，QPS 20，时延 600–800ms。
2. 现有 business 生成器创建 apps/trace，重写为三个业务路由（/、/cases/:runId、/archive/:runId）与调查笔记视觉（移动优先 + 1440×900 两栏）。（完成）
3. 独立 SearchPro/安全原文获取 Adapter 与 trace.* 插件；复用项目/运行/证据/审批/产物/SDK。公共运行时仅两处最小适配：uploadSchema 增加 payload/dataConsent，createRun 外发授权判定区分 modelConsent 与 dataConsent。（完成）
4. 人工确认事实与检索式、多轮真实检索、原文摘取与时效/主体审阅、保守结论与真实导出。（完成）
5. 自动化检查 checks/trace-pipeline.test.ts：11 条（含端到端导出档案），全仓 42/42 通过。（完成）
6. 本地真实运行与 390×844 / 1440×900 截图，记录检索未配置时的真实失败态。（完成）
7. 真实 A/B/C 三案例、真实来源与调查档案、档案下载与真实页面截图。（阻塞：缺少 PLATFORM_WSA_API_KEY）
   就绪后一条命令：node tooling/trace-acceptance.mjs → data/trace-acceptance/<case>/acceptance.json。

隐私：不把私有源码发送外部模型；本轮未调用任何外部 Claude/antigravity。
边界：不修改 17 个历史项目、物流工作台与 Portfolio 原始登记；不重构 Runtime。
