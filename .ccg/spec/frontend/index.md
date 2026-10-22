# 一期前端约定

- 2026-10-21最新指令已授权真实Runtime；前端优先展示真实项目、能力装配、执行与成果，禁止以演示数据替代。
- 所有fixture显式标注演示数据；本地操作不能显示已执行、已审批或已交付。
- 应用拥有路由、品牌、模块、API配置；共享包不得依赖apps、特定项目名或演示数据。
- 公共组件通过包入口导入。主题通过ShellConfig注入CSS变量，不锁死统一品牌。
- Agent以过程/步骤为中心；Business以对象/成果为中心，禁止整页换标题复用。
- 按用户当前指定的Ego实际验收1440×900和390px；不擅自切换Google Chrome、Chrome for Testing或Playwright Chromium。
- 只读正式Portfolio JSON，不复制第二个可编辑CAP/UI索引，不把历史CAP自动视作可执行能力。

- 配置编辑器按项目ID和revision隔离草稿；无效JSON阻止保存/执行，执行请求携带expectedRevision。
- 业务交付状态必须以完成运行和真实artifact共同判定。生成模板注入项目字符串使用String(...)，避免TS对字面量逻辑表达式报always-truthy。

- 当前项目URL优先于本机记忆；返回首页不得无提示切换项目。商业资料默认显示解析正文和来源，原始结构化输入按需展开。

- 能力配置使用Runtime configSchema预检，执行输入须区分文件名后缀、文件格式、documents结构；状态选择只是输入辅助，转换规则仍由Runtime执行。
- 原生dialog的Tab循环需排除关闭details内的后代控件；仅检查getClientRects不足以证明控件可见。手机验收记录实际innerWidth、scrollWidth及截图尺寸，不以文件名代替390px证据。
