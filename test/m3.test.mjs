// test/m3.test.mjs — M3 冲突检测 + 注册报告 + 每会话预算汇总（PLAN-M3）。
// 行为断言为主（cordis logger 输出面难捕获，策略差异通过 ok/error 语义断言）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { harness } from './helpers/harness.mjs'

const sid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

test('M3: 同 order 冲突（默认 warn）→ 两段都注册成功', async () => {
  const h = await harness() // default conflictPolicy=warn
  try {
    const a = await h.scheduler.registerSection({ key: 'acp.composer', plugin: 'dsh-adaptive-context', order: 10, budgetChars: 1600, unit: 'tokens', refresh: 'per-turn' })
    assert.equal(a.ok, true)
    const b = await h.scheduler.registerSection({ key: 'other.rival', plugin: 'someone', order: 10, budgetChars: 100, refresh: 'per-turn' })
    assert.equal(b.ok, true, 'warn 策略下冲突段仍注册')
    assert.equal(b.error, undefined)
    assert.equal(h.scheduler.listSections().length, 2)
  } finally {
    await h.dispose()
  }
})

test('M3: 冲突 reject（可配）→ 第二段 ok:false + conflictWith，不落表', async () => {
  const h = await harness({ pluginConfig: { conflictPolicy: 'reject' } })
  try {
    await h.scheduler.registerSection({ key: 'acp.composer', plugin: 'dsh-adaptive-context', order: 10, budgetChars: 1600, unit: 'tokens', refresh: 'per-turn' })
    const b = await h.scheduler.registerSection({ key: 'other.rival', plugin: 'someone', order: 10, budgetChars: 100, refresh: 'per-turn' })
    assert.equal(b.ok, false)
    assert.equal(b.error, 'order-conflict')
    assert.deepEqual(b.conflictWith, ['acp.composer'])
    assert.ok(b.message.includes('acp.composer') && b.message.includes('other.rival'))
    assert.deepEqual(h.scheduler.listSections().map((x) => x.key), ['acp.composer'])
  } finally {
    await h.dispose()
  }
})

test('M3: 同 key 重注册（幂等覆盖）不算冲突', async () => {
  const h = await harness({ pluginConfig: { conflictPolicy: 'reject' } })
  try {
    await h.scheduler.registerSection({ key: 'acp.composer', plugin: 'dsh-adaptive-context', order: 10, budgetChars: 1600, unit: 'tokens', refresh: 'per-turn' })
    const again = await h.scheduler.registerSection({ key: 'acp.composer', plugin: 'dsh-adaptive-context', order: 20, budgetChars: 900, unit: 'tokens', refresh: 'per-turn' })
    assert.equal(again.ok, true)
    assert.equal(h.scheduler.listSections().length, 1)
    assert.equal(h.scheduler.listSections()[0].order, 20) // 覆盖生效
  } finally {
    await h.dispose()
  }
})

test('M3: getSessionReport——tokens 段经 charPerToken 估算，chars 段同口径直接比', async () => {
  const h = await harness()
  try {
    const s = h.scheduler
    await s.registerSection({ key: 'acp.composer', plugin: 'dsh-adaptive-context', order: 10, budgetChars: 1600, unit: 'tokens', refresh: 'per-turn' })
    await s.registerSection({ key: 'wc.work_state', plugin: 'dsh-work-continuity', order: 20, budgetChars: 0, refresh: 'per-turn' }) // unit 缺省 chars
    for (let i = 0; i < 3; i++) await s.recordUsage({ sessionId: sid, section: 'acp.composer', injectedChars: 100 })
    await s.recordUsage({ sessionId: sid, section: 'wc.work_state', injectedChars: 200 })
    // 另一会话隔离
    await s.recordUsage({ sessionId: 'ffffffff-1111-2222-3333-444444444444', section: 'acp.composer', injectedChars: 50 })

    const rep = s.getSessionReport({ sessionId: sid })
    assert.equal(rep.sections.length, 2)
    assert.deepEqual(rep.sections.map((x) => x.section), ['acp.composer', 'wc.work_state']) // order 升序
    const acp = rep.sections[0]
    assert.equal(acp.unit, 'tokens')
    assert.equal(acp.injectedChars, 300)
    assert.equal(acp.count, 3)
    assert.equal(acp.estimatedTokens, 450)          // 300 × 1.5（默认系数）
    assert.ok(Math.abs(acp.usageRatio - 450 / 1600) < 1e-9)
    const wc = rep.sections[1]
    assert.equal(wc.unit, 'chars')
    assert.equal(wc.estimatedTokens, null)          // chars 段不换算
    assert.equal(wc.usageRatio, null)               // budget 0（未设上限）
    assert.equal(rep.totals.injectedChars, 500)
    assert.equal(rep.totals.estimatedTokens, 450)
    assert.equal(rep.totals.sections, 2)

    // 全量（不过滤 session）应含另一会话
    const all = s.getSessionReport()
    assert.equal(all.sessionId, 'all')
    assert.equal(all.sections.find((x) => x.section === 'acp.composer').injectedChars, 350)
  } finally {
    await h.dispose()
  }
})

test('M3: charPerToken 可配 + chars 段有 budget 时直接口径', async () => {
  const h = await harness({ pluginConfig: { charPerToken: 2 } })
  try {
    const s = h.scheduler
    await s.registerSection({ key: 'acp.composer', plugin: 'x', order: 10, budgetChars: 1000, unit: 'tokens', refresh: 'per-turn' })
    await s.registerSection({ key: 'wc.work_state', plugin: 'y', order: 20, budgetChars: 500, refresh: 'per-turn' })
    await s.recordUsage({ sessionId: sid, section: 'acp.composer', injectedChars: 200 })
    await s.recordUsage({ sessionId: sid, section: 'wc.work_state', injectedChars: 200 })
    const rep = s.getSessionReport({ sessionId: sid })
    assert.equal(rep.charPerToken, 2)
    assert.equal(rep.sections[0].estimatedTokens, 400)   // 200 × 2
    assert.equal(rep.sections[0].usageRatio, 0.4)        // 400/1000
    assert.equal(rep.sections[1].usageRatio, 0.4)        // 200/500（chars 直接口径）
  } finally {
    await h.dispose()
  }
})

test('M3: 无注入量的段不进报告；空报告不炸', async () => {
  const h = await harness()
  try {
    const s = h.scheduler
    await s.registerSection({ key: 'acp.composer', plugin: 'x', order: 10, budgetChars: 100, unit: 'tokens', refresh: 'per-turn' })
    const rep = s.getSessionReport({ sessionId: sid })
    assert.equal(rep.sections.length, 0)
    assert.equal(rep.totals.injectedChars, 0)
    assert.equal(rep.totals.sections, 0)
    await s.recordUsage({ sessionId: sid, section: 'acp.composer', injectedChars: 10 })
    assert.equal(s.getSessionReport({ sessionId: sid }).sections.length, 1)
  } finally {
    await h.dispose()
  }
})
