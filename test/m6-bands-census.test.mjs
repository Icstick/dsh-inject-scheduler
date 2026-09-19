// test/m6-bands-census.test.mjs — 2026-09-09 同行调研改善：order 分带/rank、usage 置信度、census 对账
import test from 'node:test'
import assert from 'node:assert/strict'
import { harness } from './helpers/harness.mjs'
import { bandOf, USAGE_CONFIDENCES } from '../src/domain.mjs'
import { CENSUS_CACHE_LIMIT } from '../src/service.mjs'

const sid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

test('bandOf：身份 / persona / 上下文 / 工具 / 尾部分带', () => {
  assert.equal(bandOf(-100), 'identity')
  assert.equal(bandOf(-1), 'identity')
  assert.equal(bandOf(0), 'persona')
  assert.equal(bandOf(10), 'context')
  assert.equal(bandOf(20), 'context')
  assert.equal(bandOf(99), 'context')
  assert.equal(bandOf(100), 'tools')
  assert.equal(bandOf(199), 'tools')
  assert.equal(bandOf(200), 'tail')
  assert.equal(bandOf(Number.NaN), 'context')
})

test('listSections：排序键 (order, rank, key) 确定性', async () => {
  const h = await harness()
  try {
    await h.scheduler.registerSection({ key: 'zzz.tail', plugin: 'p3', order: 10, rank: 5, budgetChars: 0, refresh: 'per-turn' })
    await h.scheduler.registerSection({ key: 'aaa.first', plugin: 'p1', order: 10, rank: 1, budgetChars: 0, refresh: 'per-turn' })
    await h.scheduler.registerSection({ key: 'mmm.mid', plugin: 'p2', order: 5, budgetChars: 0, refresh: 'per-turn' })
    assert.deepEqual(h.scheduler.listSections().map((s) => s.key), ['mmm.mid', 'aaa.first', 'zzz.tail'])
    // rank 缺省 0
    assert.equal(h.scheduler.listSections()[0].rank, 0)
  } finally {
    await h.dispose()
  }
})

test('recordUsage：置信度缺省 reported，显式 unknown 保留，累加取最弱', async () => {
  const h = await harness()
  try {
    await h.scheduler.registerSection({ key: 'acp.composer', plugin: 'dsh-adaptive-context', order: 10, budgetChars: 1000, refresh: 'per-turn' })
    await h.scheduler.recordUsage({ sessionId: sid, section: 'acp.composer', injectedChars: 100 })
    let rows = h.scheduler.getUsage({ sessionId: sid })
    assert.equal(rows[0].confidence, 'reported')
    await h.scheduler.recordUsage({ sessionId: sid, section: 'acp.composer', injectedChars: 50, confidence: 'unknown' })
    rows = h.scheduler.getUsage({ sessionId: sid })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].confidence, 'unknown', '一旦有 unknown 混入就不再声称实测')
    assert.equal(rows[0].injectedChars, 150)
    assert.ok(USAGE_CONFIDENCES.includes('estimated'))
  } finally {
    await h.dispose()
  }
})

test('getSessionReport：带 band / rank / confidence', async () => {
  const h = await harness()
  try {
    await h.scheduler.registerSection({ key: 'acp.composer', plugin: 'dsh-adaptive-context', order: 10, budgetChars: 1600, unit: 'tokens', refresh: 'per-turn' })
    await h.scheduler.registerSection({ key: 'wc.work_state', plugin: 'dsh-work-continuity', order: 20, budgetChars: 0, refresh: 'per-turn' })
    await h.scheduler.recordUsage({ sessionId: sid, section: 'acp.composer', injectedChars: 900 })
    await h.scheduler.recordUsage({ sessionId: sid, section: 'wc.work_state', injectedChars: 120, confidence: 'estimated' })
    const rep = h.scheduler.getSessionReport({ sessionId: sid })
    const acp = rep.sections.find((r) => r.section === 'acp.composer')
    const wc = rep.sections.find((r) => r.section === 'wc.work_state')
    assert.equal(acp.band, 'context')
    assert.equal(wc.band, 'context')
    assert.equal(acp.rank, 0)
    assert.equal(acp.confidence, 'reported')
    assert.equal(wc.confidence, 'estimated')
    assert.equal(rep.census, null, '未观测 → census 为 null，不伪造')
  } finally {
    await h.dispose()
  }
})

test('census：缓存有界——超上界按插入序淘汰最旧会话（对齐 RecallThrottle/ClockThrottle）', async () => {
  const h = await harness()
  try {
    const total = CENSUS_CACHE_LIMIT + 5
    for (let i = 0; i < total; i++) {
      h.scheduler.recordCensus({ sessionId: 'sess-' + String(i).padStart(5, '0'), observed: ['some-plugin'] })
    }
    assert.equal(h.scheduler.getCensus('sess-00000'), null, '最旧的 5 个会话应被淘汰（旧实现无上界、永远留着）')
    assert.equal(h.scheduler.getCensus('sess-00004'), null, '最旧的 5 个会话应被淘汰')
    assert.equal(h.scheduler.getCensus('sess-00005')?.sessionId, 'sess-00005', '第 2001 个之后仍在界内')
    assert.equal(h.scheduler.getCensus('sess-' + String(total - 1).padStart(5, '0'))?.sessionId, 'sess-' + String(total - 1).padStart(5, '0'), '最新一条必须保留')
    // 全局读（不带 sessionId）= 最近一次观测，不受淘汰影响
    assert.equal(h.scheduler.getCensus()?.sessionId, 'sess-' + String(total - 1).padStart(5, '0'))
  } finally {
    await h.dispose()
  }
})

test('census：实际注入面 vs 注册表差集（未注册的注入方可见）', async () => {
  const h = await harness()
  try {
    await h.scheduler.registerSection({ key: 'acp.composer', plugin: 'dsh-adaptive-context', order: 10, budgetChars: 0, refresh: 'per-turn' })
    await h.scheduler.registerSection({ key: 'wc.work_state', plugin: 'dsh-work-continuity', order: 20, budgetChars: 0, refresh: 'per-turn' })
    const c = h.scheduler.recordCensus({ sessionId: sid, observed: ['dsh-adaptive-context', 'some-invisible-plugin'] })
    assert.deepEqual(c.observed, ['dsh-adaptive-context', 'some-invisible-plugin'])
    assert.deepEqual(c.unregistered, ['some-invisible-plugin'], '未注册注入方必须被点名')
    assert.deepEqual(c.silent, ['dsh-work-continuity'], '已注册未注入单独列出（节流 vs 故障要分开）')
    assert.equal(h.scheduler.getCensus(sid).sessionId, sid)
    const rep = h.scheduler.getSessionReport({ sessionId: sid })
    assert.deepEqual(rep.census.unregistered, ['some-invisible-plugin'])
  } finally {
    await h.dispose()
  }
})
