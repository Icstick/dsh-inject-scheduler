# PLAN-M4 — B10 数据源面（注入曲线/快照/事件流消费契约）

> dsh-inject-scheduler · M4 细化设计。上级：p7 开工包 M4 + PLAN-M3 §5 遗留。日期：2026-09-05。

## 1. M4 目标（开工包原文）

> B10 数据源面：导出每会话注入曲线（供后续面板/whale 扩展消费）；事件流落地 audit
> （scheduler 自家记账可存 domain 表，读事件进 ctx 日志）

## 2. 勘察结论（2026-09-05，勿重复调研）

| 项 | 结论 |
|---|---|
| 记账存 domain 表 | ✅ M1 已做（sections/usage 两表，域写链先持久化后发 domain/changed） |
| 事件进 ctx 日志 | ✅ M1 verbose 已做（按表分支准确字段）——M4 正式化为消费契约 |
| domain/changed 增量消费 | 事件无写序值（DomainChanged 只有 domain/table/key/operation/value；官方语义=diffing consumer 自持快照对比）→ 消费方模式 = **启动 exportState 快照 + 运行期事件增量** |
| maid 压缩事件对照 | compaction 活动是 **session 事件流**（compaction/start|summary|end，append 入会话日志，非 ctx 事件）——与 usage 表无耦合必要；B10 面板消费方从 session 事件流独立读。**M4 不做联动**，记入 B10-CONTRACT 数据源清单 |

## 3. 交付面

### 3.1 usageSeries 读 API（注入曲线明细）
usageSeries({ sessionId?, section?, dateFrom?, dateTo? }) → 行数组
[{ sessionId, date, section, injectedChars, count, updatedAt }] 按 (date, sessionId, section) 字典序（YYYY-MM-DD 字符串序=时间序）。
消费方自行聚合（按日合计/按 section 堆叠）；过滤条件全缺省 = 全量。

### 3.2 exportState 快照（启动基线/备份/调试/迁移）
exportState() → { format: 'dsh-inject-scheduler-state', version: 1, exportedAt: ISO,
  sections: SectionRecord[]（order 升序）, usage: UsageRecord[]（稳定排序） }
用途：B10 面板启动基线（与事件增量互补）；备份/对账/迁移；调试 dump。
一致性承诺：快照与同刻 listSections()/getUsage() 内容相等（测试对账）。

### 3.3 B10 消费契约文档（docs/B10-CONTRACT.md）
- 数据源清单：①sections/usage 表（storageDomain 域，权威面）②domain/changed 事件流（运行期增量）
  ③usageSeries/exportState/getSessionReport（读 API）④session 事件流 compaction/*（压缩活动，独立面）
- 消费模式：启动快照 + 增量事件 merge == 终态（测试固化）
- 口径说明：chars 记账 / unit 预算 / charPerToken 估算非计费 / date 本地日

## 4. 测试（test/m4.test.mjs）

1. usageSeries：跨 session/date/section 过滤与排序（date 升序）；空结果
2. usageSeries dateFrom/dateTo 窗口（字符串比较）
3. exportState：形状 + sections（order 升序含 unit/budget）+ usage 排序稳定；与 listSections/getUsage 对账
4. **快照+增量重建**：h1 写 → exportState → 重启（同 pool）→ h2 运行期收集 domain/changed →
   快照 merge 增量 == h2 终态 getUsage（B10 消费模式验证）
5. exportState 在空域上不炸（空数组）

## 5. 验收（对照开工包 M4）
- [x] 每会话注入曲线可查（usageSeries：过滤/日期窗口/稳定排序）
- [x] 快照导出可用且与读面一致（exportState 对账测试）
- [x] 事件流消费模式测试固化（快照+增量重建 == 终态）
- [x] B10-CONTRACT.md 落地（数据源清单/消费模式/口径/已知限制）
- [x] 全量回归 27/27 + 每步提交


## 6. M4 完成记录（2026-09-05）

- 状态：**完成**（feat/m4-b10-surface 分支）。
- 交付：usageSeries / exportState / B10-CONTRACT.md（数据源清单含 compaction session 事件流勘察结论）。
- 关键验证：快照+事件增量重建 == 终态（domain/changed 可作完整数据源，B10 面板启动基线+实时增量模式固化）。
- 遗留：usage 容量治理（远期，与 ACP P6 联动）；面板/whale 消费实现本体在 B10 立项时做（本里程碑只交付数据面）。
