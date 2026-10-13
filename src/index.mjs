// src/index.mjs — dsh-inject-scheduler 插件入口。
//
// 职责（P7 开工包 M1）：open inject_scheduler domain（官方 storageDomain）→
// provide ctx.injectScheduler → 订阅 domain/changed（verbose 日志 = 订阅通路验证）。
// 非侵入：不接管 ACP/WC 的 pre-step 注入实现，先做观测/记账底座。

import z from '@deepseek-ai/schemastery'
import { injectSchedulerDomainSpec, DOMAIN_NAME } from './domain.mjs'
import { createInjectSchedulerService } from './service.mjs'

export const name = 'inject-scheduler'
export const inject = ['storageDomain']

export const Config = z.object({
  /** domain/changed 事件日志开关（订阅通路可观测；默认关，避免每笔记账刷屏） */
  verbose: z.boolean().default(false),
  /** 同 order 段冲突处理：warn（记录并注册）/ reject（拒绝注册返回 ok:false） */
  conflictPolicy: z.union(['warn', 'reject'].map((v) => z.const(v))).default('warn'),
  /** token↔字符经验换算系数（getSessionReport 对照 unit=tokens 段预算的估算用；非计费） */
  charPerToken: z.number().min(0.1).max(10).default(1.5),
})

/**
 * 从 message.source 取注入方名（census 观察面入口归一，2026-10-02 修。
 * 消费侧兼容，不改任何注入方仓库）。
 *
 * 权威形状 = { kind: 'plugin', plugin: '<name>' }——上游 docs/cookbook/adding-a-tool.md、
 * packages/core/agent/README.md、time-context 与 repeat-tool-reminder 的 README 口径一致
 * （packages/llm/llm/src/message.ts 的 MessageSourceMap "merge-extensible、switch kind、
 * 未知 kind 往下走"），本机 dsh-time-ink/src/index.mjs:48 也照此发。
 *
 * 但本机另有四家注入方实际发的是 { kind: 'plugin:<name>' }（**没有 plugin 字段**）：
 * dsh-adaptive-context/src/index.mjs:758、dsh-knowledge-recall/src/index.mjs:183、
 * dsh-work-continuity/src/index.mjs:459、dsh-context-maid/src/pinner.mjs:125。
 * 旧判据 src.kind === 'plugin' && src.plugin 只认前者 —— 于是这四家在本 census 的
 * observed 里**永远缺席**：差集恒缺四家、unregistered 里永远挂着 ACP，P0-1 机制空转
 * （2026-10-02 由 test/prestep-contract.test.mjs 抓到）。
 *
 * 因此这里两种都认：plugin 字段优先（权威形状），否则 kind 以 'plugin:' 开头时取后缀。
 * 只有 kind 属 plugin 族才认——非插件来源（user/tool/runtime-context…）即使带了个
 * 同名 plugin 字段也不算注入方，避免把别的来源误算进来。
 * 四家偏离方按「只报告、不改它们的仓」处理，是否归一是各自 repo 的决定。
 */
function pluginNameOf(source) {
  if (!source || typeof source !== 'object') return ''
  const kind = source.kind
  if (typeof kind !== 'string' || (kind !== 'plugin' && !kind.startsWith('plugin:'))) return ''
  if (source.plugin) return String(source.plugin)
  return kind.startsWith('plugin:') ? kind.slice('plugin:'.length) : ''
}

export async function apply(ctx, config = {}) {
  const domain = await ctx.storageDomain.open(injectSchedulerDomainSpec)
  // effect 回调必须返回清理函数（卸载时调用）——直接执行会被当作立即注册的 disposer
  ctx.effect(() => () => domain.close(), 'injectScheduler.domainClose')

  const service = createInjectSchedulerService(domain, ctx, {
    conflictPolicy: config.conflictPolicy ?? 'warn',
    charPerToken: config.charPerToken ?? 1.5,
  })
  ctx.provide('injectScheduler', service)

  // P0-1 census（2026-09-09）：只读观察本轮实际注入的 plugin，与注册表做差集。
  // 零侵入——不改任何注入方的实现、不接管组装；next() 的结果原样返回。
  // 这是唯一能看见「不调用 ctx.get('injectScheduler') 的注入方」的办法。
  // census 的最小可见出口：未注册的注入方在日志里点名（同一集合只报一次，避免每轮刷屏）。
  // 真正的消费面是 B10 面板（getSessionReport().census）。
  // 观察面的 source 形状归一（两种 plugin 形状）见下方 pluginNameOf。
  let lastUnregisteredSig = ''
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    try {
      const messages = Array.isArray(decision?.messages) ? decision.messages : []
      const observed = []
      for (const m of messages) {
        const plugin = pluginNameOf(m?.source)
        if (plugin) observed.push(plugin)
      }
      if (observed.length > 0) {
        const census = service.recordCensus({ sessionId: payload?.agent?.session?.id ?? '', observed })
        const sig = census.unregistered.slice().sort().join(',')
        if (sig && sig !== lastUnregisteredSig) {
          lastUnregisteredSig = sig
          ctx.logger?.warn?.('[inject-scheduler] census: unregistered injectors observed (never call registerSection): '
            + sig + ' — registered: ' + census.registered.join(', '))
        }
      }
    } catch (err) {
      ctx.logger?.warn?.('[inject-scheduler] census failed: ' + (err instanceof Error ? err.message : String(err)))
    }
    return decision
  })

  // domain/changed 订阅：本域事件的写链序流（= B10 面板数据源；M1 先验证通路）
  ctx.on('domain/changed', (change) => {
    if (!config.verbose || change.domain !== DOMAIN_NAME) return
    const where = change.table || 'global'
    const value = change.operation === 'put' ? change.value : null
    let detail = ''
    if (value && where === 'usage') {
      detail = ' chars=' + value.injectedChars + ' count=' + value.count
    } else if (value && where === 'sections') {
      detail = ' order=' + value.order + ' budget=' + value.budgetChars + ' ' + value.unit
    }
    ctx.logger?.info?.('[inject-scheduler] ' + where + ' ' + change.key + ' ' + change.operation + detail)
  })
}
