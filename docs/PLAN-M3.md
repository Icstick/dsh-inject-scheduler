# PLAN-M3 — 冲突检测 + 启动报告 + 每会话预算汇总

> dsh-inject-scheduler · M3 细化设计。上级：p7 开工包 M3 + PLAN-M2 §5 遗留输入。日期：2026-09-05。

## 1. M3 目标（开工包原文）

> 冲突检测 + 启动报告：同 order 段冲突 → 启动日志明确 + 配置否决可配；每会话注入预算汇总（对照 ACP hotTokens 900/1600 与 maid 压缩事件）

范围收敛（2026-09-05 定）：
- maid 压缩事件对照**不纳入 M3**：compaction 事件在 host 层（另有压缩契约研究），记账对照属 B10 面板/未来
  compaction 联动——记为 M4 输入。M3 聚焦注入面自身：冲突 + 预算汇总。
- "启动报告"实现为**注册期增量报告**：段注册发生在各插件 apply（withService 到达），scheduler 没有
  "全部装载完成"的可靠事件——每次 registerSection 后立即做冲突检测 + 打注册汇总 info，注册都在启动期
  完成，等效启动报告且无需猜装载时序。

## 2. 设计

### 2.1 冲突检测（registerSection 内增量）
- 冲突定义：sections 表中存在**同 order 且不同 key** 的段（同 key 重注册 = 幂等覆盖，不算冲突）。
- Config 增 conflictPolicy: 'warn' | 'reject'（default 'warn'）：
  - warn：logger.warn 明确消息（列出冲突双方 key/order/plugin），仍注册（记账面不缺段）；
  - reject：返回 {ok:false, error:'order-conflict', conflictWith:[key,...]} 且不写表（段不注册，注入不受影响——注册只是声明面）。
- service 需要 logger：createInjectSchedulerService(domain, ctx)——ctx 可选（缺省无日志，
  仅 reject 行为仍生效）。index.apply 传 ctx。既有单参调用兼容（测试 harness 传真 ctx）。

### 2.2 注册汇总报告（启动期日志）
- 每次 registerSection 成功后打 info（logger）：当前注册表快照一行——
  'section registered key=<k> plugin=<p> order=<o> budget=<b><unit> refresh=<r> total=<n>'。
- 冲突 warn 场景同时打 warn 行。启动期全部注册完成后最后一条 info 的 total 即最终段数（等效启动报告）。

### 2.3 每会话预算汇总读（getSessionReport）
- 新增 API：getSessionReport({ sessionId?, date? }) →
  { date, sessionId, charPerToken, sections: [{
      section, plugin, order, unit, budgetChars,
      injectedChars, count,             // usage 侧（恒 chars）
      estimatedTokens, usageRatio       // 对照行：estimatedTokens = chars × charPerToken（仅 unit=tokens 段）
                                       // usageRatio = estimatedTokens / budgetChars（>1 = 超预算；0 budget 段 null）
  }], totals: { injectedChars, estimatedTokens, sections }
  }
- 换算：Config 增 charPerToken: number default 1.5（1 token ≈ 1.5 字符，**可配经验值**——
  中文场景常用近似；文档明示仅估算，M4 面板标注估算口径；精度留给未来 tokenizer/真实 meter）。
  unit='chars' 段不做 token 换算（budget 与 usage 同口径直接 usageRatio = injectedChars/budgetChars）。
- 无换算精度承诺——对照预算的语义是"数量级可见"，不是计费。

### 2.4 Config 最终面（M3 后）
{ verbose: false, conflictPolicy: 'warn', charPerToken: 1.5 }

## 3. 测试（test/m3.test.mjs，行为保持 11 个既有用例不动）

1. 冲突 warn：同 order 不同 key 两段 → 都注册成功 + logger.warn 被调（消息含双方 key）
2. 冲突 reject：policy=reject → 第二段 {ok:false, error 含 order-conflict + conflictWith}，listSections 只有首段
3. 幂等覆盖不报冲突：同 key 重注册（改 order）→ 无 warn、注册成功
4. 注册汇总 info：logger.info 收到 'section registered' 含段值
5. getSessionReport：构造 acp(unit tokens, budget 1600) + wc(chars, 0) 两段 usage 后——
   estimatedTokens/usageRatio 数字断言（charPerToken 1.5）；wc 段 unit=chars 走直接口径
6. getSessionReport 换算系数可配（charPerToken 覆盖）
7. 缺省 config 面：conflictPolicy 默认 'warn'；charPerToken 默认 1.5

## 4. 验收（对照开工包 M3）
- [x] 同 order 冲突启动日志明确（warn）且配置可改为否决（reject 返回 ok:false + conflictWith）
- [x] 每会话注入预算汇总可查（getSessionReport：unit=tokens 段经 charPerToken 估算，chars 段同口径直比）
- [x] 既有 11 测试全绿 + 新 6 用例绿（17/17）；每步提交 41e5b4e/8347821
- [x] 遗留记录：maid 压缩事件对照 → M4 输入（已写入 §1 范围收敛）


## 5. M3 完成记录（2026-09-05）

- 状态：**完成**（feat/m3-conflict-budget 分支，2 commits；未合 main 等 M5 前统一验收）。
- 行为保持重构（同批 main 53ee395）：删 ready/name 恒真冗余、verbose 日志按表分支、
  schema 字段规则消重、parseOr 统一 ok 面——11/11 回归护航。
- 踩坑：schemastery z 无 .enum（zod API）→ Config 枚举用 z.union + z.const（ACP 惯例）。
- 范围收敛记录：maid 压缩事件对照 → M4（compaction 事件属 host 层，记账联动另需契约研究）。
