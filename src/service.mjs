// src/service.mjs — Service Definition：ctx.injectScheduler。
//
// M1+M2 面（P7 开工包）：段注册表 + 用量账 + 读；不接 pre-step、不做排序执行。
// 写路径：zod parse（写侧自校验）→ domain 表 put/update（域写链串行）。
// 竞争：首笔 put + 后续 update 累加；update missing-key（并发首写窗口）→ 重试 put。
// 生命周期：服务构造前提 = domain 已 open（apply await 后创建），无独立 ready 状态——
// domain 关闭后读写由 storage-domain 抛 closed，不再设恒真 ready 字段误导消费方。

import {
  DOMAIN_NAME, GLOBAL_SESSION, USAGE_KEY_SEP, localDateOf,
  registerInputSchema, usageInputSchema,
} from './domain.mjs'

const isMissingKey = (err) =>
  err?.code === 'missing-key' || /missing-key/.test(String(err?.message ?? err))

/**
 * 构造 ctx.injectScheduler 服务（纯内存读 + 域写链写，无自有状态）。
 * @param {import('@deepseek-ai/dsh-storage-domain').Domain} domain - inject_scheduler domain（open 后）
 */
export function createInjectSchedulerService(domain) {
  const sections = domain.table('sections')
  const usage = domain.table('usage')

  /** 统一输入校验面：合法 → {ok:true, value}；非法 → {ok:false, error}（与对外 API 同构） */
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

  return {
    domainName: DOMAIN_NAME,

    /** 注册/覆盖一段（幂等；ACP/WC 声明段时调用）。budgetChars=0 = 未设上限。 */
    async registerSection(input) {
      const r = parseOr(registerInputSchema, input, 'section')
      if (!r.ok) return r
      const record = { ...r.value, updatedAt: now() }
      await sections.put(record.key, record)
      return { ok: true, key: record.key }
    },

    /** 注销一段（插件卸载路径）；返回是否真的删了（key 不校验：delete 缺失 key 是 no-op） */
    async unregisterSection(key) {
      return sections.delete(key)
    },

    /** 记一笔注入（sessionId 缺省记 GLOBAL_SESSION 槽；date 缺省取本地日） */
    async recordUsage(input) {
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
          updatedAt: now(),
        }))
        return { ok: true, key, total: next.injectedChars, count: next.count }
      } catch (err) {
        if (isMissingKey(err)) {
          const record = { ...base, injectedChars: step, count: 1, updatedAt: now() }
          await usage.put(key, record)
          return { ok: true, key, total: record.injectedChars, count: 1 }
        }
        throw err
      }
    },

    /** 段注册表快照（按 order 升序；同步读，来自域内存态） */
    listSections() {
      return [...sections.entries()].map(([, v]) => v).sort((a, b) => a.order - b.order)
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
  }
}
