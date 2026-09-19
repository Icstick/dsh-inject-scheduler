---
id: DOC-RESEARCH-PEER-SURVEY-20260909
status: draft
surveyed_on: 2026-09-09
scope: dsh-inject-scheduler 同类插件与相邻项目同行调研
---

# dsh-inject-scheduler 同行调研与可吸纳方法（2026-09-09）

## 0. 调研方法与范围

- **取证通道**：`gh` 2.98.0（账号 Icstick）。星数一律
  `gh api repos/<owner>/<repo> --jq '.stargazers_count'` 实测；README/源码用
  `gh api .../readme` 与 `.../contents/<path>` 带 `Accept: application/vnd.github.raw` 取原文。
- **实测时间**：2026-09-09 20:20–20:40（UTC+8）。
- **「这个领域是不是真的空」的取证**（三条独立探针，全部实测）：
  1. `gh search code "registerSection"` → **零 DSH 命中**（返回的全是 linuxtrack、joplin 插件等
     无关项目）。说明这套 API 命名没有生态先例。
  2. `gh search repos "dsh-plugin token budget"` → **0 结果**；
     `gh search repos "prompt assembly" --topic dsh-plugin` → **0 结果**。
  3. awesome-dsh-plugin 目录共 **1000** 条插件条目，文件名含
     inject/budget/section/ledger 的只有 4 条：
     `PerryLink__dsh-budget`、`173787247__dsh-tool-budget`、
     `MoonlitDropOfBlood__dsh-model-prompt-injector`、`Binaryinject__dsh-review-checkout`
     （最后一条与注入无关）。
  **结论（实测支撑）**：「跨插件注入段注册/排序/记账」这一层在 DSH 生态里**确实没有同款**。
  最接近的两个是 granular-prompt（只读普查 + suppress/replace，不记账、无预算）与
  context-doctor（只读成本审计，不注册段）。空位是真的，但**相邻做法很密集**——下面第 3 节
  的方法基本都能从相邻项目直接搬。
- **本仓现状基线**：`README.md`、`docs/PROJECT-SUMMARY.md`、`docs/B10-CONTRACT.md`、
  `docs/M5-ASSEMBLY.md`、`docs/PLAN-M1..M4.md`，以及 `src/service.mjs`、`src/domain.mjs` 原文。
- **没做什么**：没安装/运行任何同行插件（结论均来自原文）；没做跨插件并发压测；
  生态外只取了 desktop-cc-gui 的 README（其 Context Ledger 仅在 README 描述层，
  **未取到实现源码**，故只作字段设计参照、不引用其内部机制）。

## 1. 我们的定位（一句话）

**不做第四个注入实现，做注入面的观测/调度层**——各注入方（ACP composer / WC / maid / 未来者）
声明自己的段（key/order/budget/unit/refresh），调度器统一排序、按字符口径记账、检测冲突，
数据落官方 storageDomain，同时作为 B10 面板的数据源；**不接管**现有注入实现。

## 2. 同行地图

| 项目 | ★ | 做什么 | 与我们的关系 |
|---|---|---|---|
| [Zhenyu98/dsh-context-doctor](https://github.com/Zhenyu98/dsh-context-doctor) | 29 | 只读审计常驻注入物（指令链/技能 catalog/工具 schema/MCP）token 成本 + 重复/冲突检测 | **最接近的邻居**：同样是「注入面观测」，但只读、不注册、无段概念 |
| [joao-paulo-santos/dsh-granular-prompt](https://github.com/joao-paulo-santos/dsh-granular-prompt) | 0 | 运行时普查**全部** system-prompt section，逐条 suppress/replace/revert | 我们**最缺的那一半**：全量普查（我们只看见主动上报的段） |
| [Moeblack/dsh-prompt-studio](https://github.com/Moeblack/dsh-prompt-studio) | 3 | system prompt 分节编辑器 + 原生覆盖 + 完整请求预览 | order **分带约定**的权威出处（-100/0/100–199） |
| [lovstudio/dsh-inject-system-prompt](https://github.com/lovstudio/dsh-inject-system-prompt) | 0 | 注册单个 system-prompt section（name/order/complete 可配） | 最简注入方：段注册的最小 API 形态 |
| [988hj7tczd-oss/harness-desktop#plugins/harness-memory](https://github.com/988hj7tczd-oss/harness-desktop/tree/main/plugins/harness-memory) | 5 | 注册 `memory:recall` section（`sectionOrder: 150`）注入跨会话记忆 | 真实注入方样本：order 取值与分带不一致的实例 |
| [rj-jiangyichen/dsh-rules](https://github.com/rj-jiangyichen/dsh-rules) | 2 | glob 激活规则，**渲染侧字节预算**（32KB，低优先级先丢）+ (rank,name) 确定性排序 | 预算强制与优先级裁决的直接参照 |
| [PerryLink/dsh-memento](https://github.com/PerryLink/dsh-memento) | 105 | 分层记忆 + 审批门 + **硬字符预算**（满仓结构化拒绝） | 预算语义的另一种立场；其 `snapshotOrder -50` 是 order 实践 |
| [vibeinging/dsh-agent-budget](https://github.com/vibeinging/dsh-agent-budget) | 2 | **预占-结算**式 token 准入 + `accuracy: reported\|estimated\|uncertain` + storageDomain 单记录 `update()` 并发安全 | 记账口径与并发安全的最强参照 |
| [PerryLink/dsh-budget](https://github.com/PerryLink/dsh-budget) | 6 | `llm/stream` 上按插件粒度的用量/费用预算（session/daily/monthly + warn/block/degrade） | 预算分层与策略分级的生态共识；货币是美元 |
| [173787247/dsh-tool-budget](https://github.com/173787247/dsh-tool-budget) | 1 | 会话级工具调用次数硬上限（默认 80 次） | 计数型预算的最简形态 |
| [omdsh-dev/dsh-cron](https://github.com/omdsh-dev/dsh-cron) | 4 | 持久化日历触发器：occurrenceId/idempotencyKey + 跨进程锁 + 追赶策略 | 调度器的**持久化与幂等**范式 |
| [GooDAnDreaDY/dsh-context-lens](https://github.com/GooDAnDreaDY/dsh-context-lens) | 0 | AST 骨架 + 日志冷凝 + 焦点路径 + **预算追踪与面板** | 预算可视化的消费端形态 |
| [zhukunpenglinyutong/desktop-cc-gui](https://github.com/zhukunpenglinyutong/desktop-cc-gui) | 4184 | 多引擎桌面客户端；Context Ledger = token/字符估算 + **新鲜度** + **归因置信度** | 记账字段设计的外部对标 |

## 3. 可吸纳的方法（核心）

### 🔴 P0-1：全量普查对账——让「不接入的注入方」可见

- **出处**：[joao-paulo-santos/dsh-granular-prompt README「Mechanisms」](https://github.com/joao-paulo-santos/dsh-granular-prompt/blob/main/README.md)。
- **它怎么做**：用 `systemPrompt.assemble` 加一个**自己的 waterfall 旁路 marker** 跑一次组装，
  拿到**未经过滤**的全量 section 表（"the control surface always sees the UNFILTERED table"），
  并通过 `GET /granular-prompt/census` 暴露；原生目录在运行时动态发现，不依赖静态清单。
- **我们现状**：`src/service.mjs:55-80` 的 `registerSection` 只登记**主动上报**的段
  （方案 A，`docs/PROJECT-SUMMARY.md` 契约 1）；一个不调用 `ctx.get('injectScheduler')`
  的插件对调度器**完全隐形**。这正是 `README.md` 开篇描述的「注入面碎片化」在
  我们自己的记账面上的残留：`M5-ASSEMBLY.md` 实测 sections 只有 2 行
  （acp.composer / wc.work_state），而实际注入方不止两个。
- **建议**：加一条**只读** census 路径（经 `systemPrompt.assemble` 旁路或 pre-step 观察），
  与注册表做差集，输出「已注册 vs 实际注入」差异报告到 `getSessionReport`。
  零侵入、不改任何注入方。

### 🔴 P0-2：order 分带 + 优先级裁决，把「约定」升级为「契约」

- **出处**：[Moeblack/dsh-prompt-studio README「组件模型」](https://github.com/Moeblack/dsh-prompt-studio/blob/main/README.md)
  与 [lovstudio/dsh-inject-system-prompt README「Config」](https://github.com/lovstudio/dsh-inject-system-prompt/blob/main/README.md)。
- **它怎么做**：prompt-studio 明确约定 `-100` 身份区、`0` persona、`100–199` 工具区，
  system 组件与原生 section **按 order 全局混排**；inject-system-prompt 采用同一分带。
  [dsh-rules](https://github.com/rj-jiangyichen/dsh-rules) 进一步用
  `(rank, name)` 排序保证**跨 step 确定性**（project 100 > user 200 > `# Path:` 300，
  同名取最高优先级）。
- **我们现状**：`service.mjs:59-73` 的冲突检测是「同 order 且不同 key」二元判定，
  `conflictPolicy` 只有 `warn`/`reject`；**没有分带语义，也没有 rank**。
  当前 ACP=10 / WC=20 是**巧合而非契约**——`docs/B10-CONTRACT.md` 只规定「order 升序」，
  没有规定哪些区间属于哪类段。同 key 重注册是幂等覆盖（`service.mjs:59` 注释），
  这一点与 dsh-rules 的 same-name dedup 同向，但没有 rank 可比。
- **建议**：sections 表加 `rank`；`listSections`/`getSessionReport` 输出 `band`
  （由 order 推导）；把分带写进 `B10-CONTRACT.md`，让「谁该排前面」有据可依。

### 🟠 P1-1：归因置信度字段——自报值必须自带可信度标注

- **出处**：[zhukunpenglinyutong/desktop-cc-gui README](https://github.com/zhukunpenglinyutong/desktop-cc-gui)
  （Context Ledger 行："token/character estimates, freshness, and attribution confidence"）与
  [vibeinging/dsh-agent-budget README「Budget semantics」](https://github.com/vibeinging/dsh-agent-budget/blob/main/README.md)
  （`accuracy: reported | estimated | uncertain`）。
- **它怎么做**：desktop-cc-gui 把「估算 + 新鲜度 + 归因置信度」三件事并列展示；
  agent-budget 干脆把三态写进 API 返回值，并规定
  "Missing usage retains the reservation as `uncertain`; it is never settled as zero"。
- **我们现状**：`docs/B10-CONTRACT.md` §4 已经诚实标注了
  「usage 恒字符 / `charPerToken 1.5` 是估算 / 非计费」，但 **usage 记录本身没有置信度字段**：
  `recordUsage({section, injectedChars})` 是注入方**自报**的，调度器无法核验，
  面板上也看不出这个数字是「量出来的」还是「估的」。
- **建议**：usage 记录加 `confidence: 'reported' | 'estimated' | 'unknown'`，
  与 agent-budget 三态对齐；自报默认 `reported`，缺失/失败记 `unknown` **而非 0**。

### 🟠 P1-2：预算从「声明」走向「可见越界」

- **出处**：[rj-jiangyichen/dsh-rules README「Features」](https://github.com/rj-jiangyichen/dsh-rules/blob/main/README.md)
  与 [PerryLink/dsh-memento README「Bounded and honest」](https://github.com/PerryLink/dsh-memento/blob/main/README.md)。
- **它怎么做**：dsh-rules 在**渲染侧强制** `maxBytes`（默认 32768 UTF-8 字节）——
  低优先级规则先丢，最后一条截断，内容做转义防越界；memento 则对每 track×layer 设**硬字符预算**，
  满仓时返回带 usage+limit 的结构化错误，**绝不截断、绝不自动压缩**。
- **我们现状**：`section.budgetChars` 目前只是**声明**（`service.mjs` 的
  `registerSection` 原样存下，0=未设上限），`getSessionReport` 只算
  `estimatedTokens`/`usageRatio`；**调度器不做任何强制，也不报告越界**。
- **建议**：不引入强制（我们是观测层），但把「声明预算 vs 实际 usage」的越界做成
  `getSessionReport` 的显式告警项（warn 级），先观测后决定是否强制。

### 🟠 P1-3：并发的创建竞态——单记录 `update()` 之外的缺口

- **出处**：[vibeinging/dsh-agent-budget README「Budget semantics」](https://github.com/vibeinging/dsh-agent-budget/blob/main/README.md)
  与 [omdsh-dev/dsh-cron README「Durable reconciliation」](https://github.com/omdsh-dev/dsh-cron/blob/main/README.md)。
- **它怎么做**：agent-budget 规定「每一次账户变更都走**单条 Storage Domain 记录的序列化
  `update()` 路径**，并发请求重读最新的 `spent + reserved`，只有能装下的才预占」；
  dsh-cron 用**稳定派生的 `occurrenceId`/`idempotencyKey`** 保证「重启后重提交同 key 得到同一 Run」，
  并用跨进程锁 + 记录级三方合并处理并发管理写。
- **我们现状**：`service.mjs:82-106` 的 `recordUsageInner` 已走 `usage.update(key, fn)`
  序列化路径，且经 `enqueue()` 在本进程内串行——**这两层是对的**。缺口在
  **创建分支**：`update()` 抛 missing-key 时改走 `usage.put(key, {...count: 1})`，
  两个进程/两个 DSH 实例同时对同一新 key 首次上报，会各自 put，**丢掉一笔累加**。
  `enqueue()` 只在本进程内有效。
- **建议**：在 `B10-CONTRACT.md` §7 已知限制里显式写出「单写者假设」，
  或改用 storageDomain 的原子创建/条件写（若官方提供）；当前**不要**声称跨进程安全。

### 🟡 P2-1：按路由维度的段适用性

- **出处**：[MoonlitDropOfBlood/dsh-model-prompt-injector README](https://github.com/MoonlitDropOfBlood/dsh-model-prompt-injector)
  （catalog 条目描述：per-model system prompt injector，`provider/model` 精确匹配 +
  `provider/*` 通配，两者**按序叠加**，对主会话/subagent/workflow 子代理同样生效）。
- **我们现状**：section 记录里**没有「适用路由」维度**——ACP/WC 的段对所有模型一视同仁。
- **建议**：P2。先记 backlog；真正需要时给 section 加可选 `route` 匹配，
  并想清楚它与记账口径的关系（同 key 不同路由的 usage 要不要分开记）。

### 🟡 P2-2：快照的「新鲜度」语义

- **出处**：desktop-cc-gui 的 Context Ledger（freshness 维度）；
  我们自己的 [B10-CONTRACT §3](https://github.com/Icstick/dsh-inject-scheduler/blob/main/docs/B10-CONTRACT.md)
  已写明「重启后事件流断开 → 新基线必须重新 exportState」。
- **我们现状**：`exportState()`（`service.mjs:168`）只带 `exportedAt`，
  消费方无法判断这份快照是否已经因事件流断开而过期。
- **建议**：快照加 `staleAfterMs` 或 `liveSince` 字段，让面板能标注「快照已过期」而非把过期数据当实时。

## 4. 印证我们判断的地方

- **granular-prompt 独立走到「运行时全量普查 system-prompt 全表」**——与我们「注入面需要
  统一视图」的立项理由（`README.md` 引 memory-plane audit A4 / B9 v0.3）是同一个判断，
  只是它选了普查+干预，我们选了注册+记账。
- **prompt-studio / inject-system-prompt 的 order 分带（-100 / 0 / 100–199）**——与我们
  ACP=10 / WC=20 的实践同向：order 需要**语义分层**，纯数字排序会在段变多后失控。
- **agent-budget 用官方 storageDomain + 单记录 `update()` 做并发安全**——印证我们 M1 的选型
  （`docs/PROJECT-SUMMARY.md`：官方 storageDomain、零自建存储）是对的方向。
- **dsh-budget 同样做 session/daily/monthly 三级 scope + warn/block/degrade 策略分级**——
  说明「预算分层 + 策略分级」是生态共识；差别在**货币**（它是美元，我们是字符），
  两套不能混。
- **context-doctor 的只读边界（只用 read/stat/list、不输出正文、单文件 >256KB 跳过）**——
  与我们「观测层不接管现有注入实现」的非侵入承诺同构，且它给了安全边界的具体数值参考。
- **dsh-rules 把「预算 + 优先级 + 确定性排序」三件事一起做**——印证我们的
  `sections`（order/budgetChars/unit）字段设计方向正确，只是还缺强制与裁决。

## 5. 我们不该学的

- **agent-budget 的硬准入（在 provider attempt 前拒绝请求）**：它是准入层，我们是观测层。
  硬拦截会与各注入方自身的 fail-open 语义打架，且 B9 v0.3 已拍板「先观测/记账」。
  要学它的**记账三态**与**单记录 update 并发路径**，不要学它的拦截。
- **dsh-budget 的美元 / 碳足迹口径**：与我们的字符记账是两套货币，引入会让
  `B10-CONTRACT` 的口径注释立刻失效。
- **granular-prompt 的 suppress/replace（接管渲染）**：它做的是**干预**，我们承诺的是
  **不接管**。吸收它的 census（只读），不吸收它的 replace。
- **dsh-rules 的「把规则注入为 superseding user message」**：它走的是对话消息序列，
  我们记的是 system 面的段；两种注入面混记会让 usage 口径分裂。
- **context-lens 的「up to 85%」压缩率口径**：不可验证的营销数字，不适合进入我们的文档。
- **dsh-cron 的完整调度语义（cron 表达式 / 时区 / 追赶策略）**：那是触发器领域，
  与本插件的段调度无关；只取它的**幂等键与跨进程锁**范式。

## 6. 落地建议（最多 3 条）

1. **census 对账（只读全量 vs 注册表）**——投入最小、直接消灭「隐形注入方」这个盲区，
   且完全不违反「不接管」的承诺。这是让 B10 面板从「只有 2 行」变成「真实注入面」的关键一步。
2. **order 分带 + rank 裁决 + 同 key 重复注册规则写进 B10-CONTRACT**——把现在的
   「ACP=10/WC=20 是巧合」变成「谁在哪个带、谁优先」的契约，成本低、收益长期。
3. **usage 记录加 `confidence` 字段 + 在 B10-CONTRACT §7 明写「单写者假设」**——
   诚实化优先于功能：自报值不能装作量测值，跨进程安全不能装作已有。

## 7. 来源清单

**原文（README / 源码 / 目录内容 API，抓取日 2026-09-09）**

| 来源 | 类型 | URL |
|---|---|---|
| dsh-context-doctor | README 原文 | https://github.com/Zhenyu98/dsh-context-doctor |
| dsh-granular-prompt | README 原文 | https://github.com/joao-paulo-santos/dsh-granular-prompt |
| dsh-prompt-studio | README 原文 | https://github.com/Moeblack/dsh-prompt-studio |
| dsh-inject-system-prompt | README 原文 | https://github.com/lovstudio/dsh-inject-system-prompt |
| harness-memory | 源码原文（`index.js` + `cordis.patch.yml`） | https://github.com/988hj7tczd-oss/harness-desktop/tree/main/plugins/harness-memory |
| dsh-rules | README 原文 | https://github.com/rj-jiangyichen/dsh-rules |
| dsh-memento | README 原文 | https://github.com/PerryLink/dsh-memento |
| dsh-agent-budget | README 原文 | https://github.com/vibeinging/dsh-agent-budget |
| dsh-budget | README 原文 | https://github.com/PerryLink/dsh-budget |
| dsh-tool-budget | README 原文 | https://github.com/173787247/dsh-tool-budget |
| dsh-cron | README 原文 | https://github.com/omdsh-dev/dsh-cron |
| dsh-context-lens | README 原文 | https://github.com/GooDAnDreaDY/dsh-context-lens |
| dsh-model-prompt-injector | catalog 条目原文 | https://github.com/MoonlitDropOfBlood/dsh-model-prompt-injector |
| desktop-cc-gui | README 原文（Context Ledger 行） | https://github.com/zhukunpenglinyutong/desktop-cc-gui |
| awesome-dsh-plugin | 目录内容 API（1000 条插件条目） | https://github.com/awesome-dsh-plugin/awesome-dsh-plugin |

**二手 / 待核验**

| 项 | 状态 |
|---|---|
| desktop-cc-gui 的 Context Ledger 实现 | 仅 README 描述层；**未取到源码**，本文件只引用其字段设计，不引用内部机制 |
| 各同行插件的行为表现 | 未安装运行，结论均来自其 README/源码自述 |
| `gh search code` 的覆盖率 | GitHub code search 只索引部分仓库，故「零命中」只作为**佐证**之一，结论主要依据 awesome-dsh-plugin 1000 条目录扫描 |
