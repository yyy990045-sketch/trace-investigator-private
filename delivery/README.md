# 溯证 TRACE · 交付物清单（可直接提交）

公网作品地址：**https://trace-showcase-eight.vercel.app**

## 目录结构

```
delivery/
├── trace-showcase/          只读展示站点（已部署到上面那个地址）
│   ├── index.html
│   ├── showcase-data.js     三个案例的真实运行数据（已剔除密钥与本机路径）
│   ├── artifacts/           12 个真实档案文件（调查档案 / -v2 / -v3 的 md+json）
│   └── 部署说明.md
├── materials/               三份真实查询材料 + 进阶调查报告（PDF + Markdown）
│   ├── 案例A·原始证据调查：个人信息保护法施行日期.pdf / .md
│   ├── 案例B·多来源交叉核查：2024年新能源汽车产量.pdf / .md
│   ├── 案例C·证据不足与继续追问：全国氢能重卡加氢网络.pdf / .md
│   ├── 案例C·进阶调查报告：一条氢能说法为什么查不下去.pdf / .md
│   └── shots/               生成材料时现场截取的页面截图
└── demo/
    ├── trace-demo-full.mp4          投稿用，2 分 46 秒：只读展示 + 本机实时联网调查
    └── trace-demo-showcase-only.mp4 只读展示段（100 秒，历史记录回放）
```

## 投稿对应关系

| 表单字段 | 用哪个 |
| --- | --- |
| 作品名称 | 溯证 TRACE |
| 一句话简介 | 把一句可疑说法交给证据去检验——真实联网检索、抓原文、认转载、判支持与反对，最后给一份可复查、可追问、可纠错、有版本的调查档案。 |
| 作品地址 | https://trace-showcase-eight.vercel.app |
| 演示视频 | `demo/trace-demo-full.mp4` |
| 案例材料 ×3 | `materials/案例A…pdf`、`案例B…pdf`、`案例C…pdf` |
| 进阶报告 | `materials/案例C·进阶调查报告…pdf` |
| 赛道 / 工具 | 侦探 / 元宝搜索（腾讯云 WSA SearchPro） |

## 三个案例直链

- A 有明确原始证据（《个人信息保护法》施行日期，v1→v2）
  https://trace-showcase-eight.vercel.app/#/archive/run_13dcfa4f-3074-4bdc-a36b-53b2933bb7b8
- B 需要跨来源核查（2024 新能源汽车产量超 1200 万辆）
  https://trace-showcase-eight.vercel.app/#/archive/run_ef9af382-947a-4a9d-acd0-34b496b3d9b3
- C 补充调查后仍证据不足（全国氢能重卡加氢网络，v1→v2→v3）
  https://trace-showcase-eight.vercel.app/#/archive/run_d34a959a-e748-4208-b9a6-eac33c1de13a

## 重新生成 / 重新部署

```sh
npm run build:showcase                      # 从本机 Runtime 只读重新导出静态站
node tooling/trace-showcase-audit.mjs       # 检查公开文件里的凭证、身份信息、内网地址
node tooling/trace-case-sheets.mjs          # 重新生成三份案例材料
node tooling/trace-report-c.mjs             # 重新生成 C 进阶报告
cd delivery/trace-showcase && npx vercel deploy --prod --yes --team kian-7b2166f2
```

公网发布前的检查顺序永远是：导出 → 审计（`trace-showcase-audit.mjs` 必须 0 阻断项）→ 部署。审计会对个人邮箱、手机号、身份证/银行卡（Luhn 校验）、Bearer/token、私钥块、本机路径、内网与环回地址逐条判定，并把人类可读的身份字段单列出来给人确认。

## 边界（写进投稿也不心虚的部分）

- 公网页面是**只读历史记录**，不提供实时检索；页面本身写明这一点，输入框按下也不会假装在跑。
- 本机 Runtime 无鉴权，**没有**把 4313 端口暴露到公网。
- 未调用任何模型为结论背书；人工修正与系统自动判断同时保留。
- 档案按版本冻结：旧版本下载永远是旧结论。
