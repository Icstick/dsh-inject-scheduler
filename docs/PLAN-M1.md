# PLAN-M1 — 骨架 + storageDomain 记账表

> dsh-inject-scheduler · M1 细化设计。上级：docs/p7-inject-scheduler-kickoff-2026-09-05.md（开工包，M1–M5 里程碑）
> 与 D:\DSH_workspace\docs\unified-memory-seam-design-2026-09-04.md（B9 v0.3 §4 P7）。日期：2026-09-05。

## 1. M1 目标（开工包原文）

> 插件 apply；声明 domain（sections: key/order/budgetChars/refresh{frozen|reload|per-turn}；usage: sessionId/date/section/injectedChars）；
> 验证 domain/changed 事件可订阅。

## 2. 侦察结论（2026-09-05 实证，勿重复调研）

| 项 | 结论 | 证据 |
|---|---|---|
| storageDomain 在 host 可用 | base bundle 已含 storage + storage-json backend + storage-domain（backend: json），正式实例 ctx.storageDomain 直接可用 | D:\deepseek-harness-alpha5\packages\bundle\base\cordis.patch.yml |
| domain 名/表名格式 | UNIT_NAME_RE = ^[a-z][a-z0-9_]*$；官方先例 session_projcache | packages/storage/storage/src/backend.ts |
| record schema | **真 zod**（import { z } from 'zod'；zod ^4.4.3）；Config 用 schemastery z（惯例分离） | session-projection-cache/src/spec.ts |
| KvTable 写语义 | put 覆盖写（无校验——zod 校验在 open 时对存量做）；update = 原子 RMW 但 missing-key 拒绝；delete 幂等；entries() 快照 | storage-domain/src/domain.ts（已读全文） |
| 写链/事件 | 写先持久化后发 domain/changed（{domain, table, key, operation, value?}）；同域事件按写链序 | events.ts + domain.ts |
| 第三方 zod 解析 | plugin 自带 dependencies zod（host 顶层无 zod；storage-domain 的 zod 私有，pnpm 严格隔离不共享） | profiles/node_modules 实测 |
| 测试基建 | 官方 memory backend helper 在 tests/ 不可 import → 移植精简版入 test/helpers/（约 200 行，只依赖 @deepseek-ai/dsh-storage 接口形状）；装配 = Context + ctx.plugin(Storage) + backend.register + ctx.plugin(storage-domain apply, {backend:'memory'}) | domain.spec.ts harness + memory-backend.ts |
| 插件形态 | mjs function plugin：name/inject/Config(schemastery z)/apply(ctx, config)；cordis.patch.yml = insert 行；profile 通过 link + bundles + 包内 dsh.bundle.patch 挂载 | ACP/maid 双先例 |

## 3. Domain 设计（inject_scheduler v1）

domain: inject_scheduler  version: 1  invalidRecords: 'backup-and-skip'
tables:
  sections  K=sectionKey(string)  V={ key, plugin, order:int, budgetChars:int>=0,
                                    refresh: 'frozen'|'reload'|'per-turn', updatedAt: epoch-ms }
    —— 注入段注册表（每插件一段或多段；M2 起由 ACP/WC 调用 registerSection 写入）
  usage     K='<sessionId|global>::<date YYYY-MM-DD>::<section>'
            V={ sessionId, date, section, injectedChars:int>=0, count:int>=0, updatedAt }
    —— 注入用量账（key 避免 append；KvTable 无 append，先 put 首笔再 update 累加）

决策：
- **不做 global 槽**：M1 无全局状态；注册表/用量都是表语义，避免空字段测试面。
- **refresh 枚举**照开工包（frozen|reload|per-turn），M1 仅存储不做语义执行（M3 排序阶段再消费）。
- **order 语义**：数字越小越靠前（与 memento/ACP 的 order -50 先例一致：早期 systemPrompt 段用负值）。
- **invalidRecords: backup-and-skip**：注册表与用量均为派生态（M2 可重报、记账丢一笔无害），坏记录绝不拦启动；
  区别于 ACP ledger（权威数据用默认拒绝语义）——记账不是权威，ACP ledger 才是。
- **usage key 分隔符 ::**：sessionId（uuid）与 date 均不含冒号；section 命名约束
  ^[a-z][a-z0-9_.-]*$（段 key 属插件命名空间，如 acp.composer）。
- **写入竞争**：域写链串行化 put/update；首笔用 put（不存在），后续 update 累加；
  update missing-key（并发首写竞态窗口）→ 捕获后重试 put 首笔，链序保证不丢计数。

## 4. 服务 API（ctx.injectScheduler，M1 面）

registerSection({ key, plugin, order, budgetChars, refresh }) -> {ok, key}   // 幂等覆盖；M2 供 ACP/WC
unregisterSection(key) -> boolean                                              // M2 卸载用
recordUsage({ sessionId, section, injectedChars, date? }) -> {ok, key, total} // 缺省记 'global'/当天
listSections() -> Section[]                                                     // 按 order 升序
getUsage({ sessionId?, section?, date? }) -> UsageRecord[]
ready: boolean                                                                  // domain open 完成

- M1 不接 pre-step 也不做排序执行——只把表与订阅链路立起来。
- API 输入先过 zod parse（表记录 zod 校验在 open 时，写侧自校验防脏数据）。

## 5. 插件装配

- name: 'inject-scheduler'；inject: ['storageDomain']；Config: { verbose: boolean(default false) }
- apply：open(domainSpec)（ctx.effect 注册 close）→ provide('injectScheduler', service)
  → ctx.on('domain/changed')：domain==='inject_scheduler' 时按 verbose 记日志（订阅通路验证 = M1 测试点）。
- 打开失败策略：inject 声明保证 storageDomain 就绪；open 抛错 fail-loud（M5 装配期即暴露配置问题）。

## 6. 测试方案（node --test，M1 用例清单）

装配 harness（test/helpers/harness.mjs）：
1. new Context() → ctx.plugin(Storage) → 注册 MemoryStorageBackend（移植 helper）→
   ctx.plugin(storage-domain apply, {backend:'memory'}) → ctx.plugin(本插件 apply)
2. 返回 { ctx, backend }；backend.pool 可跨用例重开（模拟重启后数据仍在）

用例：
1. domain open 成功：listSections()/getUsage() 空态不炸
2. registerSection 幂等覆盖 + order 排序读
3. recordUsage：首笔 put → 后续 update 累加（同 key 多笔 total 正确）；不同 session/date 隔离
4. recordUsage 缺省 sessionId → 'global' 行；缺省 date → 当天
5. domain/changed 订阅：写 sections/usage 各触发事件，断言 {domain,table,key,operation,value} 形状与写链序
6. API 防御：非法 refresh / 负 budgetChars / 负 injectedChars / 非法 section key → 拒绝且不落表
7. 重启持久性：同一 pool 重建 ctx 栈 → 数据仍在（模拟重启后记账不丢）

## 7. 验收（对照开工包 M1）

- [ ] 插件 apply 可启动（无 host 改动）
- [ ] domain 声明符合开工包字段面（sections/usage 两表 + refresh 三值）
- [ ] domain/changed 可订阅（测试断言事件形状）
- [ ] 测试全绿 + 每步提交
