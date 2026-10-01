export type WeldStatus = '待检测' | '合格' | '返修中' | '待复检' | '已关闭'
export type DefectLevel = 'Ⅰ级' | 'Ⅱ级' | 'Ⅲ级' | 'Ⅳ级'

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
  /** 焊缝总长度（mm），用于按已检测长度重算检测比例 */
  length: number
  status: WeldStatus
  x: number
  y: number
  repairs: number
  defects: Defect[]
}

export type PlanState = '待执行' | '执行中' | '已完成' | '待重排'

export interface InspectionPlan {
  id: string
  date: string
  method: string
  weldIds: string[]
  inspector: string
  state: PlanState
}

/** 占用账记录：焊缝按检测方法 + 时段（计划日期）被计划预占 */
export type OccupancyStatus = '预占' | '已核销' | '已释放'

export interface OccupancyRecord {
  id: string
  /** 归属检测计划号 */
  planId: string
  weldId: string
  method: string
  date: string
  inspector: string
  status: OccupancyStatus
  /** 写入时的请求号（幂等键） */
  requestId: string
}

/** 检测结果：必须凭计划 + 焊缝的预占账入账，晚到结果不能核销计划 */
export interface InspectionResultRecord {
  id: string
  requestId: string
  planId: string
  weldId: string
  method: string
  defects: Defect[]
  /** 本次检测覆盖长度（mm），用于重算检测比例 */
  inspectedLength: number
  time: string
}

export interface AuditEvent {
  id: string
  time: string
  actor: string
  action: string
  target: string
  detail: string
  /** 失效结论保留原位，仅标记并给出失效来源 */
  invalid?: boolean
  invalidSource?: string
}
