// test/m4.test.mjs — M4 B10 数据源面（PLAN-M4）：曲线/快照/事件流消费模式。

import test from 'node:test'
import assert from 'node:assert/strict'
import { harness } from './helpers/harness.mjs'
import { MemoryMediaPool } from './helpers/memory-backend.mjs'
import { DOMAIN_NAME } from '../src/domain.mjs'

const s1 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const s2 = 'ffffffff-1111-2222-3333-444444444444'

async function seed(h) {
  const s = h.scheduler
  await s.registerSection({ key: 'acp.composer', plugin: 'dsh-adaptive-context', order: 10, budgetChars: 1600, unit: 'tokens', refresh: 'per-turn' })
  await s.registerSection({ key: 'wc.work_state', plugin: 'dsh-work-continuity', order: 20, budgetChars: 0, refresh: 'per-turn' })
  await s.recordUsage({ sessionId: s1, section: 'acp.composer', injectedChars: 100, date: '2026-09-01' })
  await s.recordUsage({ sessionId: s1, section: 'acp.composer', injectedChars: 150, date: '2026-09-02' })
  await s.recordUsage({ sessionId: s1, section: 'wc.work_state', injectedChars: 80, date: '2026-09-02' })
  await s.recordUsage({ sessionId: s2, section: 'acp.composer', injectedChars: 60, date: '2026-09-01' })
}

test('M4: usageSeries 过滤与日期排序', async () => {
  const h = await harness()
  try {
    await seed(h)
    // 全量：按 date/session/section 排序
    const all = h.scheduler.usageSeries()
    assert.deepEqual(all.map((r) => r.date), ['2026-09-01', '2026-09-01', '2026-09-02', '2026-09-02'])
    assert.deepEqual(all.map((r) => r.sessionId), [s1, s2, s1, s1])
    assert.deepEqual(all.map((r) => r.section), ['acp.composer', 'acp.composer', 'acp.composer', 'wc.work_state'])
    // 单 session + section 过滤
    const one = h.scheduler.usageSeries({ sessionId: s1, section: 'acp.composer' })
    assert.deepEqual(one.map((r) => r.date), ['2026-09-01', '2026-09-02'])
    assert.deepEqual(one.map((r) => r.injectedChars), [100, 150])
    // 空
    assert.deepEqual(h.scheduler.usageSeries({ sessionId: 'no-such' }), [])
  } finally {
    await h.dispose()
  }
})

test('M4: usageSeries 日期窗口 dateFrom/dateTo', async () => {
  const h = await harness()
  try {
    await seed(h)
    const win = h.scheduler.usageSeries({ sessionId: s1, dateFrom: '2026-09-02', dateTo: '2026-09-02' })
    assert.equal(win.length, 2)
    assert.ok(win.every((r) => r.date === '2026-09-02'))
    const from = h.scheduler.usageSeries({ dateFrom: '2026-09-02' })
    assert.equal(from.length, 2)
    const to = h.scheduler.usageSeries({ dateTo: '2026-09-01' })
    assert.equal(to.length, 2)
  } finally {
    await h.dispose()
  }
})

test('M4: exportState 形状 + 与读面对账', async () => {
  const h = await harness()
  try {
    await seed(h)
    const st = h.scheduler.exportState()
    assert.equal(st.format, 'dsh-inject-scheduler-state')
    assert.equal(st.version, 1)
    assert.ok(typeof st.exportedAt === 'string' && st.exportedAt.length > 0)
    // sections：order 升序，含 unit/budget
    assert.deepEqual(st.sections.map((x) => x.key), ['acp.composer', 'wc.work_state'])
    assert.equal(st.sections[0].unit, 'tokens')
    assert.equal(st.sections[0].budgetChars, 1600)
    // usage：与 getUsage 内容一致（排序后比较）
    const fromState = [...st.usage].sort((a, b) => (a.sessionId + a.date + a.section).localeCompare(b.sessionId + b.date + b.section))
    const fromRead = [...h.scheduler.getUsage()].sort((a, b) => (a.sessionId + a.date + a.section).localeCompare(b.sessionId + b.date + b.section))
    assert.deepEqual(fromState, fromRead)
    assert.equal(st.usage.length, 4)
  } finally {
    await h.dispose()
  }
})

test('M4: exportState 空域不炸', async () => {
  const h = await harness()
  try {
    const st = h.scheduler.exportState()
    assert.deepEqual(st.sections, [])
    assert.deepEqual(st.usage, [])
  } finally {
    await h.dispose()
  }
})

test('M4: B10 消费模式——启动快照 + 运行期事件增量 merge == 终态', async () => {
  const pool = new MemoryMediaPool()
  // 阶段 1：写入并导出基线快照
  const h1 = await harness({ pool })
  await seed(h1)
  const baseline = h1.scheduler.exportState()
  await h1.dispose()

  // 阶段 2：重启后新事件（模拟运行期注入）——消费方同时收集 domain/changed 增量
  const h2 = await harness({ pool })
  const increments = []
  const off = h2.ctx.on('domain/changed', (c) => {
    if (c.domain === DOMAIN_NAME && c.table === 'usage' && c.operation === 'put') {
      increments.push({ key: c.key, value: c.value })
    }
  })
  await h2.scheduler.recordUsage({ sessionId: s1, section: 'acp.composer', injectedChars: 200, date: '2026-09-03' })
  await h2.scheduler.recordUsage({ sessionId: s1, section: 'wc.work_state', injectedChars: 40, date: '2026-09-03' })

  // 消费方重建：基线快照 + 事件增量
  const rebuilt = new Map()
  for (const row of baseline.usage) rebuilt.set([row.sessionId, row.date, row.section].join('::'), { ...row })
  for (const inc of increments) {
    // 事件 value 是完整新记录（put 语义）——直接落 map
    rebuilt.set(inc.key, { ...inc.value })
  }
  // 重建结果与 h2 终态一致
  const merged = [...rebuilt.values()].sort((a, b) => (a.sessionId + a.date + a.section).localeCompare(b.sessionId + b.date + b.section))
  const actual = h2.scheduler.getUsage().sort((a, b) => (a.sessionId + a.date + a.section).localeCompare(b.sessionId + b.date + b.section))
  assert.deepEqual(merged, actual, '快照+增量重建必须等于终态（domain/changed 可作完整数据源）')
  assert.equal(increments.length, 2)
  off()
  await h2.dispose()
})
