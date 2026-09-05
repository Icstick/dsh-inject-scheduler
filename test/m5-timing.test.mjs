// test/m5-timing.test.mjs — M5 装配时序复现（2026-09-05 正式实例验证发现）：
// 真实 host 中消费者（WC 等）先于 scheduler 装载完成 apply，scheduler 晚装载才 provide；
// 等待路径订阅 internal/service——notify 在 provide 时刻发出（提供方 fiber 尚在 STARTING），
// 订阅回调若用 strict ctx.get 拿到 undefined 且事件只发一次 → 永久错过注册。
// 本测试固化时序语义：strict=false 读取（服务已在 store 即返回）是等待路径的正确姿势。

import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as storageDomainModule from '@deepseek-ai/dsh-storage-domain'
import * as injectSchedulerModule from '../src/index.mjs'
import { MemoryMediaPool } from './helpers/memory-backend.mjs'
import { makeMemoryBackendPlugin } from './helpers/harness.mjs'

/** 模拟真实 host 时序：早鸟消费者先 apply（scheduler 未装载）→ scheduler 晚装载 */
async function timingHarness({ nonStrictGet = false } = {}) {
  const pool = new MemoryMediaPool()
  const ctx = new Context()
  const registerCalls = []
  const fibers = []
  await ctx.plugin(Storage)
  fibers.push(await ctx.plugin(makeMemoryBackendPlugin(pool)))
  fibers.push(await ctx.plugin(storageDomainModule, { backend: 'memory', routes: {} }))

  const earlyBird = {
    name: 'early-bird-consumer',
    apply(bctx) {
      const probe = () => (nonStrictGet ? bctx.get('injectScheduler', false) : bctx.get('injectScheduler'))
      const sched = probe()
      if (sched) { registerCalls.push('direct'); return }
      const off = bctx.on('internal/service', (name) => {
        if (name !== 'injectScheduler') return
        const service = probe()
        if (service !== undefined && service !== null) {
          off()
          registerCalls.push('event')
        }
      })
    },
  }
  fibers.push(await ctx.plugin(earlyBird))
  registerCalls.length = 0 // 清掉 apply 期直连记录（模拟 apply 完成于 scheduler 装载前）
  fibers.push(await ctx.plugin(injectSchedulerModule, {}))
  return {
    ctx, pool, fibers, registerCalls,
    scheduler: ctx.get('injectScheduler', false),
    async dispose() { for (const f of [...fibers].reverse()) { try { await f.dispose() } catch {} } },
  }
}

test('时序语义：早鸟 strict get → 仍能经事件注册（cordis notify 两次：provide + fiber ACTIVE）', async () => {
  const h = await timingHarness({ nonStrictGet: false })
  try {
    await new Promise((r) => setTimeout(r, 30))
    // cordis _updateState 在 fiber 转 ACTIVE 时对 store 里该 fiber 的 impl 再次 notify——
    // strict get 的订阅者在第二次 notify 时（fiber 已 ACTIVE）能拿到服务。
    assert.equal(h.registerCalls.length, 1, 'strict 语义经第二次 notify（ACTIVE）注册成功')
    assert.equal(h.registerCalls[0], 'event')
  } finally {
    await h.dispose()
  }
})

test('时序修复：早鸟 non-strict get → scheduler 晚装载后经事件注册成功', async () => {
  const h = await timingHarness({ nonStrictGet: true })
  try {
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(h.registerCalls.length, 1, 'non-strict 语义下早鸟应经事件完成注册')
    assert.equal(h.registerCalls[0], 'event', '走事件等待路径')
  } finally {
    await h.dispose()
  }
})

test('时序对照：晚消费者（apply 在 scheduler 之后）direct 路径成功', async () => {
  // 手动构造：scheduler 先装，consumer 后装（晚消费者 apply 时直连成功）
  const pool = new MemoryMediaPool()
  const ctx = new Context()
  const calls = []
  const fibers = []
  await ctx.plugin(Storage)
  fibers.push(await ctx.plugin(makeMemoryBackendPlugin(pool)))
  fibers.push(await ctx.plugin(storageDomainModule, { backend: 'memory', routes: {} }))
  fibers.push(await ctx.plugin(injectSchedulerModule, {}))
  const consumer = {
    name: 'late-consumer',
    apply(bctx) {
      const sched = bctx.get('injectScheduler')
      if (sched) calls.push('direct:' + sched.domainName)
    },
  }
  fibers.push(await ctx.plugin(consumer))
  assert.deepEqual(calls, ['direct:inject_scheduler'], '晚消费者 apply 时直连成功')
  for (const f of [...fibers].reverse()) { try { await f.dispose() } catch {} }
})
