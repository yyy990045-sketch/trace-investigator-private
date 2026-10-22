# 0.3.0收尾整合计划

1. 双目录只读核查、文件摘要、源码及SQLite在线备份（已完成）；无Git，不伪造提交记录。
2. Studio首页用真实项目切换、模块入口和最近运行替换属性列表；保留真实装配页的API/revision/Schema校验。共享Shell增加应用可选页面标签，项目能力目录携带目标项目。Agent/Business保留runtime组件，输入/证据按需、内容在确认动作附近；不导入旧DEMO。
3. 本地检索采用通用Unicode词项与中文二元词、加权覆盖率排序；空查询不生成相关性满分。JSON必须有真实显式来源；明确无声明与无冲突，冲突不允许绕过交付。
4. 新导出区分生成时间、执行中快照及最终状态查询。增加只读最终凭证下载：只允许completed且有真实export完成事件、批准记录、文件摘要一致，保留同一runId。旧历史文件不更改。
5. 修复Provider错误分型及Schema/引用检查。仅检查当前平台配置可用性；缺配置真实AI验收阻塞。隔离本机协议测试可验证超时/取消等控制行为，但明确不是实际AI成功。
6. 使用当前服务创建新真实规则运行，保存每例输入/runId/状态/失败原因；旧运行证据只读核验；真实结果和最终凭证下载。
7. 可见WebKit：Studio/独立Agent/独立Business，项目创建/能力选择保存/任务/审批拒绝取消错误历史恢复/报告下载/390与1440。生成新独立应用实际调用Runtime，核心目录摘要不变。
8. 独立只读复核、必要检查、修复、源码差异与一份最终验收说明；归档任务，停止。

受影响文件：apps/studio/src/main.tsx及应用样式；packages/app-shell、agent-ui/runtime、business-ui/runtime、capability-sdk/runtime；services/runtime/providers、builtins、engine(snapshot时间)、app(凭证只读接口)；聚焦验收脚本和说明。不得覆盖data或配置凭证。文件修改由主代理执行；探索与复核仅内部只读，非公开源码不发外部模型。
