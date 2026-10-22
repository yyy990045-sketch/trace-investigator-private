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
