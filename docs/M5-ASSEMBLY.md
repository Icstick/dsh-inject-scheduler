# M5-ASSEMBLY — 正式实例装配记录与验证清单

> 日期：2026-09-05 · 状态：**首轮验证发现问题并修复，等待第二次重启**。

## 0. 首轮验证结果与修复（2026-09-05，重启后新会话执行）

发现（实证）：插件加载 ✓、acp.composer 段注册 ✓（withService 等就绪生效）、
**wc.work_state 缺失 + usage 0 行**（26 分钟无写入）。

根因（两层）：
1. **patch 插入守卫 bug（真因）**：最初向 ACP/WC 插接线代码时，"已插入"守卫用
   `!t.includes('调用串')`——函数定义行（export function reportXxx(ctx, sessionId, body)）
   本身就包含调用串 → 守卫误判已插入 → **真实调用点从未插入**。注册调用侥幸
   （registerAcpSection 定义带默认参数 `= {}`，字符串不匹配）所以 acp.composer 在；
   ACP 上报调用与 WC 全部两处接线都被吞。模块级测试只测函数本身，**不覆盖接线点** → 全绿假象。
2. 时序疑云澄清：cordis notify 实际发**两次**（provide 时 + fiber 转 ACTIVE 时，
   vendor/cordis/src/fiber.ts _updateState）——strict ctx.get 的等待路径也能在第二次
   注册成功，**不是** WC 缺失的原因。

修复（三仓库）：
- dsh-adaptive-context 94f4aba：补 pre-step 上报调用（renderSourceLabelled 后）+ 源码级接线守卫测试 2 用例
- dsh-work-continuity 0fed339：补 apply registerWorkStateSection + pre-step 上报调用 + 守卫测试 2 用例
- dsh-inject-scheduler 81bae2b：m5-timing 时序语义固化测试（两次 notify 语义 + 等待路径 strict/non-strict 均注册成功）
- 测试：ACP 18 / WC 28 / scheduler 30 全绿

教训（已入 dev-lessons 候选）：字符串 includes 守卫必须行级 trim 精确匹配；接线类修改要加源码级守卫测试。

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
