## Task Ledger
Goal: 修复获批问题并完成公网验收
Status: in-progress
Files changed: .ccg/tasks/trace-evidence-closeout/
Commands run: git status; specs; selected runtime source reads
Decisions made: 原目录实施，保留 er.mjs ll.mjs lr.mjs；不发送外部模型
Blockers: 服务器运维入口待只读确认
Next: 只读核对生产入口及判定方案，然后主代理实现

## Task Ledger
Goal: 核心修复进入独立审查
Status: in-progress
Files changed: TRACE判断/原句比较/范围/搜索预算/档案及相关UI和检查
Commands run: tsc; 7个TRACE检查文件; TRACE生产构建; SSH只读容器检查
Decisions made: 实际部署 /opt/trace-v2，8090仅对应trace-v2-web/runtime；保留自定义Caddy/compose/env
Blockers: 无；服务器入口用户已提供 ubuntu+aah.pem
Next: 独立审查后处理findings，再备份部署并更正版档案

## Task Ledger
Goal: 隔离本轮修复与并行修改
Status: in-progress
Files changed: 仅已确认的runtime/检查/API/Archive以及重放的Case/Entry局部修改
Commands run: git worktree add --detach 68608d5; selective copy
Decisions made: 原目录未知Case/ui.css/投稿修改不复制不部署，隔离目录成为后续唯一写入目标
Blockers: 无；用户可另确认是否纳入并行修改
Next: 隔离目录复查检查、完成范围最后复验，备份部署

## Task Ledger
Goal: 保留已部署新功能并叠加缺陷修复
Status: in-progress
Files changed: 在本轮修复上三方合并8个生产已变化文件；Cookie/实体回答/分享功能保留
Commands run: 生产源码快照逐文件比较; git merge-file; tsc; TRACE必要检查; 生产构建
Decisions made: production快照是兼容基线，不移除已有HttpOnly Cookie会话、实体答案和分享简明结论；检查改用已部署Cookie契约
Blockers: 无
Next: 一致性备份完成后仅上传目标实例源码改动、重建trace-v2并维护三案例更正版

## 2026-10-25 输入与性能补修
用户确认同一轮前端/OCR/投稿修改合并。已从原目录最新已提交代码纳入文字、截图、链接入口，保留Cookie会话、只读隔离与本轮判断修复。
本次追加：OCR worker/core/语言包同站托管，HTTP人大网站改由用户明确选择读取，实体问句句式/主体/不确定性保护，读取复用版本评估与内容缓存。
部署前再次备份SQLite、档案、目标源码及镜像，仅trace-v2。发现期间其他部署覆盖先前修复，最终以本次43文件校验清单重新发布。

## 最终交付
Status: completed
核心发布78dc7e8，档案显示补修0d9907b；2026-10-25 08:48/08:53北京时间完成目标发布。Ego实际初查/否定方向/实体直接回答/截图校正后查询/人大网读取/三例来源点击/六次浏览器下载均完成。三例dirty=false，匿名写入404，范围拒绝前后配额未增加。A/B/C首屏本次3.15/2.61/2.61秒，1440与390无溢出。旧档案校验值保持。
默认原始完整API与DB保留；展示投影未改判断或文件。修复报告、截图、MD/JSON与校验表保存在本聊天outputs。原工作目录未提交内容未覆盖；仅交付隔离修复分支。
