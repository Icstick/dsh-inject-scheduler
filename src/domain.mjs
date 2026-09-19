// src/domain.mjs — inject_scheduler domain 声明（官方 storageDomain 承载）。
//
// M1+M2（P7 开工包）：段注册表 + 用量账（M2 增 unit 预算口径）。spec 即单一事实源：
// 类型面与运行时校验都从 defineDomain 推导；open 时对存量做 zod 校验。
//
// 权威分层提醒（为什么 invalidRecords 用 backup-and-skip）：
//   usage/sections 是派生态——注册表可由插件 M2 起随时重报、记账丢一笔无害。
//   权威数据在 ACP ledger（append-only SQLite），不在本 domain。
//   坏记录绝不拦启动，代价只是该记录被移到 <key>.bak 并视同缺失。

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** 注入段刷新语义（开工包字段面；M1 仅存储，M3 排序阶段消费） */
const REFRESH_MODES = ['frozen', 'reload', 'per-turn']

/** 段预算单位（M2 定）：usage.injectedChars 恒为字符数；unit 只标注 budgetChars 的计值口径 */
const BUDGET_UNITS = ['chars', 'tokens']

/** usage 归因置信度（2026-09-09，对齐 dsh-agent-budget 的 accuracy 三态）：
 *  reported = 注入方自报的实测值；estimated = 经换算/估算得到；unknown = 缺失或写入失败。
 *  纪律：自报值不得伪装成量测值；缺失记 unknown，绝不静默记 0。 */
export const USAGE_CONFIDENCES = ['reported', 'estimated', 'unknown']

/**
 * order 分带（2026-09-09）：把「谁该排前面」从巧合变成契约。
 * 与生态既有约定对齐（dsh-prompt-studio / dsh-inject-system-prompt 的 -100 身份 / 0 persona / 100-199 工具），
 * 中间 1..99 留给上下文与记忆段（acp.composer=10 / wc.work_state=20 落此带）。
 * @param {number} order
 * @returns {'identity'|'persona'|'context'|'tools'|'tail'}
 */
export function bandOf(order) {
  const n = Number(order)
  if (!Number.isFinite(n)) return 'context'
  if (n < 0) return 'identity'
  if (n === 0) return 'persona'
  if (n < 100) return 'context'
  if (n < 200) return 'tools'
  return 'tail'
}

/** 段 key 命名：插件命名空间小写点分（如 acp.composer / wc.work_state） */
const SECTION_KEY_RE = /^[a-z][a-z0-9_.-]{0,63}$/

/** usage 表 key 分隔符（sessionId=uuid、date=YYYY-MM-DD、section 均不含此串） */
export const USAGE_KEY_SEP = '::'

/** 无 session 维度时记入的会话槽 */
export const GLOBAL_SESSION = 'global'

/** usage 表 date 槽格式（YYYY-MM-DD，本地日） */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** sessionId 字段规则：非空、≤64、不含 key 分隔符（record 与 input 共用） */
const sessionIdField = z
  .string().min(1).max(64)
  .refine((s) => !s.includes(USAGE_KEY_SEP), 'sessionId must not contain key separator')

/** date 字段规则（record 与 input 共用） */
const dateField = z.string().regex(DATE_RE)

/**
 * 一条段注册记录。order：越小越靠前（M2 意图序：acp.composer=10 / wc.work_state=20，
 * M3 排序/冲突检测消费）。budgetChars：0 = 未设上限（如 WC 无预算概念）。
 * unit：budgetChars 的计值口径（ACP 配额为 token；usage 记账恒为 chars）。
 */
export const sectionRecordSchema = z.object({
  key: z.string().regex(SECTION_KEY_RE),
  plugin: z.string().min(1).max(128),
  order: z.number().int(),
  /** 同 order 内的确定性裁决位（小者靠前；缺省 0）——排序键 = (order, rank, key) */
  rank: z.number().int().default(0),
  budgetChars: z.number().int().nonnegative(),
  unit: z.enum(BUDGET_UNITS).default('chars'),
  refresh: z.enum(REFRESH_MODES),
  updatedAt: z.number().int().nonnegative(),
})

/** 一条用量账记录。KvTable 无 append：key=<sessionId|global>::<date>::<section>，先 put 首笔再 update 累加。 */
export const usageRecordSchema = z.object({
  sessionId: sessionIdField,
  date: dateField,
  section: z.string().regex(SECTION_KEY_RE),
  injectedChars: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
  /** 归因置信度：多条累加时取最弱（unknown > estimated > reported 的降级方向） */
  confidence: z.enum(USAGE_CONFIDENCES).default('reported'),
  updatedAt: z.number().int().nonnegative(),
})

/** 写侧输入 schema（updatedAt/count 由 service 填充；zod 只在 open 校验存量，put 不校验） */
export const registerInputSchema = sectionRecordSchema.omit({ updatedAt: true })
/**
 * recordUsage 输入：sessionId/date 缺省语义 = service 落 GLOBAL_SESSION 槽/本地日，
 * 因此这两字段 optional（不能从 usageRecordSchema omit——omit 保留 required）。
 */
export const usageInputSchema = z.object({
  sessionId: sessionIdField.optional(),
  date: dateField.optional(),
  section: z.string().regex(SECTION_KEY_RE),
  injectedChars: z.number().int().nonnegative(),
  confidence: z.enum(USAGE_CONFIDENCES).default('reported'),
})

/** inject_scheduler domain v1 */
export const injectSchedulerDomainSpec = defineDomain({
  name: 'inject_scheduler',
  version: 1,
  invalidRecords: 'backup-and-skip',
  tables: {
    sections: domainTable(sectionRecordSchema),
    usage: domainTable(usageRecordSchema),
  },
})

/** domain 名常量（事件过滤、测试断言共用） */
export const DOMAIN_NAME = injectSchedulerDomainSpec.name

/** 本地日期 YYYY-MM-DD（usage key 的 date 槽；本地日与"一天"语义一致） */
export function localDateOf(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return y + '-' + m + '-' + d
}
