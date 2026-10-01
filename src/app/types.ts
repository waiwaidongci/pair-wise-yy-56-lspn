export type WeldStatus = '待检测' | '合格' | '返修中' | '待复检' | '待重排' | '已关闭'
export type DefectLevel = 'Ⅰ级' | 'Ⅱ级' | 'Ⅲ级' | 'Ⅳ级'

/** 计划状态：「待重排」为比例复算不达标后被退回的状态 */
export type PlanState = '待执行' | '执行中' | '已完成' | '待重排'

/** 检测时段：同一检测方法在同一时段有班组容量上限 */
export type SlotPeriod = '上午' | '下午' | '夜班'

export interface TimeSlot {
  date: string
  period: SlotPeriod
}

export interface Defect {
  id: string
  position: number
  type: string
  length: number
  level: DefectLevel
  method: string
  report: string
}

export interface Weld {
  id: string
  drawing: string
  component: string
  joint: string
  method: string
  welder: string
  qualification: string
  qualificationValid: boolean
  inspectionRatio: number
  requiredRatio: number
  status: WeldStatus
  x: number
  y: number
  repairs: number
  defects: Defect[]
}

export interface InspectionPlan {
  id: string
  date: string
  period: SlotPeriod
  method: string
  weldIds: string[]
  inspector: string
  state: PlanState
  /** 建账请求号，写入失败重试时不重复占位 */
  requestId: string
  /** 被退回待重排的原因（检测比例复算不足时填写） */
  rescheduleReason?: string
}

/**
 * 占用账：焊缝 × 检测方法 × 时段 是唯一的占用单元。
 * 检测计划建账即预占，检测结果只认占用账，不再各自记一份。
 */
export interface Occupancy {
  id: string
  slotId: string
  date: string
  period: SlotPeriod
  method: string
  weldId: string
  planId: string
  state: PlanState
  /** 确认该占用的检测结果编号 */
  resultId?: string
}

export type ResultVerdict = '合格' | '不合格'

/**
 * 检测结果。结果必须落到占用账上：
 * 找不到有效占用（焊缝 × 方法 × 时段）即为迟到结果，不得把已排计划算成已完成。
 */
export interface InspectionResult {
  id: string
  requestId: string
  reportNo: string
  weldId: string
  method: string
  date: string
  period: SlotPeriod
  verdict: ResultVerdict
  /** 该结果覆盖的检测比例 0–100，复算时按焊缝取最大覆盖值 */
  coverage: number
  state: '已确认' | '结果迟到'
  /** 命中的占用账条目；迟到结果为空 */
  occupancyId?: string
  planId?: string
  detail: string
}

export interface SlotCapacity {
  slotId: string
  date: string
  period: SlotPeriod
  method: string
  /** 该时段该检测方法的班组容量（可占焊缝条数） */
  limit: number
}

export type RequestKind = '创建计划' | '提交结果'
export type RequestPhase = '预检' | '写入'
export type RequestStatus = '进行中' | '已提交' | '写入失败待重试' | '已拒绝' | '已完成'

/** 写入请求台账：按请求号幂等，失败重试不会重复占位 */
export interface RequestRecord {
  requestId: string
  kind: RequestKind
  phase: RequestPhase
  status: RequestStatus
  detail: string
  planId?: string
  errorCode?: string
  errorMessage?: string
  /** 预检冲突时，指出原占用计划号 */
  conflictPlanId?: string
  updatedAt: string
}

export interface AuditEvent {
  id: string
  time: string
  actor: string
  action: string
  target: string
  detail: string
  /** 审核结论有效性：计划退回待重排后原结论保留但标记失效 */
  valid?: boolean
  /** 导致结论失效的来源（检测结果报告号） */
  invalidatedBy?: string
  invalidatedAt?: string
  invalidReason?: string
}

export interface LedgerSnapshot {
  plans: InspectionPlan[]
  occupancies: Occupancy[]
  results: InspectionResult[]
  capacities: SlotCapacity[]
  requests: RequestRecord[]
  audit: AuditEvent[]
  /** 结果复算后各焊缝的实际检测比例 */
  ratioPatch: Record<string, number>
}

/** 建计划预检/写入失败 */
export class PlanRejectedError extends Error {
  constructor(
    public readonly code: 'METHOD_CONFLICT' | 'CAPACITY_FULL' | 'INVALID_INPUT' | 'WRITE_FAILED',
    message: string,
    public readonly conflictPlanId?: string,
  ) {
    super(message)
    this.name = 'PlanRejectedError'
  }
}

/** 迟到检测结果：不匹配占用账 */
export class LateResultError extends Error {
  constructor(
    public readonly resultId: string,
    public readonly requestId: string,
    message: string,
  ) {
    super(message)
    this.name = 'LateResultError'
  }
}

export interface CreatePlanInput {
  requestId?: string
  date: string
  period: SlotPeriod
  /** 支持 "UT + MT" 组合方法 */
  method: string
  weldIds: string[]
  inspector: string
  /** 模拟写入阶段失败（请求号落账后重试不再失败） */
  failWrite?: boolean
}

export interface SubmitResultInput {
  requestId?: string
  reportNo: string
  weldId: string
  method: string
  date: string
  period: SlotPeriod
  verdict: ResultVerdict
  coverage: number
  detail: string
  failWrite?: boolean
}
