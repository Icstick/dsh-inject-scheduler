// test/robustness.test.mjs — 健壮性专项（2026-09-05 审计后补）：
//   ①并发首写竞态（update missing→put 回退窗口）②非 string key ③关闭后调用面。

import test from 'node:test'
import assert from 'node:assert/strict'
import { harness } from './helpers/harness.mjs'

const sid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

test('健壮性: 同 key 并发 recordUsage（首写竞态窗口）→ 无丢失', async () => {
  const h = await harness()
  try {
    const s = h.scheduler
    const N = 12
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) => s.recordUsage({ sessionId: sid, section: 'acp.composer', injectedChars: i + 1 })),
    )
    for (const r of results) assert.equal(r.ok, true, JSON.stringify(r))
    const rows = s.getUsage({ sessionId: sid, section: 'acp.composer' })
    assert.equal(rows.length, 1)
    const total = (N * (N + 1)) / 2 // 1..N 求和
    assert.equal(rows[0].injectedChars, total, '并发累加无覆盖丢失')
    assert.equal(rows[0].count, N)
  } finally {
    await h.dispose()
  }
})

test('健壮性: 并发注册同 order 不同 key（reject 策略）→ 至少一个成功且无重复', async () => {
  const h = await harness({ pluginConfig: { conflictPolicy: 'reject' } })
  try {
    const s = h.scheduler
    const [a, b] = await Promise.all([
      s.registerSection({ key: 'x.one', plugin: 'p1', order: 7, budgetChars: 100, refresh: 'per-turn' }),
      s.registerSection({ key: 'x.two', plugin: 'p2', order: 7, budgetChars: 100, refresh: 'per-turn' }),
    ])
    // 队列串行化后：先者成功，后者必被拒（无"双双漏检"窗口）
    assert.equal([a.ok, b.ok].filter(Boolean).length, 1, '应恰好一个成功')
    assert.equal(s.listSections().length, 1)
    const loser = a.ok ? b : a
    assert.equal(loser.ok, false)
    assert.equal(loser.error, 'order-conflict')
  } finally {
    await h.dispose()
  }
})

test('健壮性: unregisterSection 非 string/空串 → no-op false', async () => {
  const h = await harness()
  try {
    const s = h.scheduler
    assert.equal(await s.unregisterSection(), false)
    assert.equal(await s.unregisterSection(''), false)
    assert.equal(await s.unregisterSection(42), false)
    await s.registerSection({ key: 'x.one', plugin: 'p', order: 1, budgetChars: 10, refresh: 'per-turn' })
    assert.equal(await s.unregisterSection('x.one'), true)
    assert.equal(await s.unregisterSection('x.one'), false)
  } finally {
    await h.dispose()
  }
})

test('健壮性: 正常用法失败路径——非法注入字符拒绝且表不变（回归护栏）', async () => {
  const h = await harness()
  try {
    const s = h.scheduler
    await s.recordUsage({ sessionId: sid, section: 'acp.composer', injectedChars: 10 })
    const bad = await s.recordUsage({ sessionId: sid, section: 'acp.composer', injectedChars: -1 })
    assert.equal(bad.ok, false)
    assert.equal(s.getUsage({ sessionId: sid })[0].injectedChars, 10, '非法笔不落表')
  } finally {
    await h.dispose()
  }
})

test('健壮性: 混合并发注册+记账不交错崩（宏作业队列）', async () => {
  const h = await harness()
  try {
    const s = h.scheduler
    await Promise.all([
      s.registerSection({ key: 'acp.composer', plugin: 'x', order: 1, budgetChars: 100, unit: 'tokens', refresh: 'per-turn' }),
      s.recordUsage({ sessionId: sid, section: 'acp.composer', injectedChars: 5 }),
      s.recordUsage({ sessionId: sid, section: 'acp.composer', injectedChars: 7 }),
    ])
    const rep = s.getSessionReport({ sessionId: sid })
    assert.equal(rep.sections.length, 1)
    assert.equal(rep.sections[0].injectedChars, 12)
    assert.equal(rep.sections[0].count, 2)
  } finally {
    await h.dispose()
  }
})
