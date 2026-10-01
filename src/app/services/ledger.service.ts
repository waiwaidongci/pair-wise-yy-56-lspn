import { Injectable } from '@angular/core'
import { BehaviorSubject } from 'rxjs'
import type { AuditEvent, Defect, InspectionPlan, InspectionResultRecord, OccupancyRecord, Weld, WeldStatus } from '../types'
import { seedAudit, seedPlans, seedWelds } from '../mock-data'

/** 每个检测方法在单个时段（计划日期）内允许预占的焊缝数 */
export const METHOD_SLOT_CAPACITY = 4

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const now = () => new Date().toLocaleString('zh-CN', { hour12:false })
const seq = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36).padStart(2, '0')}`

/** 审核结论类动作：结果更新导致失效时保留原位并标记来源 */
const CONCLUSION_RE = /合格|审核|锁定|确认|批准/
export const isConclusion = (action: string) => CONCLUSION_RE.test(action)

const splitMethods = (method: string): string[] => method.split('+').map((m) => m.trim()).filter(Boolean)
const methodsOverlap = (a: string, b: string): boolean => splitMethods(a).some((m) => splitMethods(b).includes(m))

export interface LedgerState {
  welds: Weld[]
  plans: InspectionPlan[]
  results: InspectionResultRecord[]
  occupancy: OccupancyRecord[]
  audit: AuditEvent[]
  version: number
  locked: boolean
  selectedId: string
  statusFilter: string
}

export type WriteOutcome =
  | { ok: true; version: number; requestId: string; kind: 'plan'; plan: InspectionPlan; occupancy: OccupancyRecord[] }
  | { ok: true; version: number; requestId: string; kind: 'result'; result: InspectionResultRecord; plan: InspectionPlan; released: string[] }
  | { ok: true; version: number; requestId: string; kind: 'status'; weld: Weld }
  | { ok: true; version: number; requestId: string; kind: 'lock' }
  | { ok: false; version: number; requestId: string; reason: 'duplicate'; weldId: string; originalPlanId: string; originalPlanDate: string; method: string }
  | { ok: false; version: number; requestId: string; reason: 'capacity'; method: string; date: string; capacity: number; used: number }
  | { ok: false; version: number; requestId: string; reason: 'conflict'; currentVersion: number }
  | { ok: false; version: number; requestId: string; reason: 'mismatch' }
  | { ok: false; version: number; requestId: string; reason: 'not_found'; message: string }
  | { ok: false; version: number; requestId: string; reason: 'not_occupied'; weldId: string; planId: string; message: string }

interface CreatePlanCommand {
  requestId: string
  baseVersion: number
  date: string
  method: string
  weldIds: string[]
  inspector: string
}

interface RecordResultCommand {
  requestId: string
  baseVersion: number
  planId: string
  weldId: string
  inspectedLength: number
  defects: Array<Pick<Defect, 'position' | 'type' | 'length' | 'level' | 'method' | 'report'>>
}

interface StatusCommand {
  requestId: string
  baseVersion: number
  weldId: string
  status: WeldStatus
  actor: string
}

interface LockCommand {
  requestId: string
  baseVersion: number
  actor: string
}

interface RequestRecord {
  fingerprint: string
  outcome: WriteOutcome
}

@Injectable({ providedIn: 'root' })
export class LedgerService {
  private readonly state$ = new BehaviorSubject<LedgerState>(this.seed())
  readonly ledger$ = this.state$.asObservable()
  /** 已处理请求的请求号台账：同号重试直接返回原结果，绝不二次占位 */
  private readonly requestLog = new Map<string, RequestRecord>()
  private seqCounter = 0

  private seed(): LedgerState {
    const occupancy: OccupancyRecord[] = seedPlans.flatMap((plan) =>
      plan.weldIds.map((weldId) => ({
        id: seq('OC'),
        planId: plan.id,
        weldId,
        method: plan.method,
        date: plan.date,
        inspector: plan.inspector,
        status: '预占' as const,
        requestId: 'SEED',
      })),
    )
    return {
      welds: seedWelds.map((w) => ({ ...w, defects: w.defects.map((d) => ({ ...d })) })),
      plans: seedPlans.map((p) => ({ ...p, weldIds: [...p.weldIds] })),
      results: [],
      occupancy,
      audit: seedAudit.map((a) => ({ ...a })),
      version: 1,
      locked: false,
      selectedId: seedWelds[0]?.id ?? '',
      statusFilter: '全部',
    }
  }

  get snapshot(): LedgerState {
    return this.state$.value
  }

  newRequestId(): string {
    this.seqCounter += 1
    return `REQ-${Date.now().toString(36)}-${this.seqCounter.toString(36).padStart(2, '0')}`
  }

  /** 某方法在某日（时段）的容量占用情况 */
  slotUsage(method: string, date: string): { used: number; capacity: number } {
    const used = this.snapshot.occupancy.filter(
      (o) => o.status === '预占' && o.date === date && methodsOverlap(o.method, method),
    ).length
    return { used, capacity: METHOD_SLOT_CAPACITY }
  }

  /** 建计划：按检测方法 + 时段容量预占焊缝，重复占用指出原计划号 */
  async createPlan(cmd: CreatePlanCommand): Promise<WriteOutcome> {
    await delay(140)
    const fingerprint = JSON.stringify({ date: cmd.date, method: cmd.method, weldIds: [...cmd.weldIds].sort(), inspector: cmd.inspector })
    const cached = this.requestLog.get(cmd.requestId)
    if (cached) {
      if (cached.fingerprint === fingerprint) return cached.outcome
      return { ok:false, version:this.snapshot.version, requestId:cmd.requestId, reason:'mismatch' }
    }
    const s = this.snapshot
    if (cmd.baseVersion !== s.version) {
      return { ok:false, version:s.version, requestId:cmd.requestId, reason:'conflict', currentVersion:s.version }
    }
    const reject = (outcome: WriteOutcome): WriteOutcome => {
      this.requestLog.set(cmd.requestId, { fingerprint, outcome })
      return outcome
    }

    for (const weldId of cmd.weldIds) {
      if (!s.welds.some((w) => w.id === weldId)) {
        return reject({ ok:false, version:s.version, requestId:cmd.requestId, reason:'not_found', message:`焊缝 ${weldId} 不存在，无法预占` })
      }
    }

    // 重复占用校验：同一焊缝存在未完成计划的同方法预占账 → 指出原计划号
    for (const weldId of cmd.weldIds) {
      const clash = s.occupancy.find((o) => {
        if (o.weldId !== weldId || o.status !== '预占' || !methodsOverlap(o.method, cmd.method)) return false
        const plan = s.plans.find((p) => p.id === o.planId)
        return plan && plan.state !== '已完成' && plan.state !== '待重排'
      })
      if (clash) {
        const original = s.plans.find((p) => p.id === clash.planId)!
        return reject({
          ok:false, version:s.version, requestId:cmd.requestId, reason:'duplicate',
          weldId, originalPlanId:original.id, originalPlanDate:original.date, method:clash.method,
        })
      }
    }

    // 时段容量校验：检测方法 + 计划日期内预占不得超过容量
    for (const method of splitMethods(cmd.method)) {
      const { used, capacity } = this.slotUsage(method, cmd.date)
      if (used + cmd.weldIds.length > capacity) {
        return reject({ ok:false, version:s.version, requestId:cmd.requestId, reason:'capacity', method, date:cmd.date, capacity, used })
      }
    }

    const plan: InspectionPlan = {
      id: seq('IP'),
      date: cmd.date,
      method: cmd.method,
      weldIds: [...cmd.weldIds],
      inspector: cmd.inspector,
      state: '待执行',
    }
    const occupancy: OccupancyRecord[] = cmd.weldIds.map((weldId) => ({
      id: seq('OC'),
      planId: plan.id,
      weldId,
      method: cmd.method,
      date: cmd.date,
      inspector: cmd.inspector,
      status: '预占',
      requestId: cmd.requestId,
    }))
    const audit: AuditEvent = {
      id: seq('AE'), time: now(), actor: cmd.inspector, action: '计划预占', target: plan.id,
      detail:`按 ${cmd.method} 方法、${cmd.date} 时段容量预占 ${cmd.weldIds.length} 道焊缝（${cmd.weldIds.join('、')}），请求号 ${cmd.requestId}`,
    }
    const next: LedgerState = {
      ...s,
      plans: [plan, ...s.plans],
      occupancy: [...occupancy, ...s.occupancy],
      audit: [audit, ...s.audit],
      version: s.version + 1,
    }
    const outcome: WriteOutcome = { ok:true, version:next.version, requestId:cmd.requestId, kind:'plan', plan, occupancy }
    this.requestLog.set(cmd.requestId, { fingerprint, outcome })
    this.state$.next(next)
    return outcome
  }

  /** 录入检测结果：凭预占账核销，重算比例；不足的计划退回待重排，原审核结论保留并标失效来源 */
  async recordResult(cmd: RecordResultCommand): Promise<WriteOutcome> {
    await delay(140)
    const fingerprint = JSON.stringify({
      planId: cmd.planId, weldId: cmd.weldId, inspectedLength: cmd.inspectedLength,
      defects: cmd.defects.map((d) => ({ position:d.position, type:d.type, level:d.level, length:d.length, method:d.method })),
    })
    const cached = this.requestLog.get(cmd.requestId)
    if (cached) {
      if (cached.fingerprint === fingerprint) return cached.outcome
      return { ok:false, version:this.snapshot.version, requestId:cmd.requestId, reason:'mismatch' }
    }
    const s = this.snapshot
    if (cmd.baseVersion !== s.version) {
      return { ok:false, version:s.version, requestId:cmd.requestId, reason:'conflict', currentVersion:s.version }
    }
    const reject = (outcome: WriteOutcome): WriteOutcome => {
      this.requestLog.set(cmd.requestId, { fingerprint, outcome })
      return outcome
    }

    const plan = s.plans.find((p) => p.id === cmd.planId)
    if (!plan) {
      return reject({ ok:false, version:s.version, requestId:cmd.requestId, reason:'not_found', message:`检测计划 ${cmd.planId} 不存在` })
    }
    const occ = s.occupancy.find((o) => o.planId === cmd.planId && o.weldId === cmd.weldId)
    if (!occ) {
      return reject({
        ok:false, version:s.version, requestId:cmd.requestId, reason:'not_occupied',
        weldId:cmd.weldId, planId:cmd.planId,
        message:`焊缝 ${cmd.weldId} 不在计划 ${cmd.planId} 的预占账中，结果未入账（晚到结果或焊缝不属于本计划）`,
      })
    }
    if (occ.status !== '预占') {
      return reject({
        ok:false, version:s.version, requestId:cmd.requestId, reason:'not_occupied',
        weldId:cmd.weldId, planId:cmd.planId,
        message:`焊缝 ${cmd.weldId} 的预占已${occ.status === '已核销' ? '核销' : '释放'}，重复结果未入账`,
      })
    }

    // 1. 结果入账：缺陷挂焊缝、预占核销
    const newDefects: Defect[] = cmd.defects.map((d, i) => ({
      id: seq('D'), position:d.position, type:d.type, length:d.length, level:d.level, method:d.method, report:d.report || `${d.method}-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${i + 1}`,
    }))
    const result: InspectionResultRecord = {
      id: seq('RES'), requestId:cmd.requestId, planId:cmd.planId, weldId:cmd.weldId,
      method:occ.method, defects:newDefects, inspectedLength:cmd.inspectedLength, time:now(),
    }
    const hasSevere = newDefects.some((d) => d.level === 'Ⅲ级' || d.level === 'Ⅳ级')

    // 2. 重算检测比例：累计已检测长度 / 焊缝总长
    const weld = s.welds.find((w) => w.id === cmd.weldId)!
    const totalInspected = s.results
      .filter((r) => r.weldId === cmd.weldId)
      .reduce((sum, r) => sum + r.inspectedLength, 0) + cmd.inspectedLength
    const newRatio = Math.min(100, Math.round((totalInspected / weld.length) * 100))
    const newStatus: WeldStatus = hasSevere ? '返修中' : newDefects.length ? '待复检' : weld.status

    let nextWelds = s.welds.map((w) => w.id === cmd.weldId
      ? { ...w, defects:[...w.defects, ...newDefects], inspectionRatio:newRatio, status:newStatus }
      : w)
    let nextOccupancy = s.occupancy.map((o) => o.id === occ.id ? { ...o, status:'已核销' as const } : o)
    let nextAudit: AuditEvent[] = [...s.audit]
    let nextPlans = s.plans
    let released: string[] = []

    // 3. 计划状态由占用账核销情况决定，晚到结果不得直接把计划算成已完成
    const planOcc = nextOccupancy.filter((o) => o.planId === cmd.planId)
    let planState = plan.state
    if (planOcc.length > 0 && planOcc.every((o) => o.status === '已核销')) {
      const insufficient = plan.weldIds.filter((weldId) => {
        const w = nextWelds.find((x) => x.id === weldId)
        return !!w && w.inspectionRatio < w.requiredRatio
      })
      if (insufficient.length > 0) {
        // 比例不足：计划退回待重排，释放不足焊缝的预占以便重新排计划
        planState = '待重排'
        released = insufficient
        nextOccupancy = nextOccupancy.map((o) => insufficient.includes(o.weldId) ? { ...o, status:'已释放' as const } : o)
        const source = `检测结果更新后比例不足：${insufficient.map((id) => {
          const w = nextWelds.find((x) => x.id === id)!
          return `${id} ${w.inspectionRatio}% < ${w.requiredRatio}%`
        }).join('；')}`
        // 原审核结论保留原位，仅标记失效来源
        nextAudit = nextAudit.map((e) => isConclusion(e.action) && (e.target === cmd.planId || plan.weldIds.includes(e.target))
          ? { ...e, invalid:true, invalidSource:source }
          : e)
        nextAudit.unshift({
          id:seq('AE'), time:now(), actor:'系统', action:'计划退回待重排', target:cmd.planId,
          detail:`${cmd.planId} 核销后 ${insufficient.join('、')} 检测比例不足，退回待重排并释放预占`,
        })
      } else {
        planState = '已完成'
        nextAudit.unshift({
          id:seq('AE'), time:now(), actor:'系统', action:'计划完成', target:cmd.planId,
          detail:`${cmd.planId} 预占全部核销，检测比例满足要求，计划完成`,
        })
      }
    } else {
      planState = '执行中'
    }

    // 4. 新发现超标缺陷：该焊缝原有合格结论失效（保留并标来源）
    if (hasSevere) {
      const severe = newDefects.find((d) => d.level === 'Ⅲ级' || d.level === 'Ⅳ级')!
      nextAudit = nextAudit.map((e) => isConclusion(e.action) && e.target === cmd.weldId && !e.invalid
        ? { ...e, invalid:true, invalidSource:`新检测结果发现 ${severe.level} 缺陷（${severe.type}）` }
        : e)
    }

    nextPlans = nextPlans.map((p) => p.id === cmd.planId ? { ...p, state:planState as InspectionPlan['state'] } : p)
    const next: LedgerState = {
      ...s,
      welds: nextWelds,
      plans: nextPlans,
      results: [result, ...s.results],
      occupancy: nextOccupancy,
      audit: nextAudit,
      version: s.version + 1,
    }
    const outcome: WriteOutcome = {
      ok:true, version:next.version, requestId:cmd.requestId, kind:'result',
      result, plan:nextPlans.find((p) => p.id === cmd.planId)!, released,
    }
    this.requestLog.set(cmd.requestId, { fingerprint, outcome })
    this.state$.next(next)
    return outcome
  }

  /** 审核结论（确认合格等）：留下结论；后续结果更新导致失效时由占用账标记来源 */
  async setWeldStatus(cmd: StatusCommand): Promise<WriteOutcome> {
    await delay(120)
    const fingerprint = JSON.stringify({ weldId:cmd.weldId, status:cmd.status })
    const cached = this.requestLog.get(cmd.requestId)
    if (cached) {
      if (cached.fingerprint === fingerprint) return cached.outcome
      return { ok:false, version:this.snapshot.version, requestId:cmd.requestId, reason:'mismatch' }
    }
    const s = this.snapshot
    if (cmd.baseVersion !== s.version) {
      return { ok:false, version:s.version, requestId:cmd.requestId, reason:'conflict', currentVersion:s.version }
    }
    const weld = s.welds.find((w) => w.id === cmd.weldId)
    if (!weld) {
      const outcome: WriteOutcome = { ok:false, version:s.version, requestId:cmd.requestId, reason:'not_found', message:`焊缝 ${cmd.weldId} 不存在` }
      this.requestLog.set(cmd.requestId, { fingerprint, outcome })
      return outcome
    }
    const action = cmd.status === '合格' ? '确认合格' : '状态流转'
    const audit: AuditEvent = {
      id:seq('AE'), time:now(), actor:cmd.actor, action, target:cmd.weldId,
      detail:`焊缝状态确认为 ${cmd.status}（请求号 ${cmd.requestId}）`,
    }
    const next: LedgerState = {
      ...s,
      welds: s.welds.map((w) => w.id === cmd.weldId ? { ...w, status:cmd.status } : w),
      audit: [audit, ...s.audit],
      version: s.version + 1,
    }
    const outcome: WriteOutcome = { ok:true, version:next.version, requestId:cmd.requestId, kind:'status', weld:next.welds.find((w) => w.id === cmd.weldId)! }
    this.requestLog.set(cmd.requestId, { fingerprint, outcome })
    this.state$.next(next)
    return outcome
  }

  async lockBaseline(cmd: LockCommand): Promise<WriteOutcome> {
    await delay(120)
    const fingerprint = JSON.stringify({ lock:true })
    const cached = this.requestLog.get(cmd.requestId)
    if (cached) {
      if (cached.fingerprint === fingerprint) return cached.outcome
      return { ok:false, version:this.snapshot.version, requestId:cmd.requestId, reason:'mismatch' }
    }
    const s = this.snapshot
    if (cmd.baseVersion !== s.version) {
      return { ok:false, version:s.version, requestId:cmd.requestId, reason:'conflict', currentVersion:s.version }
    }
    const audit: AuditEvent = {
      id:seq('AE'), time:now(), actor:cmd.actor, action:'签字锁定', target:'检测批次',
      detail:`焊工资质、检测比例与返修闭环已确认，版本 v${s.version}（请求号 ${cmd.requestId}）`,
    }
    const next: LedgerState = { ...s, locked:true, audit:[audit, ...s.audit], version:s.version + 1 }
    const outcome: WriteOutcome = { ok:true, version:next.version, requestId:cmd.requestId, kind:'lock' }
    this.requestLog.set(cmd.requestId, { fingerprint, outcome })
    this.state$.next(next)
    return outcome
  }

  selectWeld(id: string) {
    this.state$.next({ ...this.snapshot, selectedId:id })
  }

  setStatusFilter(status: string) {
    this.state$.next({ ...this.snapshot, statusFilter:status })
  }
}
