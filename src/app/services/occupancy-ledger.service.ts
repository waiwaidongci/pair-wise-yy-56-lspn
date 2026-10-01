import { Injectable } from '@angular/core'
import { BehaviorSubject } from 'rxjs'
import type {
  AuditEvent,
  CreatePlanInput,
  InspectionPlan,
  InspectionResult,
  Occupancy,
  RequestRecord,
  SlotCapacity,
  SlotPeriod,
  SubmitResultInput,
} from '../types'
import { LateResultError, PlanRejectedError } from '../types'

export interface LedgerState {
  plans: InspectionPlan[]
  occupancies: Occupancy[]
  results: InspectionResult[]
  capacities: SlotCapacity[]
  requests: RequestRecord[]
  audit: AuditEvent[]
  ratioPatch: Record<string, number>
  /** 占用账结构版本：计划 / 占用 / 结果 / 审计实质变化时递增，请求状态流转不递增 */
  revision: number
}

/** 组合方法展开为单方法键，UT + MT 需同时占用两条账 */
export function methodKeys(method: string): string[] {
  return method.split('+').map((part) => part.trim()).filter(Boolean)
}

export function slotId(date: string, period: SlotPeriod, method: string): string {
  return `${date}#${period}#${method}`
}

const PERIOD_ORDER: SlotPeriod[] = ['上午', '下午', '夜班']

const initialAudit: AuditEvent[] = [
  { id: 'AE-1', time: '16:38', actor: '赵岚', action: '提交复检', target: 'W-104', detail: '返修后 UT 复检合格，等待审核签字', valid: true },
  { id: 'AE-2', time: '15:12', actor: '陈锋', action: '录入缺陷', target: 'W-107', detail: '翼缘板端部夹渣，长度 12mm，Ⅱ级', valid: true },
  { id: 'AE-3', time: '14:20', actor: '系统', action: '资质预警', target: 'W-109', detail: '焊工证书 2026-10-01 到期，不得列入后续检测计划', valid: true },
]

/**
 * 焊缝 / 检测计划 / 检测结果共用的一份占用账。
 *
 *  - 建计划按「检测方法 × 时段容量」预占，同一焊缝在同一方法 + 时段只能有一笔有效占用；
 *  - 重复占用拒绝放行，并指出原计划号；
 *  - 写路径在订阅者通知之外串行化，两人同时保存只有一笔通过；
 *  - 所有写入按请求号幂等，写入失败后凭原请求号重试，不会重复占位；
 *  - 检测结果只认占用账，匹配不上记为「结果迟到」，不会把已排计划算成已完成；
 *  - 结果更新后按焊缝重算检测比例，比例不足的计划退回「待重排」，
 *    原审核结论保留但标记失效并注明失效来源。
 */
@Injectable({ providedIn: 'root' })
export class OccupancyLedgerService {
  private plans: InspectionPlan[] = []
  private occupancies: Occupancy[] = []
  private results: InspectionResult[] = []
  private capacities: SlotCapacity[] = []
  private requests = new Map<string, RequestRecord>()
  private audit: AuditEvent[] = initialAudit
  private ratioPatch: Record<string, number> = {}

  private seq = 0
  private revision = 0
  private structuralChange = false
  /** 串行化写入：上一笔（含异步写入）未完成，后一笔必须等待 */
  private writeChain: Promise<unknown> = Promise.resolve()
  private inflight = new Set<string>()

  private readonly subject = new BehaviorSubject<LedgerState>(this.snapshot())
  readonly state$ = this.subject.asObservable()
  /** 同步读取当前占用账快照（写入决策后立即核对用） */
  get value(): LedgerState { return this.subject.getValue() }

  /** 初始容量：每个日期 × 时段 × 方法默认 4 条焊缝容量 */
  ensureCapacity(date: string, period: SlotPeriod, method: string, limit = 4) {
    const id = slotId(date, period, method)
    if (!this.capacities.some((entry) => entry.slotId === id)) {
      this.capacities = [...this.capacities, { slotId: id, date, period, method, limit }]
      this.structuralChange = true
    }
  }

  seed(data: { plans: InspectionPlan[]; capacities?: SlotCapacity[]; audit?: AuditEvent[] }) {
    this.revision = 0
    this.plans = data.plans.map((plan) => ({ ...plan }))
    this.occupancies = this.plans
      .filter((plan) => plan.state !== '待重排')
      .flatMap((plan) => this.buildOccupancies(plan))
    this.capacities = data.capacities ? [...data.capacities] : []
    if (!this.capacities.length) {
      for (const plan of this.plans) {
        for (const period of PERIOD_ORDER) {
          for (const key of methodKeys(plan.method)) this.ensureCapacity(plan.date, period, key)
        }
      }
    }
    if (data.audit) this.audit = data.audit.map((event) => ({ ...event }))
    this.publish(true)
  }

  getRequest(requestId: string): RequestRecord | undefined {
    return this.requests.get(requestId)
  }

  /**
   * 创建检测计划。两人同时保存时写路径串行，只有一笔能通过冲突预检。
   * 传入 failWrite=true 可模拟写入阶段失败：请求号已登记，重试时幂等放行。
   */
  createPlan(input: CreatePlanInput): Promise<InspectionPlan> {
    const requestId = input.requestId?.trim() || this.newRequestId('REQ-PLAN')
    const prior = this.requests.get(requestId)
    if (prior && prior.kind !== '创建计划') {
      return Promise.reject(new PlanRejectedError('INVALID_INPUT', `请求号 ${requestId} 已用于其他业务`))
    }

    const run = () => {
      const prior = this.requests.get(requestId)
      const retrying = prior?.status === '写入失败待重试'
      return this.upsertRequest(requestId, {
        kind: '创建计划', phase: '预检', status: '进行中',
        detail: `建计划预检：${input.date} ${input.period} ${input.method} · ${input.weldIds.length} 条焊缝`,
      }).then(() => {
        // 幂等命中：同一请求号重试，直接回放已创建的计划，绝不重复占位
        if (prior?.status === '已提交' && prior.planId) {
          const existing = this.plans.find((plan) => plan.id === prior.planId)
          if (existing) {
            this.upsertRequest(requestId, { status: '已提交', phase: '写入', planId: existing.id, detail: `重试命中请求号 ${requestId}，回放计划 ${existing.id}，未重复占位` })
            return existing
          }
        }
        // 上一笔在写入阶段失败，占用未生效；按原请求号、原计划号完成写入
        if (retrying && prior!.planId) {
          return this.finalizePlanCreation(requestId, input, false, prior!.planId)
        }
        return this.finalizePlanCreation(requestId, input, !!input.failWrite)
      })
    }

    return this.enqueue(requestId, run)
  }

  private finalizePlanCreation(requestId: string, input: CreatePlanInput, failWrite: boolean, fixedPlanId?: string): InspectionPlan {
    const keys = methodKeys(input.method)
    if (!input.date || !input.period || !keys.length || !input.weldIds.length) {
      this.rejectRequest(requestId, 'INVALID_INPUT', '计划日期、时段、方法和焊缝清单不完整')
      throw new PlanRejectedError('INVALID_INPUT', '计划日期、时段、方法和焊缝清单不完整')
    }

    for (const key of keys) this.ensureCapacity(input.date, input.period, key)

    // 占用账冲突检查：同一焊缝 × 方法 × 时段只允许一笔有效（未完成且未退回）占用
    for (const weldId of input.weldIds) {
      for (const key of keys) {
        const holder = this.occupancies.find(
          (entry) => entry.weldId === weldId && entry.method === key
            && entry.date === input.date && entry.period === input.period
            && entry.state !== '已完成' && entry.state !== '待重排',
        )
        if (holder) {
          const message = `焊缝 ${weldId} 在 ${input.date} ${input.period} 的 ${key} 已被计划 ${holder.planId} 占用`
          this.rejectRequest(requestId, 'METHOD_CONFLICT', message, holder.planId)
          throw new PlanRejectedError('METHOD_CONFLICT', message, holder.planId)
        }
      }
    }

    // 时段容量检查（按检测方法）
    for (const key of keys) {
      const id = slotId(input.date, input.period, key)
      const cap = this.capacities.find((entry) => entry.slotId === id)!
      const used = this.occupancies.filter(
        (entry) => entry.slotId === id && entry.state !== '已完成' && entry.state !== '待重排',
      ).length
      if (used + input.weldIds.length > cap.limit) {
        const message = `${input.date} ${input.period} ${key} 容量 ${cap.limit} 条，已占 ${used} 条，本计划 ${input.weldIds.length} 条超出容量`
        this.rejectRequest(requestId, 'CAPACITY_FULL', message)
        throw new PlanRejectedError('CAPACITY_FULL', message)
      }
    }

    const planId = fixedPlanId ?? this.newPlanId()
    if (failWrite) {
      // 写入阶段失败：只登记请求台账，不写计划、不写占用账
      this.requests.set(requestId, {
        ...this.requests.get(requestId)!,
        phase: '写入', status: '写入失败待重试', planId,
        errorCode: 'WRITE_FAILED',
        errorMessage: '保存写入失败，请凭请求号重试（不会重复占位）',
        detail: `计划 ${planId} 预检通过但写入失败，请求号 ${requestId} 可重试`,
        updatedAt: this.now(),
      })
      this.publish()
      throw new PlanRejectedError('WRITE_FAILED', `计划 ${planId} 写入失败，请求号 ${requestId} 可重试`)
    }

    const plan: InspectionPlan = {
      id: planId, date: input.date, period: input.period, method: input.method,
      weldIds: [...input.weldIds], inspector: input.inspector, state: '待执行', requestId,
    }
    this.plans = [plan, ...this.plans]
    this.occupancies = [...this.occupancies, ...this.buildOccupancies(plan)]
    this.requests.set(requestId, {
      ...this.requests.get(requestId)!,
      phase: '写入', status: '已提交', planId,
      detail: `计划 ${planId} 已按 ${input.method} × ${input.period} 预占 ${input.weldIds.length} 条焊缝`,
      updatedAt: this.now(),
    })
    this.pushAudit('系统', '预占占用', planId, `按 ${input.method} / ${input.date} ${input.period} 预占 ${input.weldIds.join('、')}，请求号 ${requestId}`)
    this.publish()
    return plan
  }

  /**
   * 提交检测结果。结果只认占用账：
   *  - 命中有效占用：确认结果、把对应占用置为已完成并复算比例；
   *  - 命不中：记为「结果迟到」，已排计划状态不被改写。
   */
  submitResult(input: SubmitResultInput): Promise<InspectionResult> {
    const requestId = input.requestId?.trim() || this.newRequestId('REQ-RESULT')
    const prior = this.requests.get(requestId)
    if (prior && prior.kind !== '提交结果') {
      return Promise.reject(new PlanRejectedError('INVALID_INPUT', `请求号 ${requestId} 已用于其他业务`))
    }

    const run = () => {
      const prior = this.requests.get(requestId)
      const retrying = prior?.status === '写入失败待重试'
      this.upsertRequest(requestId, {
        kind: '提交结果', phase: '预检', status: '进行中',
        detail: `结果预检：报告 ${input.reportNo} · ${input.weldId} · ${input.method} · ${input.date} ${input.period}`,
      })

      if (prior?.status === '已提交' || prior?.status === '已完成') {
        const existing = this.results.find((result) => result.requestId === requestId)
        if (existing) {
          this.upsertRequest(requestId, { phase: '写入', status: prior.status, detail: `重试命中请求号 ${requestId}，回放结果 ${existing.id}，未重复入账` })
          return Promise.resolve(existing)
        }
      }

      return this.deliberateResult(requestId, input, retrying)
    }

    return this.enqueue(requestId, run)
  }

  private deliberateResult(requestId: string, input: SubmitResultInput, retrying = false): Promise<InspectionResult> {
    // 模拟写入阶段失败：请求号已落账，重试时放行，不重复入账
    if (input.failWrite && !retrying) {
      const resultId = this.newResultId()
      this.requests.set(requestId, {
        ...this.requests.get(requestId)!,
        phase: '写入', status: '写入失败待重试',
        errorCode: 'WRITE_FAILED', errorMessage: '结果写入失败，请凭请求号重试（不会重复入账）',
        detail: `结果 ${resultId}（报告 ${input.reportNo}）写入失败，请求号 ${requestId} 可重试`,
        updatedAt: this.now(),
      })
      this.publish()
      return Promise.reject(new PlanRejectedError('WRITE_FAILED', `结果 ${resultId} 写入失败，请求号 ${requestId} 可重试`))
    }

    const key = methodKeys(input.method)[0]
    // 结果与占用账核对：焊缝 × 方法 × 时段必须一致
    const occupancy = this.occupancies.find(
      (entry) => entry.weldId === input.weldId && entry.method === key
        && entry.date === input.date && entry.period === input.period
        && entry.state !== '待重排',
    )

    const resultId = this.newResultId()
    if (!occupancy) {
      const result: InspectionResult = {
        id: resultId, requestId, reportNo: input.reportNo, weldId: input.weldId, method: input.method,
        date: input.date, period: input.period, verdict: input.verdict, coverage: input.coverage,
        state: '结果迟到', detail: input.detail,
      }
      this.results = [result, ...this.results]
      this.requests.set(requestId, {
        ...this.requests.get(requestId)!, phase: '写入', status: '已完成',
        detail: `报告 ${input.reportNo} 在占用账中无对应计划（${input.weldId} / ${key} / ${input.date} ${input.period}），记为迟到，未改写已排计划`,
        updatedAt: this.now(),
      })
      this.pushAudit('系统', '结果迟到', input.weldId, `报告 ${input.reportNo} 晚到：占用账无 ${key} ${input.date} ${input.period} 的有效预占，计划状态保持不变`)
      this.publish()
      // 迟到结果属于明确的业务拒绝，向调用方抛出以便界面提示
      return Promise.reject(new LateResultError(resultId, requestId,
        `报告 ${input.reportNo} 为迟到结果：${input.weldId} 在 ${input.date} ${input.period} 无 ${key} 有效占用`))
    }

    const result: InspectionResult = {
      id: resultId, requestId, reportNo: input.reportNo, weldId: input.weldId, method: input.method,
      date: input.date, period: input.period, verdict: input.verdict, coverage: input.coverage,
      state: '已确认', occupancyId: occupancy.id, planId: occupancy.planId, detail: input.detail,
    }
    this.results = [result, ...this.results]
    this.occupancies = this.occupancies.map((entry) =>
      entry.id === occupancy.id ? { ...entry, state: '已完成' as const, resultId } : entry)
    this.requests.set(requestId, {
      ...this.requests.get(requestId)!, phase: '写入', status: '已完成', planId: occupancy.planId,
      detail: `报告 ${input.reportNo} 命中占用 ${occupancy.id}（计划 ${occupancy.planId}），已确认并复算比例`,
      updatedAt: this.now(),
    })
    this.pushAudit('陈锋', '确认检测结果', occupancy.planId, `报告 ${input.reportNo} 确认 ${input.weldId} ${key} ${input.verdict}，覆盖 ${input.coverage}%`)
    this.recalculate(occupancy.planId, input.reportNo)
    this.publish()
    return Promise.resolve(result)
  }

  /**
   * 结果更新后重算：
   *  - 每条焊缝取已确认结果的最大覆盖比例；
   *  - 计划内全部占用已完成且实际比例满足要求 → 计划完成；
   *  - 比例不足 → 计划退回待重排、释放占用，关联审核结论保留但标记失效并注明来源。
   */
  private recalculate(triggerPlanId: string, reportNo: string) {
    const confirmed = this.results.filter((result) => result.state === '已确认')
    const patch: Record<string, number> = {}
    for (const result of confirmed) {
      patch[result.weldId] = Math.max(patch[result.weldId] ?? 0, result.coverage)
    }
    this.ratioPatch = patch

    const plan = this.plans.find((item) => item.id === triggerPlanId)
    if (!plan) return
    const entries = this.occupancies.filter((entry) => entry.planId === plan.id)
    const weldSet = [...new Set(entries.map((entry) => entry.weldId))]
    const allDone = entries.every((entry) => entry.state === '已完成')
    // 计划要求比例：结果覆盖达到焊缝既定要求比例才算足；演示数据中按 20% 兜底
    const shortWelds = weldSet.filter((weldId) => (this.ratioPatch[weldId] ?? 0) < this.requiredRatioOf(weldId))

    if (allDone && shortWelds.length === 0) {
      this.plans = this.plans.map((item) => item.id === plan.id ? { ...item, state: '已完成' as const, rescheduleReason: undefined } : item)
      this.pushAudit('系统', '计划完成', plan.id, `计划内焊缝检测比例全部达标，置为已完成`)
      return
    }

    if (allDone && shortWelds.length > 0) {
      const reason = `检测比例不足：${shortWelds.join('、')} 实际覆盖低于要求，按报告 ${reportNo} 复算后退回待重排`
      this.plans = this.plans.map((item) => item.id === plan.id ? { ...item, state: '待重排' as const, rescheduleReason: reason } : item)
      // 释放占用账：计划退回待重排，其全部占用（含已确认结果的那条）一并释放，
      // 以便重排新计划重新占位；结果记录本身保留留痕。
      this.occupancies = this.occupancies.map((entry) =>
        entry.planId === plan.id ? { ...entry, state: '待重排' as const } : entry)
      // 原审核结论保留，标出失效来源（晚到/更新的检测结果报告号）
      this.audit = this.audit.map((event) =>
        event.target === plan.id || weldSet.includes(event.target)
          ? {
              ...event,
              valid: false,
              invalidatedBy: reportNo,
              invalidatedAt: this.now(),
              invalidReason: `检测结果 ${reportNo} 复算比例不足，计划退回待重排`,
            }
          : event)
      this.pushAudit('系统', '退回待重排', plan.id, reason)
    }
  }

  /** 演示环境下焊缝要求比例由台账给出；占用账服务不直接持有焊缝表时按 20% 兜底 */
  private requiredRatioOf(_weldId: string): number {
    return this.externalRequiredRatio?.(_weldId) ?? 20
  }

  private externalRequiredRatio?: (weldId: string) => number
  bindRequiredRatio(provider: (weldId: string) => number) {
    this.externalRequiredRatio = provider
  }

  private buildOccupancies(plan: InspectionPlan): Occupancy[] {
    return methodKeys(plan.method).flatMap((key) =>
      plan.weldIds.map((weldId, index) => ({
        id: `OCC-${plan.id}-${key}-${index}`,
        slotId: slotId(plan.date, plan.period, key),
        date: plan.date, period: plan.period, method: key,
        weldId, planId: plan.id, state: plan.state,
      })))
  }

  /** 串行排队：同一时刻只有一笔写入在执行（两人同时保存只放行一笔） */
  private enqueue<T>(requestId: string, task: () => Promise<T> | T): Promise<T> {
    if (this.inflight.has(requestId)) {
      return Promise.reject(new PlanRejectedError('INVALID_INPUT', `请求号 ${requestId} 正在处理中，请勿重复提交`))
    }
    this.inflight.add(requestId)
    const run = this.writeChain.then(() => task())
    this.writeChain = run.then(
      () => this.inflight.delete(requestId),
      () => this.inflight.delete(requestId),
    )
    return run
  }

  private rejectRequest(requestId: string, code: NonNullable<RequestRecord['errorCode']>, message: string, conflictPlanId?: string) {
    this.requests.set(requestId, {
      ...this.requests.get(requestId)!,
      status: '已拒绝', errorCode: code, errorMessage: message, conflictPlanId,
      updatedAt: this.now(),
    })
    this.pushAudit('系统', '拒绝占用', conflictPlanId ?? requestId, message)
    this.publish()
  }

  private upsertRequest(requestId: string, patch: Partial<RequestRecord>): Promise<void> {
    const prev = this.requests.get(requestId)
    this.requests.set(requestId, {
      requestId, kind: patch.kind ?? prev?.kind ?? '创建计划',
      phase: patch.phase ?? prev?.phase ?? '预检',
      status: patch.status ?? prev?.status ?? '进行中',
      detail: patch.detail ?? prev?.detail ?? '',
      planId: patch.planId ?? prev?.planId,
      errorCode: patch.errorCode ?? prev?.errorCode,
      errorMessage: patch.errorMessage ?? prev?.errorMessage,
      conflictPlanId: patch.conflictPlanId ?? prev?.conflictPlanId,
      updatedAt: this.now(),
    })
    this.publish()
    return Promise.resolve()
  }

  private pushAudit(actor: string, action: string, target: string, detail: string) {
    this.structuralChange = true
    this.audit = [{
      id: `AE-${++this.seq}-${Date.now().toString(36)}`, time: this.now(true), actor, action, target, detail, valid: true,
    }, ...this.audit]
  }

  private snapshot(): LedgerState {
    return {
      plans: [...this.plans], occupancies: [...this.occupancies], results: [...this.results],
      capacities: [...this.capacities], requests: [...this.requests.values()],
      audit: [...this.audit], ratioPatch: { ...this.ratioPatch }, revision: this.revision,
    }
  }

  private publish(forceStructural = false) {
    if (forceStructural || this.structuralChange) {
      this.revision += 1
      this.structuralChange = false
    }
    this.subject.next(this.snapshot())
  }

  private now(timeOnly = false): string {
    return timeOnly
      ? new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      : new Date().toISOString()
  }

  private newPlanId() { return `IP-${Date.now().toString().slice(-6)}-${++this.seq}` }
  private newResultId() { return `IR-${Date.now().toString().slice(-6)}-${++this.seq}` }
  private newRequestId(prefix: string) { return `${prefix}-${Date.now().toString(36)}-${(++this.seq).toString(36)}` }
}
