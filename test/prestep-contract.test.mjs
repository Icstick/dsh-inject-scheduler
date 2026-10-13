// test/prestep-contract.test.mjs — agent/pre-step 交付契约护栏（P1 · 2026-10-02）
//
// 钉住什么：本插件在 agent/pre-step 上挂了唯一的 listener（src/index.mjs:40-62）。上游语义
// （D:/deepseek-harness/vendor/cordis/src/events.ts:225-243）：
//   · 每条 listener 拿到 (payload, next)；**不调 next() 就是否决**；
//   · 整条链的返回值 = 最外层 listener 的返回值 —— 旁观者一旦返回 undefined，调用方拿到的
//     就是非法决策（既不是 {kind:'enter',messages} 也不是 {kind:'reject'}）。
//
// 与另两仓不同的地方：本仓 test/helpers/harness.mjs 已经能起**真 cordis Context + 真 storage 域**
// （M1 起就用它），所以这里不另造 stub ctx —— 直接照抄仓内既有写法起真栈，经
// ctx.waterfall('agent/pre-step', payload, next) 走真实注册与真实派发，把
// 「注册 → 派发 → 返回值 → census 副作用」整条链一起钉住。
//
// 护栏三条：① 返回值恒等于 next() 的返回值（原样透传，不改写、不吞）；② 每次调用都调过 next()；
// ③ census 段任何异常只降级日志、不抛（fail-open；本仓 P0-1 注释「零侵入」）。
//
// 观察面的 source 形状归一（2026-10-02 修）：本插件同时认两种注入方形状——
//   · { kind: 'plugin', plugin: '<name>' }（权威形状：上游文档/类型 + 本机 dsh-time-ink）
//   · { kind: 'plugin:<name>' }（本机 ACP/KR/WC/maid 四家的实际形状，无 plugin 字段）
// 旧判据只认前者 → 四家永远进不了 observed，census 差集空转（P0-1 机制白装）。
// 文件末尾四条用例按新契约钉住：两种形状都进 observed / 未注册仍被点名 / 非插件来源不误算。
//
// 跑法：node --test test/*.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { harness } from './helpers/harness.mjs'

const realUser = (text = 'hi') => ({ role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } })
const pluginMsg = (plugin, kind = 'plugin') => ({ role: 'user', content: [{ type: 'text', text: '[' + plugin + '] 注入' }], source: { kind, plugin } })
/** 四家偏离方的实际形状：{ kind: 'plugin:<name>' }，**没有 plugin 字段** */
const prefixedPluginMsg = (plugin) => ({ role: 'user', content: [{ type: 'text', text: '[' + plugin + '] 注入' }], source: { kind: 'plugin:' + plugin } })
const payload = (sessionId) => ({ step: 1, agent: { session: { id: sessionId } } })

function isLegalDecision(v) {
  if (v === null || typeof v !== 'object') return false
  if (v.kind === 'reject') return true
  return v.kind === 'enter' && Array.isArray(v.messages)
}

/** 经真实 waterfall 派发一次；顺带断言 next 恰好被调一次、返回值是合法决策（或原样透传）。 */
async function dispatch(ctx, pl, decision) {
  let nextCalls = 0
  const result = await ctx.waterfall('agent/pre-step', pl, async () => { nextCalls += 1; return decision })
  assert.equal(nextCalls, 1, '每次调用必须调过 next()（旁观者不得否决下游）')
  // 严格：next() 已给出合法决策时，返回值必须还是合法决策。
  // 这里**不能**放行 undefined —— 漏写 return next() 与「下游本来就返回 undefined」
  // 在返回值上长得一样，一旦放行，最危险的那条坏法（漏 return）就被护栏自己放过。
  // 「下游返回 undefined / 抛错」两种边界另有专门用例，不走本助手。
  assert.ok(isLegalDecision(result), '返回值必须是合法 PreStepDecision；实收=' + JSON.stringify(result))
  return result
}

// ---- 用例 ----

test('enter + 插件注入消息：原样返回同一决策，并把观察面写进 census', async (t) => {
  const h = await harness()
  t.after(() => h.dispose())
  const sid = 'guard-enter-1'
  const decision = { kind: 'enter', messages: [pluginMsg('dsh-adaptive-context'), pluginMsg('dsh-time-ink'), realUser()] }
  const result = await dispatch(h.ctx, payload(sid), decision)
  assert.equal(result, decision, '必须原样返回同一对象（零侵入）')
  assert.ok(isLegalDecision(result), '返回值必须是合法 PreStepDecision')
  assert.equal(result.messages.length, 3, '不得改动 messages')

  const census = h.scheduler.getCensus(sid)
  assert.ok(census, 'census 应已记录本次观察')
  assert.deepEqual(census.observed, ['dsh-adaptive-context', 'dsh-time-ink'])
  assert.deepEqual(census.registered, [])
  assert.deepEqual(census.unregistered, ['dsh-adaptive-context', 'dsh-time-ink'], '无注册段 → 全部算未注册注入方')
})

test('enter + 无插件注入消息：原样返回，不写 census', async (t) => {
  const h = await harness()
  t.after(() => h.dispose())
  const sid = 'guard-enter-2'
  const decision = { kind: 'enter', messages: [realUser()] }
  const result = await dispatch(h.ctx, payload(sid), decision)
  assert.equal(result, decision)
  assert.equal(h.scheduler.getCensus(sid), null, 'observed 为空 → 不记账')
})

test('决策非 enter（reject）：原样透传', async (t) => {
  const h = await harness()
  t.after(() => h.dispose())
  const decision = { kind: 'reject', reason: 'test' }
  const result = await dispatch(h.ctx, payload('guard-reject'), decision)
  assert.equal(result, decision)
  assert.ok(isLegalDecision(result))
})

test('下游返回 undefined：原样透传（链已断，本插件不制造也不掩盖）', async (t) => {
  const h = await harness()
  t.after(() => h.dispose())
  // 不走 dispatch：那条助手的判据是「next 给了合法决策 → 返回也得合法」，
  // 这条是另一回事——下游自己就断了链，本插件只做透传。
  let nextCalls = 0
  const result = await h.ctx.waterfall('agent/pre-step', payload('guard-undefined'), async () => { nextCalls += 1; return undefined })
  assert.equal(nextCalls, 1, '仍然调过 next()')
  assert.equal(result, undefined, '透传下游的返回值')
})

test('下游抛错：向上传播，不吞', async (t) => {
  const h = await harness()
  t.after(() => h.dispose())
  await assert.rejects(
    () => h.ctx.waterfall('agent/pre-step', payload('guard-throw'), async () => { throw new Error('downstream boom') }),
    /downstream boom/,
    'next() 在 try 之外 —— 下游故障照常传播，不被 census 的降级日志吞掉',
  )
})

test('census 段抛错：不抛、原样返回决策（fail-open）', async (t) => {
  const h = await harness()
  t.after(() => h.dispose())
  const decision = { kind: 'enter', messages: [pluginMsg('dsh-adaptive-context')] }
  // 取 sessionId 时抛（src/index.mjs:50 在 try 内）——触发 catch 分支
  const evil = { step: 1, get agent() { throw new Error('census boom') } }
  const result = await dispatch(h.ctx, evil, decision)
  assert.equal(result, decision, '观测故障只降级，不阻断回合')
  assert.ok(isLegalDecision(result))
})

// ---- 观察面形状归一（2026-10-02 修）----
//
// 权威形状 = { kind: 'plugin', plugin: '<name>' }（上游 docs/cookbook/adding-a-tool.md、
// packages/core/agent/README.md 一致）；本机四家注入方发的却是 { kind: 'plugin:<name>' }
// （无 plugin 字段）。判据只认前者时这四家永远进不了 observed，差集恒缺四家、unregistered
// 恒挂 ACP —— P0-1 census 空转。修法在消费侧：plugin 字段优先，否则取 'plugin:' 后缀
// （src/index.mjs pluginNameOf）。以下四条 = 归一后的契约。

test('形状归一 a：{ kind: "plugin", plugin } → 进 observed', async (t) => {
  const h = await harness()
  t.after(() => h.dispose())
  const sid = 'shape-plugin-field'
  const decision = { kind: 'enter', messages: [pluginMsg('dsh-time-ink'), pluginMsg('dsh-work-continuity'), realUser()] }
  const result = await dispatch(h.ctx, payload(sid), decision)
  assert.equal(result, decision, '观测不改决策：原样返回')
  const census = h.scheduler.getCensus(sid)
  assert.ok(census, '权威形状必须进观察面')
  assert.deepEqual(census.observed, ['dsh-time-ink', 'dsh-work-continuity'], 'plugin 字段即注入方名')
  assert.deepEqual(census.registered, [])
  assert.deepEqual(census.unregistered, ['dsh-time-ink', 'dsh-work-continuity'], '未注册 → 差集点名')
})

test('形状归一 b（本次修复核心）：{ kind: "plugin:<name>" } → 进 observed', async (t) => {
  const h = await harness()
  t.after(() => h.dispose())
  const sid = 'shape-kind-prefix'
  // ACP 的真实形状（dsh-adaptive-context/src/index.mjs:758，含额外 form 字段）
  const decision = {
    kind: 'enter',
    messages: [
      { role: 'user', content: [{ type: 'text', text: '[acp] 召回' }], source: { kind: 'plugin:dsh-adaptive-context', form: 'recall' } },
      realUser(),
    ],
  }
  const result = await dispatch(h.ctx, payload(sid), decision)
  assert.equal(result, decision)
  const census = h.scheduler.getCensus(sid)
  assert.ok(census, 'plugin:<name> 形态必须被观察面看见（旧判据下这里恒为 null）')
  assert.deepEqual(census.observed, ['dsh-adaptive-context'], '取 "plugin:" 之后的后缀作注入方名')
  assert.deepEqual(census.unregistered, ['dsh-adaptive-context'], '并进差集')
})

test('形状归一 c：两种形状混发时，未注册的注入方仍被点名（差集正常）', async (t) => {
  const h = await harness()
  t.after(() => h.dispose())
  const sid = 'shape-diff-set'
  await h.scheduler.registerSection({ key: 'acp.composer', plugin: 'dsh-adaptive-context', order: 10, budgetChars: 1600, unit: 'tokens', refresh: 'per-turn' })
  await h.scheduler.registerSection({ key: 'wc.work_state', plugin: 'dsh-work-continuity', order: 20, budgetChars: 0, refresh: 'per-turn' })
  const decision = {
    kind: 'enter',
    messages: [
      prefixedPluginMsg('dsh-adaptive-context'), // = index.mjs:758 的形状
      prefixedPluginMsg('dsh-work-continuity'),  // = index.mjs:459 的形状
      pluginMsg('some-invisible-plugin'),
      realUser(),
    ],
  }
  const result = await dispatch(h.ctx, payload(sid), decision)
  assert.equal(result, decision)
  const census = h.scheduler.getCensus(sid)
  assert.deepEqual(census.observed, ['dsh-adaptive-context', 'dsh-work-continuity', 'some-invisible-plugin'], '两种形状都在观察面里')
  assert.deepEqual(census.registered, ['dsh-adaptive-context', 'dsh-work-continuity'])
  assert.deepEqual(census.unregistered, ['some-invisible-plugin'], '只点名真正没注册的那一个（旧行为下这四家全缺 → 差集空转）')
  assert.deepEqual(census.silent, [], '在册且本轮都注入了 → silent 为空')
  assert.deepEqual(h.scheduler.getSessionReport({ sessionId: sid }).census.unregistered, ['some-invisible-plugin'], 'B10 消费面读到同一份差集')
})

test('形状归一 d：不含插件来源标记的消息不被误算', async (t) => {
  const h = await harness()
  t.after(() => h.dispose())
  const sid = 'shape-non-plugin'
  const decision = {
    kind: 'enter',
    messages: [
      realUser('hi'),                                                                                     // { kind: 'user' }
      { role: 'user', content: [{ type: 'text', text: '[rt]' }], source: { kind: 'runtime-context' } },    // 运行时上下文
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }], source: { kind: 'model' } },
      { role: 'user', content: [{ type: 'tool-result' }], source: { kind: 'tool', callId: 'c1' } },
      { role: 'user', content: [{ type: 'text', text: '[loader]' }], source: { kind: 'plugin-loader', plugin: 'almost' } }, // 前缀近似但不是 plugin 族
      { role: 'user', content: [{ type: 'text', text: '[空名]' }], source: { kind: 'plugin', plugin: '' } },
      { role: 'user', content: [{ type: 'text', text: '[空后缀]' }], source: { kind: 'plugin:' } },
      { role: 'user', content: [{ type: 'text', text: '[无 source]' }] },
    ],
  }
  const result = await dispatch(h.ctx, payload(sid), decision)
  assert.equal(result, decision, '原样返回')
  assert.equal(h.scheduler.getCensus(sid), null, '一条都不算注入方：observed 为空 → 不写 census')
})
