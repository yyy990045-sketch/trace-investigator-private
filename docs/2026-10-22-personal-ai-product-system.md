# 个人 AI 产品开发体系（分支 feature/personal-ai-product-system）

本轮在现有平台上补齐「创建项目 → 选择能力 → 组合执行 → 生成独立应用 → 记录经验 → 下个项目复用」这条闭环，
不新建平台、不重写调度引擎、不迁移历史 CAP。

## 实际改动的核心模块

| 位置 | 作用 |
| --- | --- |
| `services/runtime/src/store.ts` | 新增 4 张表：`compositions`（能力组合）、`run_feedback`（运行反馈）、`experiences`（经验条目）、`project_applications`（项目独立应用）。只新增，不改已有表。 |
| `services/runtime/src/product.ts` | 新增端点：项目应用生成、能力组合保存/复用、运行反馈、经验沉淀与验证、平台概览、Portfolio 更新建议（只读）。 |
| `services/runtime/src/app.ts` | 注册上述端点，端口白名单沿用同一份 `allowed`。 |
| `packages/capability-sdk/src/runtime.ts` | 新契约与客户端方法（overview / compositions / feedback / experiences / application）。 |
| `apps/studio/src/product-pages.tsx` | Studio 新页面与面板：运行概览、独立应用、能力组合、运行反馈、经验库、组合列表。 |
| `apps/studio/src/main.tsx` | 首页接入运行概览；项目页接入应用/组合/经验面板；新增 `/runs/:id/review`、`/experiences`、`/compositions` 路由与导航。 |
| `packages/ui-core/src/styles.css` | 新页面的移动端优先样式与溢出修正（只追加类，不改旧类）。 |
| `checks/product-system.test.ts` | 6 条针对新端点的真实行为测试（组合复用与修订冲突、反馈前置条件、经验确认与验证、概览、端口白名单）。 |

## 数据边界

- 经验条目必须由人确认（`confirmed: true`）才写入；AI 不自动写长期资产。
- 经验分三态：已验证的解决方案 / 人工记录待验证建议 / 已知失败案例；只有 `status=completed` 且用到相同能力的运行才能把建议升级为已验证方案。
- Portfolio 正式登记源保持只读：`/v1/experiences/:id/portfolio-suggestion` 只返回建议内容，不写回 `assets-index.json`。
- 独立应用端口必须已在 `PLATFORM_ALLOWED_ORIGINS` 中，否则直接拒绝（本轮按需在 `.env.platform` 追加了 `4314`、`4315`，未使用通配放行）。
- 模型未配置时不伪造结果：概览里调用量/耗时取 `model_calls` 真实数据，费用标记为未统计。

## 复现这条闭环

1. `npm run start:local`（Studio 4310、Runtime 4313）。
2. Studio「项目工作区」新建项目 A → 项目页「能力组合」保存当前步骤为组合。
3. 在项目页提交资料执行；失败时打开 `/runs/<id>/review` 写人工修正并保存经验。
4. 修正后重跑，等到人工确认后批准；回到该运行页用「用本次成功运行验证」把经验升级为已验证方案。
5. 新建项目 B → 项目页「复用已保存的组合」（替换当前步骤）→ 页面下方「这个项目能力的历史经验」出现 A 的经验。
6. 项目页「独立应用」可生成 `apps/<名称>`，`npm run build --workspace @personal/<名称>` 独立构建。

本轮真实操作结果见 `docs/screenshots/studio-*.png`。

## 项目B的真实运行结果（本轮唯一一次补跑）

- 运行 `run_a3729da8-37b1-4b00-8059-6c4062a1713d`，项目 `project_6a864b76-cc9c-4736-9fae-8f779e70ca43`「复用验证B · 复用A的组合 20261022」，组合修订 2。
- 7 个步骤全部 `completed`，各 1 次尝试：documents.parse → documents.scope-check → knowledge.search → evidence.record → runtime.snapshot → human.confirm → report.export。
- 人工确认：`approved by 叶炜楷`；最终状态 `completed`；事件链完整（run.created → … → approval.approve → run.completed）。
- 真实产出：`核验报告.md`（1119 B，sha256 `edbb090b83f3…`）、`核验数据.json`（2586 B，sha256 `9ea1465266c9…`），evidence 记录 10 条，`model_calls` 0（模型未配置，链路不依赖模型）。
- 输入资料为公开合成示例，`scope` 与真实分类一致（general），未通过改标签通过校验。

## SCOPE_DENIED 经验的修正原则

原经验条目写成「把 documents[].scope 改成项目允许的范围」，容易被当成绕过授权的操作，本轮已按下列原则重写（经验条目与对应运行反馈均已更正，保留修正说明）：

- 先判断资料的**真实分类**；project 的 `allowedScopes` 是**授权范围**，两者不一致时必须走授权，不是改字段。
- 原标记有误（如本次合成测试资料真实分类就是 general）→ 如实更正并写明误标原因，这属于纠正错误标注。
- 资料真实属于受限分类（医疗、客户资料等）→ 不得修改 scope；须由项目授权方在 `allowedScopes` 显式加入该分类并记录授权依据，否则该资料不进入处理。
- 不允许用改标签的方式扩大处理范围；扩大 allowedScopes 必须有真实授权来源。

## 并行提交与分支隔离记录

- `a6eb3e2 fix(trace): 修复长摘录/长标题撑破移动端布局，刷新最终截图` 由另一个并行会话写入本分支（TRACE 截图任务），非本轮内容；按要求保留，未修改、未回退。
- 此后不同项目开发使用独立 Git worktree + 独立分支，避免同一工作树被并行会话共用而互相覆盖。

