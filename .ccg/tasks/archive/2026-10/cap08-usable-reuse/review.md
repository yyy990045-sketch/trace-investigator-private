# 内部审查与逐项处置

私人源码未外传外部模型；独立同Codex只读审查无Critical，3项Warning、1项Info。以下均由主会话修改、实际点验，控制流变化已由原审查员在同范围复核，四项均closed，无遗留finding。

1. Warning：详情临保存时重新GET最新revision，旧配置可能覆盖其他页。处理：目标项目选定时固定快照和revision，保存使用已读取版本；加载失败/过期不自动升级。证据：真实Ego双页编辑新第二项目3→4，旧详情保存被拒，服务器documentId仍为另一页值；明确恢复到5，不创建运行。`evidence/project-conflict.json`、`screenshots/studio-revision-conflict-390.png`。
2. Warning：file.text异步读取可能A覆盖B。处理：选择/手动编辑/模式切换/卸载均使过期读取失效，读取期间禁执行。证据：真实文件输入A/B，测试仅延迟A的读取完成顺序，A后返回仍保留B文件名和内容；还原原生方法且没有Runtime执行。`evidence/file-read-race.json`。
3. Warning：claims空字段可过Schema而Runtime parser拒绝。处理：补齐与parser一致的非空key/value/source及正文检查；保留Runtime最终规则判定。证据：使用实时Schema的输入检查，无新运行。`evidence/input-checks.json`。
4. Info：默认预填成功轨迹可能被误当实际输入。处理：初始两个空状态，新增状态也为空，须主动选择；资料授权后空状态仍阻止执行。证据：`file-read-race.json`的blankStates与activeSelection记录、`screenshots/input-blank-states-390.png`。

其他已自行修正的实际观察：目录SHA与Business审批摘要横向溢出、单选框全宽、数字输入样式、关闭details后代被纳入Tab循环。最终三应用390px宽度/scrollWidth均为390，连续8次Tab及反向Tab仍在弹窗内，Escape恢复触发按钮。`evidence/mobile-viewports.json`、`evidence/mobile-focus.json`。这些均为实际Ego观察，无假成功或新模型调用。

复审结论：目标版本快照、文件读取代次、parser一致性预检、空白主动状态选择均已关闭；主会话再次核验关键定位与Ego证据。类型检查/构建通过。真实Provider等待操作者本地配置，不纳入通过结论。
