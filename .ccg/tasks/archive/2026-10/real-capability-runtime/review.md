# 本地独立审查与处理

未将私有源码发送给外部antigravity/Claude服务；本轮使用内部两个独立只读审查轴，不声称外部双模型审查。最终严重项为零，原始问题与处理如下。

|审查项|处理及证据|
|---|---|
|ctx.model可伪造资料授权|Engine根据运行原始输入modelConsent和能力声明/权限授权，忽略插件伪造的授权；runtime.test越权用例|
|ctx.artifact绕过权限/审批|要求file:write、local_file及当前输入审批；缺失即ARTIFACT_PERMISSION_DENIED|
|取消后异步模型收尾晚于DB关闭|workers/operations跟踪；stop等待受控Provider/文件清理，晚到写入先检查AbortSignal；shutdown用例|
|审批跨步骤复用不清晰|默认逐步骤；只有显式相同approvalScope且输入哈希相同才共享，delivery为交付范围；外部写始终逐步骤。可信插件声明同scope也获得此范围，文档已明确|
|旧外部写运行可能被当前定义绕过重试保护|按旧运行manifest拒绝外部写重试；无manifest保守拒绝|
|审批人文字非认证身份|保留本机单用户操作者自述，文档不声明真实人员认证；多用户鉴权未实现|
|重试执行变更后的项目|重试带失败运行projectRevision，版本变化拒绝；当前组合须重新创建任务|
|取消后snapshot仍可访问关闭DB|与其他上下文一样先assertActive|
|无效JSON草稿仍可执行旧配置|父组件invalidDrafts阻止保存/执行，结构移动同时锁定；浏览器真实操作|
|旧页面执行新组合|SDK提交expectedRevision，API核对；HTTP冲突用例|
|远端revision更新导致编辑器和草稿不同步|editingRevision保留本地未保存草稿并提示冲突；StepConfig随项目/版本重挂载|
|跨项目切换可能错存旧草稿|editingProjectId区分归属；不匹配只显示加载；最后限定复审确认关闭|
|完成但没文件仍宣称交付|业务结果依completed+真实artifacts判定，完成无文件如实说明|
|非JSON代理错误不清楚|SDK安全读取并产生带HTTP状态的RuntimeApiError|
|Shell旧preview0.2及固定品牌|改应用config.name及本机环境文本|
|来源模块读取末步可能漏资料|读取首个实际含documents的输出；模板同步；新应用浏览器展开真实来源|

外部任意可信插件直接系统调用不受沙箱隔离；当前框架不运行不可信插件。进程崩溃可能遗留未登记文件，不会暴露为下载，自动孤儿清理尚未实现。上述两项列为边界，不包装成生产多租户安全平台。
