// test/m1.test.mjs — M1 骨架 + storageDomain 记账表（P7 开工包 M1 验收）。
// 用例面见 docs/PLAN-M1.md §6。

import test from 'node:test'
import assert from 'node:assert/strict'
import { harness } from './helpers/harness.mjs'
import { MemoryMediaPool } from './helpers/memory-backend.mjs'
import {
  DOMAIN_NAME, GLOBAL_SESSION, localDateOf, USAGE_KEY_SEP,
} from '../src/domain.mjs'

const dshEvents = (changes) => changes.filter((c) => c.domain === DOMAIN_NAME)

test('M1: apply 可启动，空态读不炸', async () => {
  const h = await harness()
  try {
    assert.equal(h.scheduler.ready, true)
    assert.equal(h.scheduler.domainName, DOMAIN_NAME)
    assert.deepEqual(h.scheduler.listSections(), [])
    assert.deepEqual(h.scheduler.getUsage(), [])
  } finally {
    await h.dispose()
  }
})

test('M1: registerSection 幂等覆盖 + listSections 按 order 升序', async () => {
  const h = await harness()
  try {
    const s = h.scheduler
    const a = await s.registerSection({ key: 'acp.composer', plugin: 'dsh-adaptive-context', order: -50, budgetChars: 1600, refresh: 'per-turn' })
    assert.equal(a.ok, true)
    const b = await s.registerSection({ key: 'wc.work_state', plugin: 'dsh-work-continuity', order: -40, budgetChars: 250, refresh: 'per-turn' })
    assert.equal(b.ok, true)
    // 覆盖：order 变化生效
    const c = await s.registerSection({ key: 'acp.composer', plugin: 'dsh-adaptive-context', order: -60, budgetChars: 1600, refresh: 'per-turn' })
    assert.equal(c.ok, true)

    const list = s.listSections()
    assert.deepEqual(list.map((r) => r.key), ['acp.composer', 'wc.work_state'])  // -60 < -40
    assert.equal(list[0].order, -60)
    assert.equal(list[0].plugin, 'dsh-adaptive-context')
    assert.equal(list.length, 2)
  } finally {
    await h.dispose()
  }
})

test('M1: recordUsage 首笔 put 后 update 累加；跨 key 隔离', async () => {
  const h = await harness()
  try {
    const s = h.scheduler
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const r1 = await s.recordUsage({ sessionId, section: 'acp.composer', injectedChars: 100 })
    assert.equal(r1.ok, true)
    assert.equal(r1.total, 100)
    assert.equal(r1.count, 1)
    const r2 = await s.recordUsage({ sessionId, section: 'acp.composer', injectedChars: 200 })
    assert.equal(r2.total, 300)
    assert.equal(r2.count, 2)
    const r3 = await s.recordUsage({ sessionId, section: 'acp.composer', injectedChars: 50 })
    assert.equal(r3.total, 350)
    assert.equal(r3.count, 3)

    // 不同 section 隔离
    await s.recordUsage({ sessionId, section: 'wc.work_state', injectedChars: 10 })
    // 不同 session 隔离
    await s.recordUsage({ sessionId: 'ffffffff-1111-2222-3333-444444444444', section: 'acp.composer', injectedChars: 999 })

    const rows = s.getUsage({ sessionId, section: 'acp.composer' })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].injectedChars, 350)
    assert.equal(rows[0].count, 3)
    assert.equal(s.getUsage({ sessionId, section: 'wc.work_state' })[0].injectedChars, 10)
    assert.equal(s.getUsage({ sessionId: 'ffffffff-1111-2222-3333-444444444444' })[0].injectedChars, 999)
    assert.equal(s.getUsage().length, 3)
  } finally {
    await h.dispose()
  }
})

test('M1: recordUsage 缺省 sessionId → global 槽；缺省 date → 本地日', async () => {
  const h = await harness()
  try {
    const s = h.scheduler
    const r = await s.recordUsage({ section: 'wc.work_state', injectedChars: 42 })
    assert.equal(r.ok, true)
    const [row] = s.getUsage()
    assert.equal(row.sessionId, GLOBAL_SESSION)
    assert.equal(row.date, localDateOf())
    assert.equal(r.key, [GLOBAL_SESSION, localDateOf(), 'wc.work_state'].join(USAGE_KEY_SEP))
  } finally {
    await h.dispose()
  }
})

test('M1: domain/changed 可订阅，事件形状与写链序正确', async () => {
  const h = await harness()
  try {
    const s = h.scheduler
    await s.registerSection({ key: 'acp.composer', plugin: 'dsh-adaptive-context', order: -50, budgetChars: 1600, refresh: 'per-turn' })
    await s.recordUsage({ sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', section: 'acp.composer', injectedChars: 100 })
    await s.recordUsage({ sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', section: 'acp.composer', injectedChars: 200 })

    const events = dshEvents(h.changes)
    assert.equal(events.length, 3)
    const [e1, e2, e3] = events
    assert.deepEqual(
      { domain: e1.domain, table: e1.table, key: e1.key, operation: e1.operation },
      { domain: DOMAIN_NAME, table: 'sections', key: 'acp.composer', operation: 'put' },
    )
    assert.equal(e1.value.key, 'acp.composer')
    assert.deepEqual(
      { domain: e2.domain, table: e2.table, operation: e2.operation },
      { domain: DOMAIN_NAME, table: 'usage', operation: 'put' },
    )
    assert.equal(e2.value.injectedChars, 100)   // 首笔：事件带当笔快照
    assert.equal(e3.value.injectedChars, 300)   // update 后：事件带累计快照
    assert.equal(e3.value.count, 2)
    // 写链序：同域事件按序到达（注册在记账前）
    assert.equal(h.changes.findIndex((c) => c === e2) < h.changes.findIndex((c) => c === e3), true)
  } finally {
    await h.dispose()
  }
})

test('M1: 防御性校验——非法输入拒绝且不落表', async () => {
  const h = await harness()
  try {
    const s = h.scheduler
    const bad = await Promise.all([
      s.registerSection({ key: 'acp.composer', plugin: 'x', order: 0, budgetChars: 100, refresh: 'sometimes' }),  // 非法 refresh
      s.registerSection({ key: 'acp.composer', plugin: 'x', order: 1.5, budgetChars: 100, refresh: 'per-turn' }), // 非 int order
      s.registerSection({ key: 'acp.composer', plugin: 'x', order: 0, budgetChars: -1, refresh: 'per-turn' }),    // 负 budget
      s.registerSection({ key: 'Bad Key!', plugin: 'x', order: 0, budgetChars: 100, refresh: 'per-turn' }),       // 非法 key
      s.registerSection({ key: 'acp.composer', plugin: '', order: 0, budgetChars: 100, refresh: 'per-turn' }),    // 空 plugin
      s.recordUsage({ sessionId: 'x::y', section: 'acp.composer', injectedChars: 1 }),                            // sessionId 含分隔符
      s.recordUsage({ sessionId: 's', section: 'acp.composer', injectedChars: -5 }),                              // 负字符
      s.recordUsage({ sessionId: 's', section: 'ACp', injectedChars: 1 }),                                        // 非法 section
      s.recordUsage({ sessionId: 's', section: 'acp.composer', injectedChars: 1.5 }),                             // 非 int
    ])
    for (const r of bad) {
      assert.equal(r.ok, false, '应拒绝: ' + JSON.stringify(r))
      assert.ok(r.error, '错误应带 message')
    }
    assert.equal(s.listSections().length, 0)
    assert.equal(s.getUsage().length, 0)
  } finally {
    await h.dispose()
  }
})

test('M1: 重启持久性——共享 pool 重建栈后记账仍在', async () => {
  const pool = new MemoryMediaPool()
  const h1 = await harness({ pool })
  await h1.scheduler.registerSection({ key: 'acp.composer', plugin: 'dsh-adaptive-context', order: -50, budgetChars: 1600, refresh: 'per-turn' })
  await h1.scheduler.recordUsage({ sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', section: 'acp.composer', injectedChars: 777 })
  await h1.dispose()

  const h2 = await harness({ pool })
  try {
    assert.deepEqual(h2.scheduler.listSections().map((r) => r.key), ['acp.composer'])
    const rows = h2.scheduler.getUsage()
    assert.equal(rows.length, 1)
    assert.equal(rows[0].injectedChars, 777)
    // 重启后继续累加
    const r = await h2.scheduler.recordUsage({ sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', section: 'acp.composer', injectedChars: 23 })
    assert.equal(r.total, 800)
    assert.equal(r.count, 2)
  } finally {
    await h2.dispose()
  }
})

test('M1: verbose 配置生效（domain/changed 日志通路不炸）', async () => {
  const h = await harness({ pluginConfig: { verbose: true } })
  try {
    await h.scheduler.registerSection({ key: 'acp.composer', plugin: 'x', order: 0, budgetChars: 10, refresh: 'frozen' })
    await h.scheduler.recordUsage({ section: 'acp.composer', injectedChars: 3 })
    assert.equal(dshEvents(h.changes).length, 2)
  } finally {
    await h.dispose()
  }
})
