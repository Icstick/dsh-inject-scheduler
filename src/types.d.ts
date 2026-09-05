// src/types.d.ts — Context 扩展类型声明（仅编辑器/审阅用；运行时无类型）。
// 与 ACP 仓库同款模式：mjs 运行时 + 独立 .d.ts 提供补全。

import type { Context } from '@deepseek-ai/cordis'

export interface SectionRecord {
  key: string
  plugin: string
  order: number
  /** 0 = 未设上限 */
  budgetChars: number
  /** budgetChars 计值口径；usage 记账恒为字符数 */
  unit: 'chars' | 'tokens'
  refresh: 'frozen' | 'reload' | 'per-turn'
  updatedAt: number
}

/** 输入非法/策略拒绝时的统一错误面 */
export interface ServiceError {
  ok: false
  error: string
  /** conflictPolicy=reject 时：冲突方段 key 列表 */
  conflictWith?: string[]
  /** conflictPolicy=reject 时：完整冲突描述 */
  message?: string
}

export interface UsageRecord {
  sessionId: string
  date: string
  section: string
  injectedChars: number
  count: number
  updatedAt: number
}

export interface SessionSectionReport {
  section: string
  plugin: string
  order: number
  unit: 'chars' | 'tokens'
  budgetChars: number
  injectedChars: number
  count: number
  /** unit=tokens 段的字符→token 估算；unit=chars 段为 null */
  estimatedTokens: number | null
  /** 预算占用率（>1 = 超预算）；budgetChars=0（未设上限）为 null */
  usageRatio: number | null
}

export interface SessionReport {
  sessionId: string
  date: string
  charPerToken: number
  sections: SessionSectionReport[]
  totals: { injectedChars: number; estimatedTokens: number; sections: number }
}

export interface InjectSchedulerService {
  readonly domainName: string
  registerSection(input: Omit<SectionRecord, 'updatedAt'>): Promise<{ ok: true; key: string } | ServiceError>
  unregisterSection(key: string): Promise<boolean>
  recordUsage(input: { sessionId?: string; section: string; injectedChars: number; date?: string })
    : Promise<{ ok: true; key: string; total: number; count: number } | ServiceError>
  listSections(): SectionRecord[]
  getUsage(filter?: { sessionId?: string; date?: string; section?: string }): UsageRecord[]
  usageSeries(filter?: { sessionId?: string; date?: string; section?: string; dateFrom?: string; dateTo?: string }): UsageRecord[]
  exportState(): {
    format: 'dsh-inject-scheduler-state'
    version: 1
    exportedAt: string
    sections: SectionRecord[]
    usage: UsageRecord[]
  }
  getSessionReport(filter?: { sessionId?: string; date?: string }): SessionReport
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    injectScheduler: InjectSchedulerService
  }
}
