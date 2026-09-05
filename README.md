# dsh-inject-scheduler · 注入调度器

> 跨插件注入段注册/排序/记账的轻量调度器。DeepSeek Harness 插件，官方 storageDomain 承载，零自建存储。
> 状态：**M1 开发中**（骨架 + storageDomain 记账表）。里程碑与决策见 docs/。

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
| M1 | 骨架 + storageDomain 记账表（domain 声明、sections/usage 表、domain/changed 订阅验证） | 🚧 进行中 |
| M2 | 段注册 API + ACP/WC 接入（registerSection + 实际注入量上报） | 待 M1 |
| M3 | 冲突检测 + 启动报告（同 order 段冲突显式化、每会话预算汇总） | 待 M2 |
| M4 | B10 数据源面（注入曲线导出、事件流落地） | 待 M3 |
| M5 | 装配与验证（web profile 挂载，重启后零冲突、usage 增长可见） | 待 M4 |

完整背景与选型：docs/PLAN-M1.md · 上级设计文档见 D:\DSH_workspace\docs\unified-memory-seam-design-2026-09-04.md（B9 v0.3 §4.1 P7）与 p7-inject-scheduler-kickoff-2026-09-05.md（开工包）。

## License

MIT © Icstick
