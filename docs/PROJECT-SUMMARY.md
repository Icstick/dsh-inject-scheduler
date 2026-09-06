# PROJECT-SUMMARY — dsh-inject-scheduler（P7 注入调度器）

> 状态：**M1–M5 全部完成并验证**（2026-09-05）。B9 v0.3 统一记忆 Seam 的 P7 交付。

## 是什么

跨插件注入段的**观测/调度层**（不做第四个注入实现）：各注入方（ACP composer / WC / 未来）
经 ctx.get 可选接入——registerSection 声明段（key/order/budget/unit/refresh），注入后
recordUsage 上报实际字符；调度器统一记账/冲突检测/预算汇总，并作为 B10 面板数据源。

- 存储：官方 storageDomain（域 inject_scheduler，json backend，**非自建库**——M1 选型拍板）
- 权威分层：usage/sections 是**派生态**（invalidRecords=backup-and-skip），权威事实在 ACP ledger
- 设计文档：docs/PLAN-M1..M4.md（逐里程碑 + 踩坑）+ docs/B10-CONTRACT.md（消费契约）
  + docs/QUALITY-AUDIT-2026-09-05.md（三轴审计）+ docs/M5-ASSEMBLY.md（装配/验证/回滚）

## 代码形态

- mjs 零构建 function plugin（name/inject/Config(schemastery)/apply）；src 三文件 88/177/44 行
- 测试：node --test 真栈 harness（cordis + 内存 backend 插件 + 官方 storage-domain），30 用例
  （m1 8 / m2 3 / m3 6 / m4 5 / robustness 5 / m5-timing 3）；lint: oxlint 0 告警
- main 历史：6 squash（M1 / M2+M3 计划 / M3+审计 / M4 / M5 装配 docs / 时序测试）

## 关键契约（接入方必读）

1. scheduler 是**可选项**：ctx.get + withService 就绪订阅 + 全程 fail-open（ACP/WC 已实现，照抄）
2. recordUsage({sessionId?, section, injectedChars, date?})——sessionId 空串不传落 global 槽
3. 记账恒为字符；section.unit 标 budget 口径（tokens→charPerToken 1.5 估算，非计费）
4. 消费（B10 面板）：启动 exportState 快照 + 运行期 domain/changed 增量 merge（测试固化）
5. 冲突：同 order 不同 key → conflictPolicy warn（默认）/reject（ok:false+conflictWith）

## 正式实例（web profile）装配状态

- profiles/web/package.json（dependencies link + bundles）+ cordis.patch.yml 配置块
  + node_modules junction（EPERM 绕过；.package-map.json 已补；lock 下次 install 自愈）
- 数据：C:\Users\Administrator\.dsh\storages\inject_scheduler.json
- 验证（2026-09-05 二次重启后通过）：sections 2 行（acp.composer order10 tokens1600 /
  wc.work_state order20 chars0）+ usage 随会话实时增长（每会话每轮 ~1200 字符，count 累加）
- 回滚：M5-ASSEMBLY.md §4

## 里程碑记录

| M | 交付 | 备注 |
|---|---|---|
| M1 | domain+服务骨架，8 测试 | 并发首写竞态在审计中修（宏作业队列） |
| M2 | ACP/WC 方案 A 接线 | 用户拍板 A（主动上报）vs B（长度差估算） |
| M3 | conflictPolicy + getSessionReport | maid 压缩对照移交 M4 后定论：session 事件流不耦合 |
| M4 | usageSeries/exportState/B10-CONTRACT | 快照+增量重建==终态测试 |
| M5 | 装配+验证 | 两轮重启：patch 守卫 bug（接线从未插入）修复后通过 |

## 下一步（未决，等用户）

- S2：memento/shared-memory 迁移管道（B9 v0.3 主体，ACP repo scripts/）
- B10 面板本体（数据面已交付，消费方立项时读 B10-CONTRACT.md）
- usage 容量治理（远期；与 ACP P6 联动）
- push GitHub / publish（仓库 README 已备；等用户节奏）
