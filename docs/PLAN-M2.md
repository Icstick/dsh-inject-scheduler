# PLAN-M2 — 段注册 API + ACP/WC 接入（方案 A：注入方主动上报）

> dsh-inject-scheduler · M2 细化设计。上级：p7 开工包 M2 + 2026-09-05 用户拍板**方案 A**（主动上报，拒绝长度差估算的脏账）。
> 状态：规划定稿 → 实施中。三仓库协作：本 repo（契约面）+ dsh-adaptive-context + dsh-work-continuity。

## 1. M2 目标（开工包原文 + 拍板）

> 段注册 API + ACP/WC 接入：scheduler 提供 registerSection()（M1 已就位）；ACP composer 注入后上报实际注入量；WC 同。

- 注入量上报 = **方案 A**：注入方（文本生产者）在生成后调 recordUsage，字符级精确。
- 接入段：acp.composer（ACP Context Composer 整段）+ wc.work_state（WC WorkState 摘要）。
  maid 不注入不接；memento/shared-memory 退役路线（v0.3 D2）不接。
- 单位口径（2026-09-05 定）：usage.injectedChars 记**字符数**（字段名即语义）；
  sections 增 unit 字段（'chars'|'tokens'，default 'chars'）如实登记段预算单位——
  ACP 配额是 token（hotTokens/sectionQuota），WC 截断全是字符。M3 预算对照按 unit 换算，不在 M2 解决。

## 2. 三仓库改动点（2026-09-05 源码实证）

### dsh-inject-scheduler（本 repo，M2 契约面）
1. domain.mjs：sectionRecordSchema 加 unit（z.enum(['chars','tokens']).default('chars')）；
   文档化 budgetChars=0 语义 = 未设上限（WC 用）。version 仍 1（正式环境从未写入，无存量兼容负担）。
2. 契约固化测试（test/m2.test.mjs）：fake injector **插件**（module shape）经 ctx.get('injectScheduler')
   调 registerSection/recordUsage——固下消费方访问路径（ACP/WC 将照此写；验证 ctx.get 非 inject 声明可用）。
3. service/types 无接口变化（registerSection 透传 unit）。

### dsh-adaptive-context（feat/memory-seam-s1 分支）
- apply：withService(ctx, 'injectScheduler', sched => sched.registerSection({...}))——段注册等 scheduler 就绪
  （抄 WC 已实证的 internal/service 模式；ACP 现无 withService，新增同款小工具）。
  段值：key 'acp.composer'，plugin 'dsh-adaptive-context'，order 10，budgetChars = config.hotTokens ?? 900，
  unit 'tokens'，refresh 'per-turn'。
- pre-step 注入点（src/index.mjs ~500 行）：body = renderSourceLabelled(...) 生成后、createUserMessage 前，
  recordUsage({ sessionId: sessionId || undefined, section: 'acp.composer', injectedChars: body.length })
  —— sessionId 空串时不传（落 global 槽）。fail-open：scheduler 缺失/异常只降级不阻断（try/catch + .catch）。
- 测试：mock ctx 加 injectScheduler stub；断言 ①注册调用参数 ②recordUsage 收到注入后 body 长度。

### dsh-work-continuity（新 feature 分支 feat/scheduler-metering）
- 已有 withService 工具函数 → apply/注入注册处 withService('injectScheduler') 注册段：
  key 'wc.work_state'，order 20，budgetChars 0（未设上限），unit 'chars'，refresh 'per-turn'。
- pre-step 注入点（registerWorkStateInjection）：body = renderWorkStateBrief(state) 非空才注入——
  body 生成后 recordUsage({ sessionId?, section: 'wc.work_state', injectedChars: body.length })。
- 测试：work.test.mjs 同款 mock（ctx.get 分支加 'injectScheduler'）。

## 3. 设计决策记录

| # | 决策 | 理由 |
|---|---|---|
| D1 | 方案 A 主动上报 | 用户拍板；字符级精确、天然分段、无注册时序依赖（对比见会话解释） |
| D2 | sections 增 unit 字段 | ACP 预算是 token 口径；不丢信息，M3 换算有据 |
| D3 | budgetChars=0 语义 = 未设上限 | WC 无预算概念；避免 0 歧义 |
| D4 | order：acp.composer=10 / wc.work_state=20 | 意图序（ACP 画像先行）；M3 排序/冲突检测的输入面 |
| D5 | 段注册 = withService 惰性就绪 | bundle 加载顺序不定；internal/service 事件模式已被 WC 实证（cordis 4 保留） |
| D6 | 上报 sessionId 空串 → 不传（global 槽） | schema 拒绝空串（M1）；global 槽语义=无会话维度 |
| D7 | 消费方访问 = ctx.get('injectScheduler')（非 inject 声明） | 调度器是可选项——硬 inject 会把 ACP/WC 变成依赖 scheduler 才能装载 |
| D8 | 测试分级 | ①本 repo 契约 e2e（fake injector 真插件）②ACP/WC 各自 stub 测试 ③M5 真实装配交叉验证（usage 增长可见）——不建跨仓真栈（装配成本高、收益与 ③ 重叠） |

## 4. M2 验收（对照开工包 M2）

- [x] sections.unit 字段 + budgetChars=0 语义落地，测试补全
- [x] 消费方契约测试：fake injector 插件经 ctx.get 注册+上报，domain 数据正确
- [x] ACP：apply 注册 acp.composer（unit tokens/hotTokens）；注入后上报 body.length；fail-open；9 新用例绿，关键回归绿
- [x] WC：注册 wc.work_state（unit chars/0）；注入后上报；fail-open；6 新用例绿，work 18/config 2 回归绿
- [x] 每仓库独立 feature 分支 + 每步提交

## 5. 遗留（M3 输入，不在 M2 解决）
- 预算对照换算：usage chars ↔ sections budgetTokens（按 unit）；M3 冲突检测/每会话预算汇总时定系数；
- order 冲突语义（pre-step 面段间）；systemPrompt 面段（memento 类 frozen）未来扩展的注册面说明。


## 6. M2 完成记录（2026-09-05）

- 状态：**完成**（三仓库代码 + 测试全绿；正式实例装配属 M5，需重启后验证）。
- 提交：
  - dsh-inject-scheduler：c06ec8a（PLAN-M2 定稿）+ c6c5150（unit 字段 + 契约测试，分支 feat/m2-consumer-contract 未合 main）
  - dsh-adaptive-context：49520c2（feat/memory-seam-s1 分支）
  - dsh-work-continuity：a2aa5ef 前身 a2aa5ae（feat/scheduler-metering 分支）
- 测试数：scheduler 11（M1 8 + M2 3）/ ACP +9（模块级）/ WC +6（模块级）。
- 关键契约点（三仓库一致）：调度器**可选项**（ctx.get + withService 就绪订阅 + 全程 fail-open）；
  段值 acp.composer(order 10, unit tokens, budget=hotTokens) / wc.work_state(order 20, unit chars, 0=未设上限)；
  上报 = 实际注入文本字符数；sessionId 空串不传（落 global 槽）。
- 遗留：ACP/WC 注入处是"生成后上报"——未做 messages 级交叉校验（方案 B 被否的观测点）；
  M3 冲突检测/预算汇总/换算系数；M5 装配（web profile 挂 scheduler + 重启验证 usage 增长）。
