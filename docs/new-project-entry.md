# 新业务项目开发入口

框架源码基准：`e1e7ef3406ce1fc3aca9e4ffaf018081e6706ba7`（2026-10-22确认，工作树干净）。框架专项建设结束，后续直接承接新业务需求。

正式根：`/Users/xieweikai/Projects/personal-ai-capability-platform/`。
资产登记源（只读）：`/Users/xieweikai/Projects/personal-ai-portfolio/registry/assets-index.json`。

## 下一条业务需求的做法

1. 明确业务目标、实际用户、核心任务与可交付成果；先交付业务方案和核心前端设计。
2. 按该需求检索Portfolio中的能力、前端资产和业务经验；区分历史参考、已适配能力及真实可执行能力。
3. 选择Agent或Business模板，创建 `apps/<新应用>/`，实现该项目自己的名称、主题、导航、业务路由与模块。
4. 复用共享组件及SDK，装配已接通的Runtime能力；只有真实缺口才新增业务能力或Provider Adapter。
5. 完成实际业务数据处理和闭环，在Ego中实际操作并审阅桌面/移动页面，独立构建该应用。
6. 交付说明用户能完成的工作、已复用能力、真正执行成功的功能、新开发内容及实际复用部分；经验证且有跨项目价值的能力再回流公共框架。

不默认改造某个旧项目。不要重新搭工作台、复制Runtime、批量迁移CAP或继续创建CAP-08验收项目。框架最小修复仅限真实业务遇到的必要缺口，并说明原因和影响。

## 已有入口

| 用途 | 项目内位置 |
| --- | --- |
| 应用生成器 | `tooling/create-app.mjs`，命令 `npm run create:app` |
| Agent模板 / Business模板 | `templates/agent-app/` / `templates/business-app/` |
| 新应用前端入口 | `apps/<应用名>/src/main.tsx`；Agent模板含 `src/modules/sources.tsx` 模块例子 |
| 主题、导航、路由容器 | `packages/app-shell/src/index.tsx`，应用自身传入ShellConfig |
| 通用UI、状态、表单与任务/成果界面 | `packages/ui-core/`、`packages/agent-ui/`、`packages/business-ui/` |
| Runtime SDK与契约 | `packages/capability-sdk/src/runtime.ts`，包入口 `src/index.ts` |
| Registry / 能力插件 | `services/runtime/src/registry.ts` / `services/runtime/plugins/` |
| Runtime入口 / API / Provider | `services/runtime/src/server.ts` / `app.ts` / `providers.ts` |
| 开发代理与启动脚本 | `tooling/vite.ts` / `tooling/start-local.mjs` |

共享包、Studio通用管理、Registry契约及Runtime核心调度原则上保持稳定；新业务优先写应用级模块和独立适配器。模板已有真实状态读取、执行表单、加载/空态/错误反馈和SDK客户端；业务模块的专属流程、布局与API按新需求实现。生成器不自动生成一个业务后端，也不替代业务设计。

## 新应用命令（收到业务需求后使用，本轮未生成应用）

在Studio创建并保存真实项目，获得真实project ID；选择一个未被占用的本机端口，再使用现有生成器。例如以下占位值需替换：

```sh
npm run create:app -- agent my-product --port 4316 --title 新产品名称 --project-id project_UUID
npm install
npm run dev --workspace @personal/my-product
npm run build --workspace @personal/my-product
```

商业应用将 `agent` 换为 `business`。生成器拒绝覆盖已有目录。新增本机应用端口若不在Runtime允许来源中，应通过当前平台授权配置补充明确的本机Origin，不使用通配放行。

当前是Monorepo内独立应用与独立构建，未实现跨仓库独立安装；只有真实项目要求独立仓库时才处理包分发。不再另造CLI。

## 启动现有底座

Node.js 24以上。在正式根目录，首次安装按README运行 `npm ci`，随后 `npm run start:local`。已有服务运行时不重复启动。

Studio `127.0.0.1:4310`；Agent `4311`；Business `4312`；Runtime健康入口 `127.0.0.1:4313/v1/health`。本轮只读确认四个监听的cwd均属正式项目，四入口均返回HTTP 200。

## 保留的事实边界

模型真实调用仍为0、Provider尚未验收，但不阻塞不需要模型的新业务。业务确需模型时使用当前平台私密授权配置和已有Provider，实际核验响应及错误；不读取旧密钥，不用模拟响应冒充执行。历史远端RAG及未适配CAP不声明为已执行。

历史运行、SQLite、已验证能力及现有Git提交保留。本轮仅保存此入口说明和任务归档，不修改框架源码、不新增项目或运行记录。
