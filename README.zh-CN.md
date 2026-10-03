<div align="center">

<img src="public/logo.svg" width="96" alt="Kumitaku Logo" />

# Kumitaku

**精悍硬核的 JLPT N1 文法特训——近义文法辨析、计时训练、逐选项解析、错题重练，全在一页静态页面里**

[![GitHub Pages](https://img.shields.io/badge/GitHub_Pages-Live-222?logo=githubpages&logoColor=white)](https://mocas-12.github.io/jlpt-n1-Kumitaku/)
[![JavaScript](https://img.shields.io/badge/JavaScript-Vanilla-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
![Static Site](https://img.shields.io/badge/Deploy-Pure_static_zero_dependencies-39538C)
![Local Storage](https://img.shields.io/badge/Data-Stored_only_in_your_browser-2E7D5B)

**[🌐 在线使用（GitHub Pages）](https://mocas-12.github.io/jlpt-n1-Kumitaku/)**

*打开页面 → 学解题技巧 → 计时训练 → 逐项解析 → 错题重练*

[English](./README.md) | **简体中文** | [日本語](./README.ja-JP.md)

</div>

---

## 📖 目录

- [功能特性](#-功能特性)
- [截图](#️-截图)
- [名字的由来](#-名字的由来)
- [训练闭环](#-训练闭环)
- [题库与版权](#-题库与版权)
- [项目结构](#-项目结构)
- [快速开始](#-快速开始)
- [开发](#-开发)
- [题库 JSON 格式](#-题库-json-格式)
- [FAQ](#-faq)
- [隐私与安全](#-隐私与安全)
- [许可证](#-许可证)

## ✨ 功能特性

- 🧭 **按官方题型组织**：对照 JLPT 官方《大題的測試目標》，覆盖文法全部三大題——問題7 文の文法1（形式判断）、問題8 文の文法2（組み立て·統整文）、問題9 文の文法3（文章の文法）
- ⚡ **快速技巧库**：「接续 · 呼应 · 语气」三线排查法、按近义族分组的 28 条高频文法速查、七类干扰选项消去清单、110 分钟时间预算表
- 🗂 **文法库 · 背诵模式**：收录主流备考体系公认的 N1 目录 **268 条**（官方不公布文法清单，本库对照官方测试目标整理，分三层：N1 文型＋文語残存表現＋問題7 选项高频复考的複合助詞与 N2 文法），每条含接续、意思、原创例文＋中译、近义辨析，并标注**高频 91 条**（历年公开真题最常考）；背诵模式遮住释义、点击揭示，「✓ 掌握」进度持久化，支持随机抽背，每条文法可直达同族题组练习
- ⏱️ **计时训练**：每组题带每题时间预算与实时计时，超时标红，还原考场节奏
- 🔍 **逐选项解析**：每个干扰项标注陷阱类型（【接续不合】【近义混同】【呼应冲突】【时态肯否错位】【文体不合】【语序违反】【文脉断裂】），正解条目讲清接续、呼应、语气三要素——不是光给答案
- 🔁 **错题重练闭环**：错题自动收录，按「1 → 3 → 7 天」间隔重复推进，三轮答对才算消灭；弱点画像一键直达定向训练
- 📊 **分题型统计**：各题型正确率进度条＋练习历史＋连续打卡天数
- 🎲 **随机混合与模拟卷**：一键抽 10 问混练，或按官方問題7〜9 蓝图组一套 20 问模拟卷（全局计时）
- 📥 **题库可扩展**：粘贴 JSON / 上传文件导入自建题组（同 id 自动覆盖）；内置 AI 转录提示词，教材题目一粘即转
- 📴 **可安装可离线（PWA）**：manifest + 极简 Service Worker，添加到主屏幕断网也能刷
- 🌓 **深色模式**：跟随系统并可一键切换——藍染和纸漫画风主题的夜间调校
- ⌨️ **键盘作答**：1〜4 选选项、Enter 提交，桌面端全速刷题
- 📝 **会话草稿**：未提交的进度逐题保存，误刷新/误关标签页原样恢复
- 🧳 **记录备份**：正确率、历史、错题本一键导出/导入 JSON，换浏览器无缝迁移
- 💾 **零后端**：全部数据只存浏览器 localStorage，双击即用

## 🖼️ 截图

| 概览 | 训练入口 |
| --- | --- |
| ![概览](docs/shot-home.png) | ![训练入口](docs/shot-list.png) |
| **训练中（形式判断）** | **文章の文法：原文＋逐项解析** |
| ![训练中](docs/shot-practice.png) | ![解析](docs/shot-explain.png) |
| **模拟卷（官方構成）** | **深色模式** |
| ![模拟卷](docs/shot-mock.png) | ![深色](docs/shot-dark.png) |
| **文法库（背诵模式）** | |
| ![文法库](docs/shot-bunkei.png) | |

## 🏷️ 名字的由来

**Kumitaku（組みたく）**——取自「組み立てたい」（想组装）。它是 [Yomitaku](https://github.com/Mocas-12/jlpt-n1-Yomitaku)（読みたく，「想读懂」）的姊妹站：同样的节奏、同样的「〜たい」构词，而且正好落在官方大題「問題8 **文の組み立て**」的名称上。読解训练把句子拆开看，文法训练把句子组装起来——一拆一装，正好是一套。

视觉上沿用 Yomitaku 的漫画和纸卡片语言，把朱色换成藍色——朱印与藍染，一组经典的日式配色。

## 🔁 训练闭环

```
技巧库（接续·呼应·语气 三线排查 + 高频文法速查）
        ↓
专项训练（26 组原创题 · 计时 · 键盘作答）
        ↓
逐选项解析（干扰项陷阱归类 + 正解三要素说明）
        ↓
错题本（1 → 3 → 7 天间隔重复，三轮答对毕业）
        ↓
弱点画像 → 定向重练 → 模拟卷检验
```

## 📚 题库与版权

内置题库为 **26 组 / 132 道原创模拟题**（明确标注非真题）：形式判断 60 问按近义族分组（让步·逆接、義務·被迫、敬語……）；組み立て 48 问采用与官方完全一致的「＊空格統整文」形式；文章の文法 24 问基于六篇原创文章。

JLPT 真题版权归日本国際交流基金会／JEES，市面教材版权归各自作者——本站不含、也不传播任何受版权保护的题目。想用成熟教材训练，把题目按 JSON 格式转录后在「真題·題库」页导入即可（页面内置 AI 转录提示词）。

## 📂 项目结构

```
├── index.html               # 单页应用（5 个 hash 路由板块）
├── css/style.css            # 藍色漫画和纸主题（浅/深双主题）
├── js/app.js                # 全部交互逻辑（零依赖，支持 file:// 打开）
├── js/bunkei.js             # 文法库数据（268 条 · 13 分类 · 含高频标注）
├── js/bank/                 # 内置题库分片（纯数据）
│   ├── core.js              #   公共头部 + window.BANK
│   ├── bun1.js              #   問題7 形式判断 ×12 组 / 60 问
│   ├── kumi.js              #   問題8 組み立て   ×8 组 / 48 问
│   └── sho.js               #   問題9 文章の文法 ×6 组 / 24 问
├── scripts/                 # 开发脚本（零依赖 Node）
│   ├── check-bank.mjs       #   题库结构与质量校验（npm run check）
│   ├── version.mjs          #   资产内容哈希指纹 + SW 缓存名改写
│   ├── make-assets.mjs      #   OG 横幅 + PWA 图标（需 Playwright）
│   ├── make-screenshots.mjs #   README 截图
│   └── update-docs.mjs      #   同步题库规模数字到 README
├── tests/                   # Playwright 冒烟测试（19 个场景）
├── public/                  # logo / 图标 / OG 横幅 / 鸣谢收款码
└── .github/workflows/       # CI：题库校验 → 冒烟测试 → 部署 Pages
```

## 🚀 快速开始

- **在线**：打开[线上站点](https://mocas-12.github.io/jlpt-n1-Kumitaku/)，添加到主屏幕，离线可刷。
- **本地**：克隆仓库后双击 `index.html` 即可运行（支持 `file://`）。

## 🛠️ 开发

```bash
npm install          # 唯一开发依赖：Playwright
npm run check        # 校验题库（结构、答案、正解分布）
npm test             # 对本地服务器跑 19 个冒烟场景
npm run hash         # 改写资产 ?v= 哈希 + SW 缓存名
npm run assets       # 重新生成 OG 横幅 / 图标（需 Chromium）
node tests/server.mjs 8322   # 本地起服务，再跑 node scripts/make-screenshots.mjs
```

CI（`.github/workflows/static.yml`）依次执行题库校验、冒烟测试、资产指纹改写与 Pages 部署——测试不绿不上线。

## 📋 题库 JSON 格式

```jsonc
[
  {
    "id": "wb2018-q7-1",              // 唯一 ID，重复导入即覆盖更新
    "typeKey": "bun1",                // bun1 | kumi | sho
    "title": "公式問題例 問題7",
    "source": "公式問題例PDF（2018）", // 可选：显示为来源徽章
    "sourceUrl": "https://www.jlpt.jp/samples/sample2018/pdf/N1G.pdf", // 可选
    "minutes": 4,
    "questions": [                    // bun1：无 passage，句子写在 q 里
      { "q": "台風の接近に＿＿、出発を一日早めた。",
        "label": "近义辨析",
        "options": ["にあたって", "にひきかえ", "に即して", "に限って"],
        "answer": 0,                  // 正解下标 0〜3
        "explain": ["正解。…", "【接续不合】…", "【近义混同】…", "【呼应冲突】…"] }
    ]
  },
  { "id": "wb2018-q8-1", "typeKey": "kumi", "title": "…", "minutes": 4,
    "questions": [
      { "q": "田中さんは　＿＿・＿＿　＊＿＿・＿＿　帰国したそうだ。", // ＊＝目标空格
        "label": "句序组合",
        "options": ["三年ぶりに", "海外勤務を", "終えて", "ようやく"],
        "answer": 0, "explain": ["…", "…", "…", "…"] } ] },
  { "id": "wb2018-q9-1", "typeKey": "sho", "title": "…", "minutes": 4,
    "passage": "文章正文……【一】……【二】……【三】……【四】……",
    "questions": [
      { "q": "【一】に入れるのに最もよいものを、①・②・③・④から一つ選びなさい。",
        "label": "文脉衔接",
        "options": ["完整选项句1", "完整选项句2", "完整选项句3", "完整选项句4"],
        "answer": 2, "explain": ["…", "…", "…", "…"] } ] }
]
```

## ❓ FAQ

<details>
<summary><b>内置题库是真题吗？</b></summary>
不是。全部题目为按官方出题目标编写的原创模拟题，标注「本站原创模拟（非真题）」。JLPT 真题受版权保护，本站不含、也不传播任何真题原文。
</details>

<details>
<summary><b>和 Yomitaku 是什么关系？</b></summary>
同一作者、同一训练闭环、同一设计语言——Yomitaku 练読解（読解問題10〜12），Kumitaku 练文法（言語知識問題7〜9）。这边把文法刷稳，再把省下的时间预算拿到 Yomitaku 去攻読解。
</details>

<details>
<summary><b>我的练习记录存在哪？</b></summary>
只存本机浏览器 localStorage，不上传任何数据。换浏览器用「真題·題库」页的备份导出/导入迁移。
</details>

## 🔒 隐私与安全

- 无后端、无统计、无追踪；练习数据只存 localStorage。
- 导入的来源链接只放行 http(s)，遗留数据的其他 scheme 在渲染层被中和为站内锚点。
- Service Worker 只缓存同源资源；Google Fonts 请求原样放行。

## 📄 许可证

[MIT](./LICENSE) © 2026 Mocas-12

试题版权归 日本国際交流基金会／日本国際教育支援協会（JEES）及各教材作者所有；本项目不含任何受版权保护的题目文本。
