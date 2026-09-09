// src/service.mjs — Service Definition：ctx.injectScheduler。
//
// M1–M4 面（P7 开工包）：段注册表 + 用量账 + 读 + 冲突检测/预算汇总 + B10 数据源（曲线/快照）。
// 写路径：zod parse（写侧自校验）→ domain 表 put/update（域写链串行）。
// 竞争：首笔 put + 后续 update 累加；update missing-key（并发首写窗口）→ 重试 put。
// 生命周期：服务构造前提 = domain 已 open（apply await 后创建），无独立 ready 状态——
// domain 关闭后读写由 storage-domain 抛 closed，不再设恒真 ready 字段误导消费方。
// 并发（2026-09-05 健壮性审计补）：域写链只保证单个 put/update 作业串行，而
// recordUsage 的"update missing-key → 回退 put"跨两个作业——并发首写存在覆盖窗口。
// 修法：service 级微队列把一次 registerSection/recordUsage 整体串成宏作业（见 enqueue）。

import {
  DOMAIN_NAME, GLOBAL_SESSION, USAGE_KEY_SEP, localDateOf, bandOf,
  registerInputSchema, usageInputSchema,
} from './domain.mjs'

/** 置信度降级序：unknown > estimated > reported（多条累加取最弱） */
const CONF_RANK = { reported: 0, estimated: 1, unknown: 2 }
function weakestConfidence(a, b) {
  const ra = CONF_RANK[a] ?? 2
  const rb = CONF_RANK[b] ?? 2
  if (ra === rb) return a ?? b ?? 'unknown'
  return ra > rb ? (a ?? 'unknown') : (b ?? 'unknown')
}

/** 段/报告统一排序键：(order, rank, key)——跨 step 确定性 */
function compareSections(a, b) {
  return (a.order - b.order)
    || ((a.rank ?? 0) - (b.rank ?? 0))
    || (a.section < b.section ? -1 : a.section > b.section ? 1 : 0)
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
}

const isMissingKey = (err) =>
  err?.code === 'missing-key' || /missing-key/.test(String(err?.message ?? err))

/**
 * 构造 ctx.injectScheduler 服务（纯内存读 + 域写链写，无自有状态）。
 * @param {import('@deepseek-ai/dsh-storage-domain').Domain} domain - inject_scheduler domain（open 后）
 * @param {object} [ctx] - 插件 ctx（提供 logger；缺省无日志——冲突 warn 仅降级为静默注册）
 * @param {object} [options]
 * @param {'warn'|'reject'} [options.conflictPolicy] - 同 order 段冲突处理（默认 warn）
 * @param {number} [options.charPerToken] - token↔字符经验换算（预算对照估算用，默认 1.5）
 */
export function createInjectSchedulerService(domain, ctx, options = {}) {
  const { conflictPolicy = 'warn', charPerToken = 1.5 } = options
  const sections = domain.table('sections')
  const usage = domain.table('usage')
  const log = (level, msg) => ctx?.logger?.[level]?.(msg)
  /** census 观测缓存（内存态，不落 domain——观测数据不是权威数据） */
  const censusBySession = new Map()

  /** 统一输入校验面：合法 → {ok:true, value}；非法 → {ok:false, error}（与对外 API 同构） */
  /** 写宏作业队列：把"检测/读 + 回退写"的复合操作串成单链节（域写链不覆盖复合窗口） */
  let tail = Promise.resolve()
  const enqueue = (job) => {
    const run = tail.then(job, job)
    tail = run.then(() => undefined, () => undefined)
    return run
  }

  const parseOr = (schema, input, label) => {
    const res = schema.safeParse(input)
    if (!res.success) {
      const issue = res.error.issues?.[0]
      const where = issue?.path?.join('.') || label
      return { ok: false, error: 'invalid ' + label + (where ? ' [' + where + ']' : '') + ': ' + (issue?.message ?? 'schema violation') }
    }
    return { ok: true, value: res.data }
  }

  const now = () => Date.now()

  async function registerSectionInner(input) {
    const r = parseOr(registerInputSchema, input, 'section')
    if (!r.ok) return r
    const record = { ...r.value, updatedAt: now() }
    // M3 冲突检测：同 order 且不同 key = 冲突（同 key 重注册是幂等覆盖，不算）。
    // 注册发生在各插件 apply（withService 到达）——每次注册后增量检测，
    // 启动期全部注册完即等效"启动报告"（无可靠的全装载完成事件可挂）。
    const rival = [...sections.entries()]
      .map(([, v]) => v)
      .find((v) => v.order === record.order && v.key !== record.key)
    if (rival) {
      const msg = '[inject-scheduler] order conflict: ' + record.key + ' (order ' + record.order
        + ') clashes with ' + rival.key + ' (plugin ' + rival.plugin + ')'
      if (conflictPolicy === 'reject') {
        log('warn', msg + ' — registration rejected (conflictPolicy=reject)')
        return { ok: false, error: 'order-conflict', conflictWith: [rival.key], message: msg }
      }
      log('warn', msg + ' — registered anyway (conflictPolicy=warn)')
    }
    await sections.put(record.key, record)
    // 注册汇总（启动期日志；last 一条的 total 即最终段数）
    log('info', '[inject-scheduler] section registered key=' + record.key + ' plugin=' + record.plugin
      + ' order=' + record.order + ' budget=' + record.budgetChars + record.unit
      + ' refresh=' + record.refresh + ' total=' + sections.size)
    return { ok: true, key: record.key }
  }

  async function recordUsageInner(input) {
    const r = parseOr(usageInputSchema, input, 'usage')
    if (!r.ok) return r
    const sessionId = r.value.sessionId ?? GLOBAL_SESSION
    const date = r.value.date ?? localDateOf()
    const key = [sessionId, date, r.value.section].join(USAGE_KEY_SEP)
    const base = { sessionId, date, section: r.value.section }
    const step = r.value.injectedChars
    try {
      const next = await usage.update(key, (cur) => ({
        ...cur,
        injectedChars: cur.injectedChars + step,
        count: cur.count + 1,
        // 置信度取最弱：一旦有未知/估算混入，就不能继续声称是实测值
        confidence: weakestConfidence(cur.confidence, r.value.confidence),
        updatedAt: now(),
      }))
      return { ok: true, key, total: next.injectedChars, count: next.count }
    } catch (err) {
      if (isMissingKey(err)) {
        const record = { ...base, injectedChars: step, count: 1, confidence: r.value.confidence, updatedAt: now() }
        await usage.put(key, record)
        return { ok: true, key, total: record.injectedChars, count: 1 }
      }
      throw err
    }
  }

  /** census 写入（内存态；只读观测，不落 domain） */
  function recordCensusInner(input = {}) {
    const observedUniq = [...new Set((Array.isArray(input.observed) ? input.observed : [])
      .map((v) => String(v ?? '')).filter(Boolean))]
    const registeredUniq = [...new Set([...sections.entries()].map(([, v]) => v.plugin))]
    const sessionId = typeof input.sessionId === 'string' && input.sessionId ? input.sessionId : GLOBAL_SESSION
    const census = {
      sessionId,
      observedAt: now(),
      observed: observedUniq,
      registered: registeredUniq,
      /** 实际注入但未注册 = 调度器看不见的注入方（碎片化的真实来源） */
      unregistered: observedUniq.filter((p) => !registeredUniq.includes(p)),
      /** 已注册但本轮未注入 = 节流/未触发/空转，需要与故障区分 */
      silent: registeredUniq.filter((p) => !observedUniq.includes(p)),
    }
    censusBySession.set(sessionId, census)
    return census
  }

  /** 最近一次 census（给 sessionId 则取该会话，否则取全局最近一次）；无观测 → null */
  function getCensusInner(sessionId) {
    if (typeof sessionId === 'string' && sessionId) return censusBySession.get(sessionId) ?? null
    let latest = null
    for (const c of censusBySession.values()) {
      if (!latest || c.observedAt >= latest.observedAt) latest = c
    }
    return latest
  }

  return {
    domainName: DOMAIN_NAME,

    /** 注册/覆盖一段（幂等；ACP/WC 声明段时调用）。budgetChars=0 = 未设上限。 */
    registerSection(input) {
      return enqueue(() => registerSectionInner(input))
    },

    /** 注销一段（插件卸载路径）；非 string key 视为 no-op（delete 缺失 key 返回 false） */
    async unregisterSection(key) {
      if (typeof key !== 'string' || key.length === 0) return false
      return sections.delete(key)
    },

    /** 记一笔注入（sessionId 缺省记 GLOBAL_SESSION 槽；date 缺省取本地日） */
    recordUsage(input) {
      return enqueue(() => recordUsageInner(input))
    },

    /**
     * 段注册表快照（同步读，来自域内存态）。
     * 排序键 = (order, rank, key)（2026-09-09）：order 分带 + 同带内 rank 裁决 + key 兜底，
     * 保证跨 step 确定性（同名/同 order 不再靠注册顺序碰运气）。
     */
    listSections() {
      return [...sections.entries()].map(([, v]) => v).sort(compareSections)
    },

    /**
     * P0-1 census（2026-09-09）：实际注入面 vs 注册表对账。
     *
     * 只读、零侵入：由入口的 pre-step 观察者把「本轮真实注入的 plugin」喂进来，
     * 服务与注册表做差集——一个不调用 ctx.get('injectScheduler') 的插件对我们完全隐形，
     * 这是唯一能看见它的办法（借鉴 dsh-granular-prompt 的 census 思路，但不接管组装）。
     * @param {{sessionId?: string, observed?: string[]}} input
     */
    recordCensus(input = {}) {
      return recordCensusInner(input)
    },

    /** 最近一次 census（给 sessionId 则取该会话，否则取全局最近一次）；无观测 → null */
    getCensus(sessionId) {
      return getCensusInner(sessionId)
    },

    /** 用量账过滤读；过滤条件缺省 = 全量 */
    getUsage(filter = {}) {
      const { sessionId, date, section } = filter
      return [...usage.entries()]
        .map(([, v]) => v)
        .filter((v) =>
          (sessionId === undefined || v.sessionId === sessionId) &&
          (date === undefined || v.date === date) &&
          (section === undefined || v.section === section))
    },

    /**
     * 注入曲线明细（M4/B10 数据源）：按 (date, sessionId, section) 字典序——
     * YYYY-MM-DD 字符串序即时间序。消费方自行聚合（按日合计/按 section 堆叠）。
     */
    usageSeries(filter = {}) {
      const { sessionId, date, section, dateFrom, dateTo } = filter
      return [...usage.entries()]
        .map(([, v]) => v)
        .filter((v) =>
          (sessionId === undefined || v.sessionId === sessionId) &&
          (date === undefined || v.date === date) &&
          (section === undefined || v.section === section) &&
          (dateFrom === undefined || v.date >= dateFrom) &&
          (dateTo === undefined || v.date <= dateTo))
        .sort((a, b) =>
          (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
          (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0) ||
          (a.section < b.section ? -1 : a.section > b.section ? 1 : 0))
    },

    /**
     * B10 启动基线/备份/调试/迁移快照（M4）：内容与同刻 listSections()/getUsage()
     * 相等（对账承诺），排序稳定（sections 按 order；usage 按 sessionId/date/section）。
     * 消费模式 = 启动快照 + 运行期 domain/changed 增量 merge（见 docs/B10-CONTRACT.md）。
     */
    exportState() {
      const byKey = (a, b) =>
        (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0) ||
        (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
        (a.section < b.section ? -1 : a.section > b.section ? 1 : 0)
      return {
        format: 'dsh-inject-scheduler-state',
        version: 1,
        exportedAt: new Date().toISOString(),
        sections: [...sections.entries()].map(([, v]) => v).sort((a, b) => a.order - b.order),
        usage: [...usage.entries()].map(([, v]) => v).sort(byKey),
      }
    },

    /**
     * 每会话注入预算汇总（M3；B10 面板最小查询面）。
     * usage 侧恒为 chars；对照段预算需同口径：unit='tokens' 段用 charPerToken 经验系数
     * 估算 estimatedTokens（估算非计费——数量级可见即可，M4 面板标注口径）；
     * unit='chars' 段（如 wc）直接 chars 对 budget。budgetChars=0（未设上限）→ usageRatio null。
     */
    getSessionReport(filter = {}) {
      const rows = this.getUsage(filter)
      const bySection = new Map()
      for (const row of rows) {
        const agg = bySection.get(row.section) ?? { injectedChars: 0, count: 0, confidence: 'reported' }
        agg.injectedChars += row.injectedChars
        agg.count += row.count
        agg.confidence = weakestConfidence(agg.confidence, row.confidence)
        bySection.set(row.section, agg)
      }
      const sectionRows = [...sections.entries()].map(([, v]) => v)
      const report = []
      for (const s of sectionRows) {
        const agg = bySection.get(s.key)
        if (!agg) continue // 无注入量的段不进报告
        const injectedChars = agg.injectedChars
        let estimatedTokens = null
        let usageRatio = null
        if (s.unit === 'tokens') {
          estimatedTokens = Math.round(injectedChars * charPerToken)
          if (s.budgetChars > 0) usageRatio = estimatedTokens / s.budgetChars
        } else if (s.budgetChars > 0) {
          usageRatio = injectedChars / s.budgetChars
        }
        report.push({
          section: s.key,
          plugin: s.plugin,
          order: s.order,
          band: bandOf(s.order),
          rank: s.rank ?? 0,
          unit: s.unit,
          budgetChars: s.budgetChars,
          injectedChars,
          count: agg.count,
          // 自报 ≠ 实测：把归因置信度带到面板，缺失记 unknown（不静默当 0）
          confidence: agg.confidence ?? 'unknown',
          estimatedTokens,
          usageRatio,
        })
      }
      report.sort(compareSections)
      const totals = {
        injectedChars: report.reduce((sum, r) => sum + r.injectedChars, 0),
        estimatedTokens: report.reduce((sum, r) => sum + (r.estimatedTokens ?? 0), 0),
        sections: report.length,
      }
      return {
        sessionId: filter.sessionId ?? 'all',
        date: filter.date ?? 'all',
        charPerToken,
        sections: report,
        totals,
        // P0-1：把「注册面 vs 实际注入面」的差异一并带出来（无观测 → null）
        census: getCensusInner(filter.sessionId),
      }
    },
  }
}
