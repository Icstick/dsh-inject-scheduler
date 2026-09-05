# B10-CONTRACT — 注入面数据源消费契约

> dsh-inject-scheduler · B10 面板/whale 扩展的正式数据契约。定稿：2026-09-05（M4）。
> 背景：B9 v0.3 S4 "B10 面板对接（P7 记账可视化）"——每会话注入预算可见。

## 1. 数据源清单

| # | 数据源 | 位置 | 用途 | 时效 |
|---|---|---|---|---|
| 1 | sections/usage 表（权威面） | storageDomain 域 `inject_scheduler`（json backend，host 侧） | 全量查询/快照/对账 | 持久 |
| 2 | domain/changed 事件流 | ctx.on('domain/changed')（domain=inject_scheduler） | 运行期增量（每次记账/注册一笔一事件） | 仅运行期 |
| 3 | 读 API（ctx.injectScheduler） | usageSeries / exportState / getSessionReport / getUsage / listSections | 消费方主入口 | 同步读 |
| 4 | session 事件流 compaction/* | agent 会话日志（compaction/start|summary|end） | 压缩活动对照（独立面，与 usage 无耦合） | 持久 |

## 2. 记录形状

- **sections**：{ key, plugin, order, budgetChars（0=未设上限）, unit('chars'|'tokens'), refresh('frozen'|'reload'|'per-turn'), updatedAt }
- **usage**：{ sessionId（'global' = 无会话维度）, date（YYYY-MM-DD 本地日）, section,
  injectedChars（恒字符数）, count（累加笔数）, updatedAt }
  usage key = `<sessionId>::<date>::<section>`——同 key 多次上报 = update 累加（无 append）。

## 3. 消费模式（测试固化：test/m4.test.mjs "快照+增量重建"）

```
启动：baseline = injectScheduler.exportState()          // 全量基线
运行：ctx.on('domain/changed', c => { if (c.domain==='inject_scheduler' && c.table==='usage' && c.operation==='put')
                                        increments.set(c.key, c.value) })   // put 事件带完整新记录
重建：merged = baseline.usage ∪ increments              // 同 key 以事件为准
```

- domain/changed 事件**无写序值**（官方语义：diffing consumer 自持快照对比）——put 事件 value
  即完整新记录（含累加后快照），直接覆盖同 key 即得终态；重启后事件流断开 → 新基线必须重新 exportState。
- 事件按域写链序到达（同域不重排）——逐 key 覆盖天然收敛，无需乱序处理。
- 只关心运行期面板时也可全程增量（不取基线，面板自上次快照起 merge）。

## 4. 口径（诚实标注，勿误用）

- **chars vs tokens**：usage 记账恒为字符数；section.budget 按其 unit 计值（ACP=tokens/WC=chars）。
- **charPerToken（默认 1.5）**：unit=tokens 段的预算对照**估算系数**（getSessionReport 的
  estimatedTokens/usageRatio 基于它）——非计费精度，面板标注"估算"；预算语义是数量级可见。
- **date 为本地日**（宿主时区）；跨时区展示由消费方自行换算。
- **'global' 会话槽**：无 session 上下文的注入（如 headless/无 agent session）记入此行。
- **count 是上报笔数**，不是注入消息条数的语义保证（一轮一次上报=笔+1）。

## 5. 曲线与预算对照（消费方示例）

```js
// 每日注入总量曲线（per session）
const series = scheduler.usageSeries({ sessionId })
const daily = Map.groupBy?.(series, r => r.date)   // 或手聚合 → [{date, chars, count}]
// 预算对照（M3 报告）
const report = scheduler.getSessionReport({ sessionId })  // 每段 injectedChars/estimatedTokens/usageRatio
// 面板初始 + 实时
const baseline = scheduler.exportState(); ctx.on('domain/changed', ...) // §3
```

## 6. 快照格式（exportState）

```jsonc
{ "format": "dsh-inject-scheduler-state", "version": 1, "exportedAt": "<ISO>",
  "sections": [/* order 升序 */], "usage": [/* sessionId/date/section 稳定排序 */] }
```

version 语义：domain/快照结构破坏性变更时递增；消费方按 format+version 拒绝未知版本。

## 7. 已知限制（诚实面）

- usage 无归档策略（append-only）：每会话每日每段一条，长期增长可控但无上限治理——
  容量治理（归档/折叠）在远期（与 ACP P6 联动），届时快照 version 或新增归档段。
- domain 是"派生态"（invalidRecords=backup-and-skip）：坏记录被移走视同缺失，
  B10 面板若需要权威审计请以 ACP ledger 为准——usage 是观测账不是事实账。
