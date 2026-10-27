# dsh-dfy-qq

给 DSH（DeepSeek Harness）加一个 **QQ 对话行为层**：人设、认人、表情包、主动接话、子人格，全在一个插件里，配一个可视化设置页。

不绑定任何一台机器：所有路径默认相对「工作区」，第一次装完只要指定工作区就能跑。

---

## 群友子人格（0.5.5）

默认**关**。打开以后，群里谁说话就记谁的原话（只记文本，不记图），攒够了几句就能把 TA 的**语气**蒸馏成一份子人格文档：

- 攒原话：每条群里消息进 `state.peopleVoice`，按 `voiceSamples`（默认 40 句）/ `voiceChars`（默认 6000 字）截断；重复的一句不重复记，`/` 开头的指令不记。
- 生成：设置页「认人」区块 → 某个群友那行点「生成子人格」，或者让模型调 `dfy_people_persona`。
- 落到 `personas/群友/<昵称>-<账号>.md`，里面有「这是谁 / 语言指纹（平均字数、最长、高频短语）/ 原话样本 / 用的时候」。
- 生成的人格**默认可用**，跟本机人格一起出现在系统提示里，文件名带 `群友/` 前缀；不想让它上场就把它加进 `personasEnabled` 的排除表。
- 边界写进文档本身：只借语气和断句，不冒充本人、不替他承诺、不抖私事。

为什么用账号当主键：昵称会变，号不变。跟「认人 · 群友档案」是同一套身份（档案里那行会被抄进人格文档）。

## 配置持久化（0.5.4）

插件被关掉再打开、patch 行被清空、甚至工作区路径换了，配置都不会丢：

- 生效配置每次启动都会存到 `~/.dsh/dfy-qq-config.json`（跟 profile、工作区无关的固定位置）。
- 启动合并顺序：默认值 → 快照 → **这次 patch 里真正改过的键**（改回默认也算"改过"）。
- 设置页保存时同时写快照，所以界面改的也算数。
- 旧的工作区文件 `<workspace>/.dfyqq/config.json` 只给快照里没有的键兜底，不再压过 patch。
- 想彻底重置：删掉 `~/.dsh/dfy-qq-config.json` 再重启。

## 它解决什么

QQ 里的机器人和网页里聊天是两回事：

- 网页里有系统提示、有记忆、知道你昨天说过什么；QQ 通道里往往只剩一句用户消息。
- 你会想让它"像某个人"，而不是"像一个助手"。
- 你会想让它偶尔发表情包，而不是永远纯文字。
- 你会想让它在该接话的时候接一句，而不是只回 @。

这个插件把这几件事做成宿主侧的规则，而不是靠模型每轮"记得去做"。

---

## 六个能力

| 能力 | 做什么 |
| --- | --- |
| 人设装载 | 读一个或多个 md/txt 文件（或直接写文本），拼成 system prompt 注入每一轮 |
| 认人 | 读群友档案 md 注入；见过的号自动记录昵称/次数；提供 `dfy_people_upsert` 写档案 |
| 表情包 | 扫目录建索引、掷骰子决定这轮发不发、大保底兜底、按语境和"最近没发过"挑图 |
| 主动接话 | 给通道层一个 `shouldSpeak()`：关键词命中 / 概率 / 冷却 |
| 子人格 | 扫 `personas/` 目录，注入人格清单，模型按语境挑 0~2 个读全文再用 |
| 群聊记忆 | 每个会话保留最近 N 条（谁说了什么），超出的自然滚掉 |

另外还有：回复长度硬约束、配置体检。

---

## 安装

仓库地址：<https://github.com/beiheng127/dsh-dfy-qq>

它是个 **本地插件**，不走 npm 发布，装法是「clone 到插件目录 → 写进 profile → 重启」。

### 1. 拿代码

```bash
git clone https://github.com/beiheng127/dsh-dfy-qq.git ~/.dsh/plugins/dsh-dfy-qq
```

不想用 git 也行：在仓库页点 **Code → Download ZIP**，解压成 `~/.dsh/plugins/dsh-dfy-qq`（目录名必须一致）。

### 2. 注册进 profile

DSH 不会自动扫 `plugins/` 目录，得在**你正在用的那个 profile** 的 `package.json` 里登记两处。profile 一般在 `~/.dsh/profiles/<名字>/package.json`（桌面版默认是 `desktop`）。

```jsonc
{
  "dependencies": {
    // 加这一行，路径换成你的实际路径
    "dsh-dfy-qq": "link:C:/Users/you/.dsh/plugins/dsh-dfy-qq"
  },
  "dsh": {
    "profile": {
      "bundles": [
        // ...原有的一堆...
        "dsh-dfy-qq"
      ]
    }
  }
}
```

改完在 profile 目录里跑一次：

```bash
cd ~/.dsh/profiles/desktop
pnpm install
```

它会按 `link:` 建好 `node_modules/dsh-dfy-qq` 的软链。

### 3. 重启 DSH

重启后 **设置 → 肥鱼·QQ** 会出现配置页。

> `cordis.patch.yml` 负责把插件挂进运行时，`package.json` 里的 `dsh.client` 负责把它注册成设置页的一个 tab。两处缺一个，效果就是"插件在、设置页不在"或者反过来。

---

## 第一次配置

打开 设置 → 肥鱼·QQ，从上往下填四块：

### 1. 工作区

所有相对路径的根。填 `D:\my-workspace` 这种绝对路径即可。

### 2. 人设

「人设文件」一行一个，按顺序拼接。例如：

```
kb/persona.md
AGENTS.md
```

也可以直接在「人设文本」里写全文（**文本优先于文件**）。

填完保存，页面上会显示 `当前来源: … · N 字符`。**字数是 0 或很小，就是没读到**，看下面的「配置体检」。

### 3. 子人格（可选）

目录默认 `personas`，一个 `.md` 一个人格。文件格式：

```markdown
# 人格名

> 简介：一句话说清她跟别人哪里不一样。

## 她是谁
## 语言指纹
## 温度
## 什么时候上
## 绝不做
## 样例
```

插件只从 `# 标题` 和 `> 简介：` 两行抽摘要，其余全文在模型调 `dfy_persona_read` 时才读。

### 4. 表情包

- **文件夹**：留空 = `<工作区>/emoji`；相对路径按工作区解析；子目录会递归扫。
- **索引文档**：默认 `kb/表情包-索引.md`，第一次扫到图会自动生成。
- **发图概率 / 大保底**：概率是每轮的基准，大保底是"连续 N 轮没发就强制发一张"。
- **重建索引 / 清零保底**：两个按钮。

> ⚠️ QQ 只认 `gif / png / jpg`，`webp` 发出去会变成文件卡片。插件挑图时优先可直发的格式；库里只有 webp 的话，自己先批量转一下。

#### 让模型会挑图：填「用途」列

索引生成的表格长这样：

```markdown
| 文件 | 来源 | 大小(KB) | 用途 / 情绪 |
| --- | --- | --- | --- |
| 22c59f86e9071d8e.png | 大肥鱼 | 151 | 得意、叉腰、抓到你了 |
| 16f189ed37aa6966.webp | 大肥鱼 | 11 | 委屈、快哭了、撒娇 |
```

第四列填关键词（用 `、` 分隔），插件就会在发图时按最近几条聊天内容匹配挑图。**不填就是随机挑**——随机也能用，只是容易图文不搭。

---

## 接入聊天通道

**现在自带通道了**：插件里跑一个 OneBot 11 反向 WebSocket 服务（`channel.js`），NapCat / LLOneBot / go-cqhttp 连上来就能用，不需要再装 `dsh-onebot-qq`。

### 1. 开通道

设置页 →「肥鱼·QQ」→「QQ 通道（内置 OneBot 11）」→ 打开开关。默认：

```text
ws://127.0.0.1:6700/onebot/v11/ws
```

要 token 就填 `access_token`，NapCat 那边填同一个。

### 2. NapCat 配反向 WS

NapCat 的 `onebot11_<QQ号>.json`（或者 WebUI 里）加一条：

```json
{
  "network": {
    "websocketClients": [
      { "name": "dsh-dfy-qq", "url": "ws://127.0.0.1:6700/onebot/v11/ws", "token": "", "enable": true }
    ]
  }
}
```

连上后设置页会显示「已连 1 个」，`<工作区>/.dfyqq/channel.log` 里也有 `OneBot 已连接`。

### 3. 消息怎么走

- 群里被 @、或者命中关键词 / 概率接话 → 建一个 DSH 会话（`sessionId = dfyqq-group-<群号>`），把这条消息 `followup` 进去。
- 模型吐出来的文本按 `replyMaxChars` 拆段，逐段 `send_msg` 发回去。
- 想发图：模型调 `dfy_emoji_draw` 拿到路径，通道读到路径就 `send_group_msg`（`image` 段）发出去。
- 同一个群共用一个会话，上下文连续；`.dfyqq/qq-channel.json` 记住会话 id，重启后接得上。

### 4. 定时任务

设置页「定时任务」区块，一行一条：

```text
09:00 | 123456789 | 早上问个好
21:30 | private-934705339 | 提醒今天没写完的活
```

`HH:MM | 群号或 private-QQ | 主题`；`#` 开头忽略。到点由插件自己建/复用会话，让模型按主题主动开一句再发出去。同一分钟同目标一天只跑一次（记在 `qq-channel.json`）。

> 不想要自带通道也还能接别的：插件对外提供 `dfyqq` 服务和 `shouldSpeak()`，任何通道层都能调。
>
> ```js
> const verdict = ctx.get('dfyqq')?.shouldSpeak(payload);
> if (verdict?.speak) { /* 放行这条消息 */ }
> ```
>
> `payload` 里带 `text`、`mentioned`、`groupId`、`userId`、`nickname` —— 带得越全，短期记忆和认人越准。

> 官方 QQ 机器人通道只推送 `@` 过的群消息，插件侧算得再准也接不到——想接话必须走 OneBot（NapCat / LLOneBot 之类）。

### 发表情包

模型侧调 `dfy_emoji_draw` 拿到路径，由通道层当图片发出去。

---

## 配置项

设置页里都能改，也存在 `<工作区>/.dfyqq/config.json`（**这里的值覆盖 cordis 配置**）。

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `workspace` | 进程 cwd | 工作区根目录 |
| `personaText` | `''` | 直接写的人设全文，优先于文件 |
| `personaFiles` | `[]` | 人设文件列表，相对工作区 |
| `personaPath` | `''` | 旧字段，逗号/换行分隔，仍兼容 |
| `peopleFile` | `kb/认人-群友档案.md` | 群友档案 |
| `personasDir` | `personas` | 子人格目录 |
| `personasEnabled` | `[]` | 启用的人格文件名；空 = 全启用 |
| `personaAuto` | `true` | 是否允许按语境自动挑人格 |
| `emojiDir` | `''` | 表情包目录；空 = `<工作区>/emoji` |
| `emojiIndexFile` | `kb/表情包-索引.md` | 索引文档 |
| `emojiChance` | `0.5` | 发图概率 |
| `emojiPity` | `4` | 大保底轮数 |
| `emojiRecentSkip` | `8` | 最近这么多张不重复发 |
| `autoSpeakEnabled` | `false` | 允许不 @ 接话 |
| `autoSpeakChance` | `0.12` | 接话概率 |
| `autoSpeakCooldownMin` | `8` | 接话冷却（分钟） |
| `autoSpeakKeywords` | `[]` | 命中即接话 |
| `memoryRounds` | `20` | 每个会话保留最近多少条 |
| `memoryChats` | `3` | 同时保留几个会话 |
| `replyMaxChars` | `220` | 单条回复字数上限，0 = 不限 |
| `qqEnabled` | `false` | 开关内置 OneBot 通道 |
| `qqWsPort` | `6700` | 反向 WS 监听端口 |
| `qqHost` | `127.0.0.1` | 监听地址 |
| `qqAccessToken` | `''` | OneBot token，空 = 不校验 |
| `qqGroups` | `[]` | 群白名单，空 = 全部群 |
| `qqSelfQQ` | `''` | bot 自己的 QQ，防空回复回环 |
| `qqCwd` | `''` | QQ 会话工作目录（相对工作区） |
| `qqTasks` | `''` | 定时任务，一行一条 `HH:MM \| 目标 \| 主题` |
| `stateDir` | `<工作区>/.dfyqq` | 状态目录 |

---

## 工具

模型在对话里可以直接调：

| 工具 | 用途 |
| --- | --- |
| `dfy_persona_show` | 看当前人设来源、字数、开头 800 字 |
| `dfy_people_upsert` | 往群友档案里写/改一行（账号为主键） |
| `dfy_emoji_draw` | 掷骰子决定发不发；`force: true` 直接抽一张 |
| `dfy_emoji_status` | 看图库状态 |
| `dfy_persona_list` | 列子人格（带使用次数） |
| `dfy_persona_read` | 读某个人格全文（读一次记一次，日志在 `.dfyqq/persona-usage.jsonl`） |

---

## 配置体检

设置页顶部和 `GET /api/dfy-qq/status` 的 `checks` 会直接说哪里不对：

- 工作区不存在 / 人设是空的 / 人设只有几十字（多半只读到半截）
- 表情包目录没图 / 索引没建 / 群友档案不存在 / 人格目录是空的

---

## 架构：两个半边端，各管一段

DSH 插件是「一个 npm 包，两半代码」，`package.json` 的 `dsh.client` 字段把两半分别指向不同进程：

| 文件 | 跑在哪 | 干什么 | 依赖什么 |
|---|---|---|---|
| `index.js` | DSH 主进程（Node） | 读人设/群友档案/表情包目录，注册 6 个工具、注入 system prompt、挂 `/api/dfy-qq/*` 路由，并把服务对象挂到 `ctx.dfyqq` | 只依赖 DSH 运行时给的 `ctx`（`ctx.tools` / `ctx.systemPrompt` / `ctx.webServer` / `ctx.provide`）；`@deepseek-ai/dsh-tools` 和 `schemastery` 是可选 peer，装不上就退化成普通对象，不会崩 |
| `client.js` | 浏览器（DSH Web GUI 里） | 往「设置」左侧导航塞一个「肥鱼·QQ」面板：表单、开关、配置体检、保存按钮 | 只用宿主注入的 `React` 和无构建 JSX 替身 `h()`，不 import 任何包、不需要打包器 |

两半之间不共享内存，只通过 HTTP 讲话：`client.js` 调 `index.js` 挂的 `/api/dfy-qq/status`、`/api/dfy-qq/config`、`/api/dfy-qq/emoji/rebuild`、`/api/dfy-qq/reset-pity`。所以**改完两半都要重启 DSH**，前端那半刷新页面也行。

保存按钮在设置页顶部（白底按钮，滚动时吸顶），改完表单会显示「● 有未保存改动」，点「保存」才落盘到 `<stateDir>/config.json`。底部还复制了一份，省得滚到底再爬回去。

### 它需不需要别的插件？

不需要。六个工具、设置页、表情包索引、配置体检全部独立可用——装上就能用，没人调用也不报错。

唯一需要外部的是「真的去 QQ 群里说话」这一步：本插件是**行为层**，不连 QQ 协议。它把判定函数挂在 `ctx.dfyqq` 上，谁有通道谁调：

```js
const dfy = ctx.dfyqq;                       // 或 ctx.get('dfyqq')
const { speak, reason } = dfy.shouldSpeak({ text, groupId, userId, nickname, mentioned });
if (speak) {
  await sendToQQ(reply);                     // 你自己通道层的事
  const img = dfy.drawEmoji({ context: text });  // 有图就发
}
```

没有通道层插件时，你依然可以：在设置页配人设、用 `dfy_persona_list`/`dfy_people_upsert`/`dfy_emoji_status` 这些工具、手动调 `dfy_emoji_draw` 抽图。所以别人 clone 下来是可以单独跑起来看的，只是不会自己去群里讲话。

## 目录结构

```
dsh-dfy-qq/
├── index.js           # 宿主侧：context、工具、路由、shouldSpeak
├── client.js          # 设置页（浏览器侧）
├── cordis.patch.yml   # 注册进 profile
├── README.md
└── test/
```

运行时会写：

```
<工作区>/.dfyqq/config.json        # 设置页保存的覆盖层
<工作区>/.dfyqq/state.json         # 保底计数、群聊记忆、见过的号、最近发过的图
<工作区>/.dfyqq/persona-usage.jsonl
```

---

## 常见问题

**设置页改完没生效？**
改工作区、改人设要**保存后重启 DSH**；其余字段下一轮就生效。

**表情包一张都没扫到？**
目录填到父级也行（会递归），但确认里面真有图；也可能是全 webp——能扫到但挑图池会受限。

**群里还是只回 @？**
插件给了 verdict，通道层还得放行。官方 QQ 机器人通道直接放弃这条路。

**人设读到了但说话不像？**
先看字数。几千字才是对的，几十字基本是路径错或只读到标题。人设是"怎么说"，工具是"做什么"，两者不冲突。

---

MIT
