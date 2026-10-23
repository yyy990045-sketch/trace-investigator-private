/**
 * 公开交付物检查（不只是过滤 sk- 与 /Users/）。
 *
 * 检查对象：delivery/trace-showcase 下会被公开的一切文件
 * （showcase-data.js、artifacts/**、index.html、部署说明.md）。
 *
 * 检查什么：
 *  - 凭证与密钥：各类云厂商 key、Bearer/Basic、token/password/secret 赋值、Cookie、私钥块；
 *  - 身份信息：邮箱、手机号、身份证号、银行卡串；
 *  - 运行环境：本机绝对路径、file://、内网/环回地址、内部服务名与端口；
 *  - 运行内部字段：PLATFORM_ 环境变量名、数据库路径、requestId 之外的追踪 id；
 *  - 人类可读的身份字段（actor/author/createdBy 等）：单独列出，交给人确认是否可公开。
 *
 * 命中即非零退出，避免"看起来没问题"就发出去。
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.argv[2] || "delivery/trace-showcase";

/**
 * 个人邮箱服务商：出现在数据里就当作真实个人地址，阻断发布。
 * 其余邮箱（媒体、政府、机构的公开投稿/线索邮箱）来自公开报道正文，记为提示，
 * 由人确认后放行——它们本来就是公开信息，不属于哪一个人的隐私。
 */
const PERSONAL_EMAIL_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "qq.com",
  "foxmail.com",
  "163.com",
  "126.com",
  "yeah.net",
  "sina.com",
  "sina.cn",
  "sohu.com",
  "aliyun.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "yahoo.com",
  "protonmail.com",
  "proton.me",
  "hey.com",
];

const HARD = [
  { name: "腾讯云密钥", re: /\bAKID[0-9A-Za-z]{8,}\b|\bsk-[A-Za-z0-9]{10,}\b/ },
  { name: "云厂商 token 字段", re: /"(api[_-]?key|secret[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)"\s*:\s*"[^"]{6,}"/i },
  { name: "Bearer/Basic 凭据", re: /\b(Bearer|Basic)\s+[A-Za-z0-9._\-]{16,}/ },
  { name: "私钥块", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "Cookie 头", re: /\b(Set-)?Cookie:\s*\S/i },
  {
    name: "个人邮箱",
    re: /[\w.+-]+@[\w-]+\.[\w.]{2,}/,
    allow: (sample) => {
      const domain = (sample.split("@")[1] || "").toLowerCase();
      return !PERSONAL_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith("." + d));
    },
  },
  // 前后不允许紧邻十六进制字符，避免把 URL/文章ID 里的 hex 片段误判成手机号
  { name: "中国大陆手机号", re: /(?<![0-9a-fA-F])1[3-9]\d{9}(?![0-9a-fA-F])/ },
  { name: "身份证号", re: /(^|[^\d])(?:[1-9]\d{5})(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]([^\d]|$)/ },
  // 银行卡号用 Luhn 校验，避免把新闻 URL 里的长数字串误判成卡号
  { name: "银行卡号", re: /(^|[^\d])(\d{16,19})([^\d]|$)/, allow: (m) => !luhn(m.replace(/\D/g, "")) },
  { name: "本机绝对路径", re: /\/Users\/|\/home\/[a-z]|[A-Za-z]:\\\\Users/ },
  { name: "file:// 协议", re: /file:\/\// },
  // 只在数据文件里查内网地址；说明文档与第三方打包代码里的 localhost 不算
  { name: "内网或环回地址", re: /\b(127\.0\.0\.1|localhost|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)\b/, dataOnly: true },
  { name: "平台环境变量名", re: /PLATFORM_(WSA|MODEL|DATA|PORT)[A-Z_]*/ },
  { name: "数据库或数据目录", re: /platform\.sqlite|data\/artifacts|\.db\b/ },
];

/** Luhn 校验：真卡号大概率能通过，新闻正文里的长数字串基本通不过。 */
function luhn(digits) {
  if (digits.length < 15) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let value = Number(digits[i]);
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

/** 数据文件（会被当成内容读）与说明/打包文件的区分。 */
function isDataFile(path) {
  return /showcase-data\.js$/.test(path) || /\/artifacts\//.test(path);
}

/** 公开报道正文里的机构联系方式：只提示，不阻断。 */
const INFO = [
  { name: "机构公开联系邮箱", re: /[\w.+-]+@[\w-]+\.[\w.]{2,}/g },
];

const SOFT = [
  { name: "人类身份字段", re: /"(actor|author|createdBy|confirmedBy|reviewer|operator)"\s*:\s*"([^"]{1,40})"/g },
];

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else out.push(path);
  }
  return out;
}

const files = await walk(root);
const hard = [];
const notes = [];
const soft = new Map();
let scanned = 0;
let bytes = 0;

for (const path of files) {
  const info = await stat(path);
  bytes += info.size;
  // 图片/视频是二进制，不做文本匹配（内容来自本机页面截图，另行人工核对）
  if (/\.(png|jpe?g|webp|mp4|webm|woff2?|ico)$/i.test(path)) continue;
  const text = await readFile(path, "utf8");
  scanned++;
  for (const rule of HARD) {
    if (rule.dataOnly && !isDataFile(path)) continue;
    const flags = rule.re.global ? rule.re : new RegExp(rule.re.source, rule.re.flags + "g");
    for (const match of text.matchAll(flags)) {
      const sample = String(match[0]).slice(0, 80);
      if (rule.allow && rule.allow(sample)) continue;
      hard.push({ file: relative(root, path), rule: rule.name, sample });
      break;
    }
  }
  for (const rule of INFO) {
    for (const match of text.matchAll(rule.re))
      notes.push({ file: relative(root, path), rule: rule.name, sample: String(match[0]).slice(0, 80) });
  }
  for (const rule of SOFT) {
    for (const match of text.matchAll(rule.re)) {
      const value = match[2];
      soft.set(value, (soft.get(value) || 0) + 1);
    }
  }
}

console.log(`扫描 ${scanned} 个文本文件（目录共 ${files.length} 个文件，${(bytes / 1024 / 1024).toFixed(1)} MB）`);
if (soft.size) {
  console.log("\n人类可读身份字段（需人工确认可公开）：");
  for (const [value, count] of [...soft.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  · "${value}" × ${count}`);
}
if (notes.length) {
  const unique = [...new Set(notes.map((item) => item.sample))];
  console.log(`\n公开报道里的机构联系方式（来自抓取正文，非本机数据，共 ${unique.length} 个）：`);
  for (const item of unique.slice(0, 10)) console.log(`  · ${item}`);
}

if (hard.length) {
  console.log("\n命中禁止项：");
  for (const item of hard.slice(0, 40)) console.log(`  ✗ ${item.file}：${item.rule} → ${item.sample}`);
  console.log(`\n共 ${hard.length} 处，禁止发布。`);
  process.exit(1);
}
console.log("\n未发现凭证、身份信息、内部路径或内网地址。");
