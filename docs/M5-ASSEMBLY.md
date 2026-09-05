# M5-ASSEMBLY — 正式实例装配记录与验证清单

> 日期：2026-09-05 · 状态：**装配完成，等待 DSH 重启后验证**（重启会中断当前会话——验证由重启后的新会话执行）。

## 1. 装配内容（已完成，全部就位）

| # | 位置 | 改动 |
|---|---|---|
| 1 | `~/.dsh/profiles/web/package.json` | dependencies 加 `"dsh-inject-scheduler": "link:D:/DSH_workspace/my-plugins/dsh-inject-scheduler"`；bundles 数组追加 `dsh-inject-scheduler`（22 项） |
| 2 | `~/.dsh/profiles/web/cordis.patch.yml` | 新增 inject-scheduler 配置块：verbose=false / conflictPolicy=warn / charPerToken=1.5 |
| 3 | `~/.dsh/profiles/web/node_modules/dsh-inject-scheduler` | **junction** → `D:\DSH_workspace\my-plugins\dsh-inject-scheduler`（pnpm install 因运行中 DSH 锁 EPERM——手动 junction 等价 link: 依赖；.package-map.json 已补 `link:D:/...` 记录） |

- import 冒烟 ✓（loader 可解析：name=inject-scheduler, inject=['storageDomain']）
- 数据落点：`<DSH_HOME>/storages/inject_scheduler.json`（base bundle storage-json root=dshHomePath('storages')；域 single layout 单文件）
- 未动：`profiles/web/pnpm-lock.yaml`（无 scheduler 项——下次完整 pnpm install 自动补齐，运行时无碍）

## 2. 依赖关系（为什么不需要其他装配）

- storage/backend/storage-domain 已在 base bundle（storage 三件套 + backend: json）——scheduler 的
  inject=['storageDomain'] 直接可用；
- ACP/WC 的接线（M2 已合各自分支）经 ctx.get + withService——与 scheduler 装载顺序无关，重启即自动注册上报。

## 3. 验证清单（重启后的新会话执行）

预期：acp.composer(order 10) / wc.work_state(order 20)——不同 order，**零冲突报告**。

1. 启动日志（DSH 控制台/日志）应出现两条注册 info：
   `[inject-scheduler] section registered key=acp.composer plugin=dsh-adaptive-context order=10 ... total=1`
   `[inject-scheduler] section registered key=wc.work_state plugin=dsh-work-continuity order=20 ... total=2`
   且无 `order conflict` warn。
2. 正常对话若干轮（让 ACP/WC 实际注入）后，检查数据文件：
   `C:\Users\Administrator\.dsh\storages\inject_scheduler.json`——
   sections 2 行 + usage 行数随会话增长（每段每日一行，count 累加）。
3. 快速统计（node 读 json）：usage 行数 > 0；chars 合计合理；session 维度的行 sessionId 是真实会话 uuid。
4. 交叉对照（若想开 verbose 观察事件流）：cordis.patch.yml 的 inject-scheduler verbose 改 true → 重启 →
   每笔记账打 `[inject-scheduler] usage <key> put chars=N count=M`；验完改回 false。

## 4. 回滚路径（如需）

1. cordis.patch.yml 删 inject-scheduler 块
2. profiles/web/package.json：删 dependencies 项 + bundles 项
3. 删 junction：`cmd /c rmdir <node_modules>\dsh-inject-scheduler`
4. .package-map.json 删记录（或下次 install 自愈）
5. 重启 DSH

## 5. 已知预期

- 首次 usage 行出现在"ACP/WC 实际注入了内容"的轮次（无内容注入不记账——设计如此）；
- 跨会话 policy 下部分轮次 ACP 不注入（non-instructional）——usage 稀疏是正常的；
- 重启后若 storage json 文件尚未生成（无写入）——打开一次有注入的会话即生成。
