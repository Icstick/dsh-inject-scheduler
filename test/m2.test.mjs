// test/m2.test.mjs — M2 消费方契约（方案 A：注入方主动上报）。
// 固化 ACP/WC 将照抄的访问路径：模块形状插件 + ctx.get('injectScheduler')（不声明 inject，
// 调度器是可选依赖）+ registerSection/recordUsage 语义（unit/budgetChars=0/sessionId 空串）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { harness } from './helpers/harness.mjs'
import { DOMAIN_NAME } from '../src/domain.mjs'

/**
 * fake injector：模拟"方案 A 注入方"的用法（真实度对齐 ACP/WC 改动点）。
 * 契约点：①不声明 inject（ctx.get 可选访问）②apply 注册段 ③每次注入上报实际字符。
 * @returns {{ plugin: object, api: { inject(text, sessionId?): Promise<object> } }}
 */
function makeFakeInjector(opts = {}) {
  const { key = 'fake.injector', plugin = 'fake-injector', order = 5, budgetChars = 0, unit } = opts
  const api = {}
  const pluginDef = {
    name: 'fake-injector',
    // 注意：无 inject 声明——调度器必须经 ctx.get 可选获得（消费方契约）
    apply(ctx) {
      const sched = ctx.get('injectScheduler')
      if (!sched) throw new Error('fake-injector: injectScheduler 未就绪（装配要求 scheduler 先装载）')
      api.registered = sched.registerSection({
        key, plugin, order, budgetChars,
        ...(unit === undefined ? {} : { unit }),
        refresh: 'per-turn',
      })
      api.inject = (text, sessionId) => sched.recordUsage({
        // 空串 sessionId 不传 → 落 global 槽（与 ACP/WC 上报代码同款）
        ...(sessionId ? { sessionId } : {}),
        section: key,
        injectedChars: text.length,
      })
    },
  }
  return { plugin: pluginDef, api }
}

test('M2: 消费方经 ctx.get 注册段——unit 缺省 chars / 显式 tokens / budgetChars=0', async () => {
  const h = await harness()
  try {
    const a = makeFakeInjector({ key: 'wc.work_state', order: 20 })                       // WC 式：0 + 缺省 chars
    const b = makeFakeInjector({ key: 'acp.composer', order: 10, budgetChars: 900, unit: 'tokens' }) // ACP 式
    await h.ctx.plugin(a.plugin)
    await h.ctx.plugin(b.plugin)
    await Promise.all([a.api.registered, b.api.registered])

    const sections = h.scheduler.listSections()
    assert.equal(sections.length, 2)
    const wc = sections.find((s) => s.key === 'wc.work_state')
    const acp = sections.find((s) => s.key === 'acp.composer')
    assert.equal(wc.unit, 'chars')      // 缺省
    assert.equal(wc.budgetChars, 0)     // 0 = 未设上限
    assert.equal(wc.order, 20)
    assert.equal(acp.unit, 'tokens')    // 显式
    assert.equal(acp.budgetChars, 900)
    assert.equal(acp.order, 10)
    // 排序：order 升序
    assert.deepEqual(sections.map((s) => s.key), ['acp.composer', 'wc.work_state'])
  } finally {
    await h.dispose()
  }
})

test('M2: 注入上报——多次注入累加、跨 session 隔离、事件形状', async () => {
  const h = await harness()
  try {
    const f = makeFakeInjector()
    await h.ctx.plugin(f.plugin)
    await f.api.registered
    const sid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const r1 = await f.api.inject('用户画像段注入内容……', sid)   // 14 字 × JS length(中英混) 由调用方数
    assert.equal(r1.ok, true)
    const r2 = await f.api.inject('第二笔', sid)
    assert.equal(r2.total, r1.total + 3)
    assert.equal(r2.count, 2)
    // 另一 session 隔离
    const r3 = await f.api.inject('别的会话', 'ffffffff-1111-2222-3333-444444444444')
    assert.equal(r3.count, 1)
    assert.equal(h.scheduler.getUsage().length, 2)
    assert.equal(h.scheduler.getUsage({ sessionId: sid }).length, 1)
    // domain/changed 事件：3 笔上报 = 3 事件，table=usage
    const usageEvents = h.changes.filter((c) => c.domain === DOMAIN_NAME && c.table === 'usage')
    assert.equal(usageEvents.length, 3)
    assert.equal(usageEvents[0].value.count, 1) // r1 首笔 put
    assert.equal(usageEvents[1].value.count, 2) // r2 update 累加快照
    assert.equal(usageEvents[2].value.count, 1) // r3 另一 session 首笔
  } finally {
    await h.dispose()
  }
})

test('M2: sessionId 空串 → global 槽（ACP/WC 上报同款分支）', async () => {
  const h = await harness()
  try {
    const f = makeFakeInjector()
    await h.ctx.plugin(f.plugin)
    await f.api.registered
    const r = await f.api.inject('无会话上下文时落 global', '')
    assert.equal(r.ok, true)
    const [row] = h.scheduler.getUsage()
    assert.equal(row.sessionId, 'global')
  } finally {
    await h.dispose()
  }
})
