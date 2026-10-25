# 本地独立复核

不向外部模型发送私有源码。只读探子定位线上基线；独立本地审查原报告1 Critical、2 Warning。

- Critical：模块加载期间取消仍可外发AI图片。Controller前置，AI不加载本地引擎，发送前检查signal，复审确认解决。
- Warning：换图保留旧文字。换图清空，移除对应截图清空，切换非截图导入统一清预览；复审核心路径确认，长文分支遗漏已补并自行核验。
- Warning：旧worker失败可能重置新worker。按pending身份检查，复审确认解决。
- Info：旧worker进度可能更新新任务。增加worker代次守卫，reset同步递增；局部机械修复已自行核对，无需扩大复审。

同意、编码校验、限额均在模型调用前；费用使用既有usage_daily的独立vision_ocr指标，不计搜索；图片不写入SQLite/文件。用户真实图片通过现网授权模型实测13行正确，后续由公网界面验收。

发布预检：首次 /v1/ingest/image 与现网image-intake.ts重名，已回退并改为 /v1/ingest/image/vision；在现网基镜像中以独立临时库完整app.ready预检通过后再发布。新接口公网会话内实测13行原文逐字正确。
