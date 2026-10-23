# 溯证 TRACE · 交付物清单（投稿前核对）

公网作品地址：**https://trace-showcase-eight.vercel.app**（只读历史回放）

> 2026-10-23 本轮：A/B/C各5/4/6版保留，新增真实DeepSeek案例D（1版），共32个原始档案文件。投稿简介、同版视频与实际限制见 `../docs/2026-10-23-trace-final-submission.md`。旧档案不改写，页面对历史系统措辞作准确说明。

## 目录结构

```
delivery/
├── trace-showcase/          只读展示站点（已部署到上面那个地址）
│   ├── index.html
│   ├── showcase-data.js     A/B/C/D真实运行数据（已剔除密钥与本机路径）
│   ├── artifacts/           32个原始档案文件（各已交付版本的 md+json）
│   └── 部署说明.md
├── materials/               A/B/C三份真实查询 + D模型复核 + C进阶报告（PDF + Markdown）
│   ├── 案例A·原始证据调查：个人信息保护法施行日期.pdf / .md
│   ├── 案例B·多来源交叉核查：2024年新能源汽车产量.pdf / .md
│   ├── 案例C·证据不足与继续追问：全国氢能重卡加氢网络.pdf / .md
│   ├── 案例C·进阶调查报告：一条氢能说法为什么查不下去.pdf / .md
│   └── shots/               生成材料时现场截取的页面截图
└── demo/
    ├── trace-submission-final.mp4   本轮主视频：现场浏览历史记录，突出C/D
    ├── trace-deepseek-replay.mp4    本轮D短片：已完成模型调用的记录回放
    ├── trace-demo-full.mp4          旧视频，仅历史留存，不用于本次投稿
    └── trace-demo-showcase-only.mp4 旧视频，仅历史留存
```

## 投稿对应关系

| 表单字段 | 用哪个 |
| --- | --- |
| 作品名称 | 溯证 TRACE |
| 一句话简介 | 把一句可疑说法交给证据去检验——真实联网检索、抓原文、认转载、判支持与反对，最后给一份可复查、可追问、可纠错、有版本的调查档案。 |
| 作品地址 | https://trace-showcase-eight.vercel.app |
| 演示视频 | `demo/trace-submission-final.mp4`；D补充短片 `demo/trace-deepseek-replay.mp4` |
| 案例材料 ×3 | `materials/案例A…pdf`、`案例B…pdf`、`案例C…pdf` |
| 进阶报告 | `materials/案例C·进阶调查报告…pdf`；D模型复核说明见同目录 |
| 赛道 / 工具 | 侦探 / 元宝搜索（腾讯云 WSA SearchPro）+ DeepSeek辅助语义复核 |

## 真实案例直链

- A 有明确原始证据（《个人信息保护法》施行日期，当前已交付 v5）
  https://trace-showcase-eight.vercel.app/#/archive/run_13dcfa4f-3074-4bdc-a36b-53b2933bb7b8
- B 需要跨来源核查（2024 新能源汽车产量超 1200 万辆）
  https://trace-showcase-eight.vercel.app/#/archive/run_ef9af382-947a-4a9d-acd0-34b496b3d9b3
- C 补充调查后仍证据不足（全国氢能重卡加氢网络，当前已交付 v6）
  https://trace-showcase-eight.vercel.app/#/archive/run_d34a959a-e748-4208-b9a6-eac33c1de13a
- D 《民法典》施行日期｜模型辅助复核（12.3秒、5条引用）
  https://trace-showcase-eight.vercel.app/#/cases/run_895b5bfe-69f8-4878-ab41-af4fc3f3fe82

## 重新生成 / 重新部署

```sh
npm run build:showcase                      # 从本机 Runtime 只读重新导出静态站
node tooling/trace-showcase-audit.mjs       # 检查公开文件里的凭证、身份信息、内网地址
node tooling/trace-final-materials.mjs       # 从已导出的A/B/C/D记录生成本轮说明材料
cd delivery/trace-showcase && vercel deploy --prod --yes --scope kian-7b2166f2
```

公网发布前的检查顺序永远是：导出 → 审计（`trace-showcase-audit.mjs` 必须 0 阻断项）→ 部署。审计会对个人邮箱、手机号、身份证/银行卡（Luhn 校验）、Bearer/token、私钥块、本机路径、内网与环回地址逐条判定，并把人类可读的身份字段单列出来给人确认。

## 旧视频留存

- 三份案例材料 PDF：每个约 0.6–0.7 MB；进阶报告约 0.9 MB — 一般表单都能直接传。
- 旧完整视频15 MB（2分46秒），仅作原始运行证据，不替代本轮同版回放。不要用旧画面配新功能说明。

```sh
ffmpeg -y -i delivery/demo/trace-demo-full.mp4 -c:v libx264 -crf 33 -preset slow -vf "scale=960:600" -movflags +faststart delivery/demo/trace-demo-full-lite.mp4
```

本轮视频均标注历史记录回放，不包含新的实时搜索或模型生成。

## 来源独立性口径（第三轮）

- 三态：`同源转载`（能指认是同一篇，按 1 条计）/ `独立性未确认`（有线索无依据，不计入）/ `未检测到重复`（只是没发现重复，**不代表已证实独立**）。
- 可合并依据：同一网址（含 big5/镜像还原）、**同一发布方的同一文章编号**、摘要逐字一致、正文高度重合。
- 跨站同标题、跨站同编号、相似摘要只作线索 → 标为独立性未确认。
- 共同原始出处：两条以上来源明确引用同一机构发布的数据（如中汽协、国家能源局）时，结论里按 1 条独立证据计，并在来源卡片与档案里并列显示。

## 界面改版（第二轮）

- 版式：内容区 1200px、正文 15–16px；1440 / 2048 / 390 三种宽度都验证过无横向溢出。
- 首页：非对称双栏（左讲价值与原操作，右是主推案例 C 的真实摘要），三个案例三种信息组织。
- 调查过程页：新增「当前结论」卡片、每条事实的「证据关系视图」、人工修正前后对比卡。
- 档案页：版本对比表（结论/来源/原文/追问/修正/变化），点行切版本，下载随版本切换。
- 截图（公网页面实拍）：`docs/screenshots/trace-v2-{home,case-c,archive-c,archive-a}-{desktop,mobile}.png`，另有大屏 `trace-v2-home-wide.png`。

## 边界（写进投稿也不心虚的部分）

- 公网页面是**只读历史记录**，不提供实时检索；页面本身写明这一点，输入框按下也不会假装在跑。
- 本机 Runtime 无鉴权，**没有**把 4313 端口暴露到公网。
- A/B/C未调用模型；D已真实完成DeepSeek辅助语义复核。事实拆解仍人工，模型异常场景未逐项实调。人工修正与规则自动判断同时保留。
- 档案按版本冻结：旧版本下载永远是旧结论。
