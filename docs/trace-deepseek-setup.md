# TRACE · DeepSeek 模型复核

当前接线使用平台原有 OpenAI 兼容 Provider、model.verify、SDK 和 model_calls 表；没有创建第二套模型服务。

## 本机私密配置

在项目根目录 .env.platform 填写：

```dotenv
PLATFORM_MODEL_ENABLED=true
PLATFORM_MODEL_BASE_URL=https://api.deepseek.com
PLATFORM_MODEL_NAME=deepseek-flash
PLATFORM_MODEL_API_KEY=仅在本机填写真实DeepSeek密钥
```

本机配置已就绪，2026-10-23 已完成真实调用；密钥仅保存在 Git 忽略的本机配置中。DeepSeek官方当前列出的模型包括 deepseek-flash 与 deepseek-v4-pro；本轮使用前者。

- 官方接口说明：https://api-docs.deepseek.com/zh-cn/
- JSON输出说明：https://api-docs.deepseek.com/zh-cn/guides/json_mode/
- 密钥控制台：https://platform.deepseek.com/api_keys

真实模型调用可能产生该账号的API费用。元宝搜索Key不能替代DeepSeek Key，聊天账号会员也不代表API额度。不要向聊天、仓库或浏览器前端提交Key，不读取历史项目凭证。

保存后重启Runtime，在TRACE入口选择“联网取证 + 模型语义复核”，主动勾选本次资料外发授权，再开始调查。模型未就绪时该模式阻止执行，选择人工模式是明确选择，不会静默降级。

## 执行与结果

模型流程单独创建项目装配，复用原有调查步骤，在证据核验后执行：

trace.model.context → model.verify → human.confirm → trace.model.archive。

模型档案插件复用原 trace.archive.export 的实现，旧插件及历史装配保持兼容。

- 模型接收当前事实的时间/主体范围和最多18条真实摘录，标明原文摘录或仅搜索摘要，并保留支持、反对和无法确认的代表材料。
- 模型返回必须符合既有JSON结构，引用只能来自提交的真实引用ID。失败、超时、取消或格式错误沿现有Provider/Runtime记录，不生成成功意见。
- 事实和检索式仍由人确认；本轮接入的是语义复核，不冒充AI事实拆解。
- 模型意见在过程与档案页面单列，不覆盖规则判定。第一版导出保留实际意见和引用；追问/人工修正后的旧意见标为待复核，新版本不会自动借用旧意见。
- 模型运行记录与元宝search.call分开保存。验收要有真实runId、model_calls记录和模型响应；构建与本地检查不能代替AI验收。

## 真实调用与下载证据

- 运行：`run_895b5bfe-69f8-4878-ab41-af4fc3f3fe82`，最终状态 `completed`。
- 公开问题：《中华人民共和国民法典》自2021年1月1日起施行，这一说法有原文支持吗？
- 元宝搜索：1 次 search.call，HTTP 200；模型：1 次成功 model_calls，`deepseek-flash`，12330 ms。搜索与模型独立记录。
- 模型实际意见：`supported`；摘要指出施行日期一致，同时明确部分材料只是摘录或检索摘要。5 个引用 ID 均来自本次提供的证据。
- 调查过程：<http://127.0.0.1:4316/cases/run_895b5bfe-69f8-4878-ab41-af4fc3f3fe82>。
- 调查档案：<http://127.0.0.1:4316/archive/run_895b5bfe-69f8-4878-ab41-af4fc3f3fe82>。
- 人工确认记录为“Codex 本地验收（非用户签署）”，不代表操作者本人签署。
- Ego 实际下载 Markdown 与 JSON 到本机 `data/acceptance/trace-deepseek/`（Git 忽略）。Markdown 有模型复核章节；JSON 有真实 `modelReview.verification` 和引用。最终运行凭证核验文件大小与摘要一致。

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| 调查档案.md | 27967 | 8c4bfaff72c59656cbebb5721f3d3dce114d2805df1e70ece7edfadc22f00307 |
| 调查档案.json | 69226 | 8f1393f50f3274968cd527a43b099c6a0380d072715a0467f690a12d7a92bc71 |

实际截图位于 `docs/screenshots/trace-deepseek-case-desktop.png`、`trace-deepseek-case-mobile.png`、`trace-deepseek-archive-mobile.png`。已亲自查看桌面过程与手机档案截图；手机档案实测 innerWidth=390、scrollWidth=390。

## 验收边界与剩余项

- 正常 DeepSeek 返回、引用校验、人工确认及档案下载已实际完成。
- 失败、超时、Schema 不匹配及取消继续沿用现有 Provider 处理，但尚未逐项通过真实 DeepSeek 请求验收；不能声明模型异常场景验收全部完成。
- 事实拆解仍由人工完成；追问及修正不会自动再调用模型。
- 现有规则界面仍有“独立来源”等较强措辞；未检测到重复不代表已证明来源独立。当前模型接入不构成调查可靠性或比赛整体交付的完整验收，原始出处与来源依赖仍须审阅。
- 本次仅本地运行和提交；没有更新公网展示版，没有上传新档案或推送远端。
