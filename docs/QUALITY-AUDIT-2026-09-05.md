# QUALITY-AUDIT-2026-09-05 — 代码卫生 / 耦合度 / 健壮性 三轴审计

> dsh-inject-scheduler · M1–M3 代码（src 3 文件 + test 4 文件 + helpers 2 文件）。
> 触发：用户问"代码卫生、耦合度、健壮性有确认过吗"——此前重构是问题驱动自查，本文件为系统性审计。

## 0. 方法

1. **工具面**：node --check 全部 mjs（语法）；oxlint 87 rules（0 告警）；types.d.ts ↔ 实际 API 手工比对
2. **静态推演**：三模块逐行 + 调用链 + 并发窗口 + 关闭/卸载路径
3. **测试补强**：新增 test/robustness.test.mjs（5 用例：并发首写/并发注册/类型卫生/失败路径/混合并发）

## 1. 代码卫生

| # | 检查 | 结论 | 处理 |
|---|---|---|---|
| H1 | 语法（node --check 全量） | ✅ 全过 | — |
| H2 | lint（oxlint 87 rules） | ✅ 0 warnings 0 errors（9 文件） | — |
| H3 | types.d.ts 与实际 API 漂移 | ❌ **2 处漂移**：SectionRecord 缺 unit（M2 引入 schema 时漏改）；registerSection 错误面缺 conflictWith/message（M3 reject 面） | ✅ 已修（mjs 无编译期强制——d.ts 手工维护是唯一校验点，已纳入提交检查习惯） |
| H4 | 注释与实现同步 | ✅ M3 后头注释/字段注释已复核 | — |
| H5 | 死代码/未用导出 | ✅ oxlint + 目检无 | — |
| H6 | 临时产物进库 | ❌ m3out.txt 误提交一次 | ✅ 已清（chore commit） |

## 2. 耦合度

| # | 检查 | 结论 | 说明 |
|---|---|---|---|
| C1 | 模块依赖方向 | ✅ domain（zod+storage-domain）← service ← index；无反向、无环 | — |
| C2 | domain 句柄泄漏 | ✅ 服务只暴露方法 + domainName；table 句柄不外传 | — |
| C3 | service 对 cordis 耦合面 | ⚠️ 构造传 ctx 仅作 logger 载体 | 薄耦合可接受；options 显式化已做（conflictPolicy/charPerToken） |
| C4 | 默认值双份（Config vs service options） | ⚠️ warn/1.5 两处 | 已注释互指；改默认需同步（未来可收口 Config 单一来源） |
| C5 | 跨仓库（scheduler ↔ ACP/WC） | ✅ scheduler 对消费方零引用；消费方经 ctx.get 服务契约 + zod 服务端校验 + 契约测试固化 | 消费方接线 ~45 行/仓重复不抽共享（插件自包含惯例，第三家接入再议） |
| C6 | 配置链 | ✅ index Config → service options 显式透传（无魔法全局） | — |
| C7 | 测试装配与生产同构 | ✅ 真栈（cordis + storage hub + backend 插件 + storage-domain）非 mock 上层 | — |

## 3. 健壮性

| # | 边界 | 结论 | 处理 |
|---|---|---|---|
| R1 | **并发首写竞态**：recordUsage update missing→put 回退跨两个域写链作业，并发首写后到者覆盖先到者 | ❌ 真实窗口（审计推演确认） | ✅ service 微队列把 registerSection/recordUsage 整体串成宏作业；12 并发零丢失测试 |
| R2 | 并发注册同 order（reject 策略）检测读-写窗口 | ⚠️ 注册期串行无实际风险，但窗口存在 | ✅ 同一队列消除；并发测试断言"恰好一个成功" |
| R3 | unregisterSection 非 string key | ⚠️ delete no-op 无害但语义脏 | ✅ typeof 校验返回 false |
| R4 | domain close 后调用（卸载窗口） | ✅ storage-domain 抛 closed；消费方（ACP/WC）全程 .catch fail-open | 文档记录 |
| R5 | 非法输入面 | ✅ zod 写侧自校验全 API（负数/枚举/key 格式/分隔符注入） | 失败路径测试护栏 |
| R6 | usage 表无限增长 | ⚠️ 无归档（append-only 语义）；现实量级每会话每段每日一条 | 记 M4/远期输入（容量治理与 ACP P6 联动） |
| R7 | date 格式宽松（regex 允许 99 月） | ⚠️ key 语义无害 | 记录，不收紧（key 非日历校验点） |
| R8 | charPerToken 估算精度 | ⚠️ 经验系数非计费 | 文档明示估算口径；M4 面板标注 |
| R9 | 日志敏感内容 | ✅ 只打 key/计数/段值，不打注入文本 | — |
| R10 | dispose 顺序 | ✅ fibers 反向：injectScheduler → storage-domain（closeAll）→ backend → hub | — |

## 4. 修复清单（本审计产出）

1. types.d.ts：SectionRecord.unit + ServiceError 面（conflictWith/message）——H3
2. service.mjs：enqueue 宏作业队列 + registerSection/recordUsage 重排——R1/R2
3. service.mjs：unregisterSection typeof 卫生——R3
4. test/robustness.test.mjs：5 用例——R1/R2/R3/R5 回归护栏
5. docs：本文件

全量回归：M1 8 + M2 3 + M3 6 + robustness 5 = **22/22**。

## 5. 结论

- 卫生：工具面干净，历史漂移仅 d.ts 两处（已修）——**mjs+d.ts 模式必须把 d.ts 比对纳入习惯**。
- 耦合：方向干净、无泄漏；剩余 ⚠️（默认值双份/logger 载体）均薄且有记录。
- 健壮性：一处真实并发竞态（审计价值所在）已修 + 专项测试；其余边界推演有结论或明确遗留。
