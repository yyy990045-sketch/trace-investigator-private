## Task Ledger
Goal: 统一0.3.0前端与Runtime，澄清运行证据并验证模型
Status: in-progress
Files changed: .ccg/tasks/integrate-0-3-frontend-ai/
Commands run: 双目录只读清单；本机源码及SQLite在线备份
Decisions made: 主平台0.3.0为唯一主基线；不恢复旧DEMO；无Git用文件摘要追踪
Blockers: 模型配置待核查
Next: 两个只读方向核查后制定精确变更计划

## Task Ledger
Goal: 主平台整合与真实规则验收
Status: in-progress
Files changed: Studio、共享Runtime UI/SDK、Provider、builtins、snapshot、凭证API、聚焦验收脚本
Commands run: 类型/构建；原Runtime检查；新增隔离协议检查；真实API创建10条规则边界运行
Decisions made: 最终凭证在完成后只读派生；历史文件不改。模型未配置，真实AI独立阻塞
Blockers: BLOCKED_MODEL_NOT_CONFIGURED，.env.platform不存在
Next: 可见WebKit完成主流程审批/拒绝/取消和新应用复用，检查六张真实截图

## Task Ledger
Goal: 0.3.0收尾整合与验证交付
Status: completed
Files changed: 详见source-difference.json；任务归档
Commands run: 实际规则/API/WebKit/新应用调用；必要类型和构建；原记录一致性核对
Decisions made: 主平台0.3.0唯一正式版本，旧预览停服；两项UI复核finding修复并复验
Blockers: 真实AI为BLOCKED_MODEL_NOT_CONFIGURED，未发起真实模型调用
Next: 停止，等待用户审查；配置后另行真实AI验收
