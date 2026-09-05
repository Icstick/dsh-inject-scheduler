// test/helpers/harness.mjs — M1 测试装配：真栈（非 mock 上层）。
// 链路与官方完全一致：Storage hub → backend 插件（本文件 makeMemoryBackendPlugin，
// 形态照抄官方 storage-json apply）→ storage-domain 插件 → 本插件。
//
// cordis 4 坑（2026-09-05 实证）：
// 1) ctx.plugin 必须收"模块形状"插件对象（{name, inject, Config, apply}）——
//    inject 从插件对象读取；直接传 apply 函数会丢掉 inject 声明 → 服务属性访问
//    抛 "cannot get ... without inject"。
// 2) ctx 无 stop()（cordis 3 API 已移除）；清理 = 对 ctx.plugin 返回的 fiber 逐个
//    dispose()。
// 3) storage-domain 的 storageDomain 服务是**延迟装载**：apply 只在名为
//    storage.backend.<backend> 的服务（storageBackendServiceKey）provide 后才
//    激活 child fiber 并 provide storageDomain。因此 backend 必须以插件形态
//    provide 该服务键——直接 ctx.storage.backend.register() 不够（storageDomain
//    永不激活，消费方 fiber 停在 state 0）。

import { Context } from '@deepseek-ai/cordis'
import Storage, { storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import * as storageDomainModule from '@deepseek-ai/dsh-storage-domain'
import * as injectSchedulerModule from '../../src/index.mjs'
import { MemoryMediaPool, MemoryStorageBackend } from './memory-backend.mjs'

/** backend 插件：官方 storage-json apply 的内存版（同款 register + provide 服务键） */
export function makeMemoryBackendPlugin(pool) {
  return {
    name: 'memory-backend',
    inject: ['storage'],
    apply(ctx) {
      const backend = new MemoryStorageBackend(pool)
      ctx.effect(() => {
        const unregister = ctx.storage.backend.register('memory', backend)
        return async () => {
          unregister()
          await backend.close()
        }
      })
      ctx.provide(storageBackendServiceKey('memory'), backend)
    },
  }
}

/**
 * 装配注入调度器最小栈。
 * @param {object} [opts]
 * @param {import('./memory-backend.mjs').MemoryMediaPool} [opts.pool] 共享介质池（模拟重启）
 * @param {object} [opts.pluginConfig] 本插件 Config
 */
export async function harness(opts = {}) {
  const { pool = new MemoryMediaPool(), pluginConfig = {} } = opts
  const ctx = new Context()
  const changes = []
  ctx.on('domain/changed', (c) => changes.push(c))
  const fibers = []
  fibers.push(await ctx.plugin(Storage))
  fibers.push(await ctx.plugin(makeMemoryBackendPlugin(pool)))
  fibers.push(await ctx.plugin(storageDomainModule, { backend: 'memory', routes: {} }))
  fibers.push(await ctx.plugin(injectSchedulerModule, pluginConfig))
  return {
    ctx,
    pool,
    changes,
    scheduler: ctx.injectScheduler,
    async dispose() {
      for (const f of [...fibers].reverse()) {
        try { await f.dispose() } catch { /* 已停 */ }
      }
    },
  }
}
