// src/types.d.ts — Context 扩展类型声明（仅编辑器/审阅用；运行时无类型）。
// 与 ACP 仓库同款模式：mjs 运行时 + 独立 .d.ts 提供补全。

import type { Context } from '@deepseek-ai/cordis'

export interface SectionRecord {
  key: string
  plugin: string
  order: number
  budgetChars: number
  refresh: 'frozen' | 'reload' | 'per-turn'
  updatedAt: number
}

export interface UsageRecord {
  sessionId: string
  date: string
  section: string
  injectedChars: number
  count: number
  updatedAt: number
}

export interface InjectSchedulerService {
  readonly ready: boolean
  readonly domainName: string
  registerSection(input: Omit<SectionRecord, 'updatedAt'>): Promise<{ ok: true; key: string } | { ok: false; error: string }>
  unregisterSection(key: string): Promise<boolean>
  recordUsage(input: { sessionId?: string; section: string; injectedChars: number; date?: string })
    : Promise<{ ok: true; key: string; total: number; count: number } | { ok: false; error: string }>
  listSections(): SectionRecord[]
  getUsage(filter?: { sessionId?: string; date?: string; section?: string }): UsageRecord[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    injectScheduler: InjectSchedulerService
  }
}
