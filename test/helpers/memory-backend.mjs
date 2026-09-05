// test/helpers/memory-backend.mjs — 内存 StorageBackend 测试替身（移植官方
// packages/storage/storage-domain/tests/helpers/memory-backend.ts，161 行版）。
// 官方 helper 位于 tests/ 不在发布面（storage-domain exports 不含 tests），
// 第三方插件无法 import —— 按 MIT 许可移植为 mjs。语义与官方一致：
//   版本戳记/version-mismatch、closed、写原子性、close 幂等；
//   pool.media 跨实例共享模拟进程重启；pool.versions 可预戳制造版本失配。

import { StorageError } from '@deepseek-ai/dsh-storage'

export class MemoryMediaPool {
  constructor() {
    this.media = new Map()        // unit name → { tables: Map, global }
    this.versions = new Map()     // unit name → stamped version
    this.failNextWrites = 0       // >0: 接下来 N 次写原语拒绝（负路径测试）
  }
  consumeInjectedFailure() {
    if (this.failNextWrites > 0) {
      this.failNextWrites -= 1
      throw new Error('injected write failure')
    }
  }
}

class MemoryKvUnit {
  constructor(pool, medium, descriptor, onClose) {
    this.pool = pool
    this.medium = medium
    this.descriptor = descriptor
    this.onClose = onClose
    this.closed = false
  }
  assertOpen() {
    if (this.closed) throw new StorageError('closed', 'memory unit ' + this.descriptor.name + ' is closed')
  }
  async loadAll() {
    this.assertOpen()
    const tables = {}
    for (const table of this.descriptor.tables) {
      tables[table] = Object.fromEntries(this.medium.tables.get(table) ?? [])
    }
    return { tables, global: this.medium.global }
  }
  async putRecord(table, key, value) {
    this.assertOpen()
    this.pool.consumeInjectedFailure()
    let records = this.medium.tables.get(table)
    if (records === undefined) { records = new Map(); this.medium.tables.set(table, records) }
    records.set(key, value)
  }
  async deleteRecord(table, key) {
    this.assertOpen()
    this.pool.consumeInjectedFailure()
    this.medium.tables.get(table)?.delete(key)
  }
  async setGlobal(value) {
    this.assertOpen()
    this.pool.consumeInjectedFailure()
    this.medium.global = value
  }
  async close() {
    if (this.closed) return
    this.closed = true
    this.onClose()
  }
}

export class MemoryStorageBackend {
  constructor(pool = new MemoryMediaPool()) {
    this.pool = pool
    this.openUnits = new Set()
    this.closed = false
    this.kv = {
      open: async (descriptor) => {
        if (this.closed) throw new StorageError('closed', 'memory backend is closed')
        if (this.openUnits.has(descriptor.name)) {
          throw new Error('memory unit ' + descriptor.name + ' is already open (double-open is a caller bug)')
        }
        const stamped = this.pool.versions.get(descriptor.name)
        if (stamped === undefined) {
          this.pool.versions.set(descriptor.name, descriptor.version)
        } else if (stamped !== descriptor.version) {
          throw new StorageError('version-mismatch',
            'memory unit ' + descriptor.name + ' is stamped v' + stamped + ', descriptor wants v' + descriptor.version)
        }
        let medium = this.pool.media.get(descriptor.name)
        if (medium === undefined) {
          medium = { tables: new Map(), global: null }
          this.pool.media.set(descriptor.name, medium)
        }
        this.openUnits.add(descriptor.name)
        return new MemoryKvUnit(this.pool, medium, descriptor, () => this.openUnits.delete(descriptor.name))
      },
    }
  }
  async close() {
    this.closed = true
    this.openUnits.clear()
  }
}
