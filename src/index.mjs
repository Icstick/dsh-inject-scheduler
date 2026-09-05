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

export async function apply(ctx, config = {}) {
  const domain = await ctx.storageDomain.open(injectSchedulerDomainSpec)
  // effect 回调必须返回清理函数（卸载时调用）——直接执行会被当作立即注册的 disposer
  ctx.effect(() => () => domain.close(), 'injectScheduler.domainClose')

  const service = createInjectSchedulerService(domain, ctx, {
    conflictPolicy: config.conflictPolicy ?? 'warn',
    charPerToken: config.charPerToken ?? 1.5,
  })
  ctx.provide('injectScheduler', service)

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
