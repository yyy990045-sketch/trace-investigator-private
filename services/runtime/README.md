# Runtime 0.3.0

本机Fastify + Node24 SQLite执行服务。默认绑定127.0.0.1:4313，数据仅写当前平台data目录。正式Portfolio只读，历史源码仅按Gate2清单读取摘要。

## API

所有接口前缀 /v1；GET不需客户端标识，写操作需 `x-platform-client: workbench-v1`。这是跨站请求约束而不是用户认证。Origin限制为明确本机应用地址，不支持生产多用户部署。

|方法/路径|行为|
|---|---|
|GET /health /catalog|运行健康、能力/来源映射/依赖/验收记录|
|GET/POST /projects|真实项目列表/创建|
|GET/PUT /projects/:id|读取/按revision更新组合|
|POST /projects/:id/validate|服务端装配校验|
|POST /projects/:id/runs|传filename,text,modelConsent,expectedRevision创建真实任务|
|GET /runs?projectId=... /runs/:id|列表/完整步骤与证据审批文件|
|POST /runs/:id/cancel /runs/:id/retry|取消/安全新建重试运行|
|POST /runs/:id/approvals/:approvalId|decision approve或reject、actor自述|
|GET /runs/:id/artifacts/:artifactId|完成后下载，并再次校验文件摘要|
|PATCH /capabilities/:id/:version|enabled开关|

SQLite表保存projects、runs（输入/权限/清单快照）、steps、approvals、evidence、artifacts、events、model_calls、capability_settings。events有前序哈希用于本地变更检测，不是防管理员篡改的外部可信审计。

Registry检查精确版本、输入输出协议、配置Schema、项目权限和依赖；Engine再校验每步实际输入/输出。可声明幂等暂时错误重试，最多2次；不自动重试外部写入。任务取消使用AbortSignal，真实工具应合作响应。人工确认停在持久化状态；决策绑定当前输入摘要。文件原子写入后登记；只有整个运行完成才能下载。崩溃可能留下未登记文件，永不当成交付或由下载API暴露，尚无自动清理机制。

服务启动只恢复queued，waiting_approval保留；running/cancel_requested中断转failed并记录PROCESS_INTERRUPTED。数据目录锁防止同目录双服务；不要删除运行中的锁文件。

授权模型仅加载当前平台.env.platform和明确环境变量，不读取旧项目配置。未配置模型和远端知识服务的依赖检查真实返回不可用。
