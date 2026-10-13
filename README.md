# dsh-inject-scheduler · 注入调度器

> 跨插件注入段注册/排序/记账的轻量调度器。DeepSeek Harness 插件，官方 storageDomain 承载，零自建存储。
> 状态：**M1–M5 完成并验证**（2026-09-05：30 测试全绿、oxlint 0 告警、web profile 装配后 sections/usage 实测增长）。
> **2026-09-09 同行调研改善**：order 分带 + rank 裁决（排序键 `(order, rank, key)`）、usage 置信度三态（`reported/estimated/unknown`，累加取最弱）、**census 对账**（实际注入面 vs 注册表差集，让不接入的注入方可见）。35 测试全绿。
> **2026-10-02 census 观察面形状归一**：message.source 的权威形状是 `{ kind: 'plugin', plugin: '<name>' }`
> （上游 cookbook / agent README），本机四家注入方（ACP / KR / WC / maid）实际发的是 `{ kind: 'plugin:<name>' }`。
> 观察面现在两种都认（plugin 字段优先，否则取 `plugin:` 后缀；其余 kind 一律不算）——
> 此前只认前者，四家永远进不了 observed、差集空转。四家仓库不改（只报告）。

## 这是什么，解决什么问题

想象一下这个场景：妹妹的对话里同时挂着四个"记忆插件"，每个都觉得自己该说两句。

早上第一轮对话还没开始，ACP 的画像段、工作连续性的 WorkState、memento 的冻结快照、
shared-memory 的整文件……四条注入各自为政地挤进 system prompt。
没有统一排序（两个段都抢 order -50）、没有去重、没有记账——每轮固定烧掉上千 token，
却没人说得清哪段花了多少、有没有冲突、谁该排前面。

这正是 memory-plane audit（A4）与统一记忆 Seam 设计（B9 v0.3）里记下的现状：
**注入面碎片化 + token 无全局视图**。B9 拍板：不做第四个"注入实现"，做一个**观测/调度层**——
先让各注入方（ACP composer / WC / maid / 未来者）声明自己的段（key/order/预算/刷新语义），
调度器统一排序、记账、冲突检测，并把每会话注入曲线作为 B10 面板的现成数据源。

## 工作原理（一图流）

```
各注入方插件                     dsh-inject-scheduler（本插件）
ACP composer ──registerSection──►  ┌────────────────────────────┐
WC work_state ──registerSection──►  │ ctx.injectScheduler        │
maid / 未来段 ──registerSection──►  │  · 段注册表（sections 表）  │
                                   │  · 用量账（usage 表）        │
注入后 ──recordUsage(实际字符)──►  │  · domain/changed 事件流     │
                                   └──────────────┬─────────────┘
                                                  │ = B10 面板数据源（订阅 domain/changed 即得）
                                                  ▼
                              官方 storageDomain（json backend，写链先持久化）
```

调度器**不接管**现有注入实现：ACP/WC 继续走自己的 pre-step，调度器先做
观测/记账/冲突检测/报告（非侵入），后续里程碑再演进接管排序。

## 快速开始（开发）

```bash
pnpm install
pnpm test        # node --test 全绿
```

## 里程碑

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 | 骨架 + storageDomain 记账表（domain 声明、sections/usage 表、domain/changed 订阅验证） | ✅ 完成 |
| M2 | 段注册 API + ACP/WC 接入（方案 A：注入方主动上报，registerSection + recordUsage 端到端） | ✅ 完成（三仓库接线） |
| M3 | 冲突检测 + 启动报告（conflictPolicy warn/reject、注册汇总日志）+ getSessionReport 每会话预算汇总 | ✅ 完成 |
| M4 | B10 数据源面（usageSeries 曲线 + exportState 快照 + B10-CONTRACT 消费契约） | ✅ 完成 |
| M5 | 装配与验证（web profile 挂载，重启后零冲突、usage 增长可见） | ✅ 完成（2026-09-05 两轮重启验证通过） |

完整背景与选型：docs/PLAN-M1.md（B9 v0.3 统一记忆 Seam §4.1 P7 交付）· 装配与验证记录：docs/M5-ASSEMBLY.md。

## 安装（dsh）

```sh
# 一键（GitHub 源，bundle patch 自动挂载 inject-scheduler 条目，无配置项）
dsh plugin --profile <name> add github:Icstick/dsh-inject-scheduler
```

要求宿主提供官方 `@deepseek-ai/dsh-storage-domain`（≥0.1.2-rc.1，dsh 官方内置）——
数据落官方 storageDomain（域 `inject_scheduler`），**零自建存储**。

接入方（ACP composer / WC work_state / 未来注入段）经 `ctx.get('injectScheduler')` 可选接入：
registerSection 声明段（key/order/budget/unit），注入后 recordUsage 上报——全程 fail-open，
调度器缺失不影响宿主与各注入方。消费契约见 docs/B10-CONTRACT.md。

## License

MIT © Icstick
