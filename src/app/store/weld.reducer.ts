import { createReducer, on } from '@ngrx/store'
import type { AuditEvent, InspectionPlan, Weld } from '../types'
import type { LedgerState } from '../services/occupancy-ledger.service'
import * as A from './weld.actions'

export interface WeldState extends LedgerState {
  welds: Weld[]
  selectedId: string
  statusFilter: string
  locked: boolean
  version: number
  /** 占用账是否已从首批计划播种；播种后计划/占用/结果以占用账为唯一事实源 */
  ledgerSeeded: boolean
}

const emptyLedger: LedgerState = { plans: [], occupancies: [], results: [], capacities: [], requests: [], audit: [], ratioPatch: {}, revision: 0 }

const audit: AuditEvent[] = [
  { id: 'AE-1', time: '16:38', actor: '赵岚', action: '提交复检', target: 'W-104', detail: '返修后 UT 复检合格，等待审核签字', valid: true },
  { id: 'AE-2', time: '15:12', actor: '陈锋', action: '录入缺陷', target: 'W-107', detail: '翼缘板端部夹渣，长度 12mm，Ⅱ级', valid: true },
  { id: 'AE-3', time: '14:20', actor: '系统', action: '资质预警', target: 'W-109', detail: '焊工证书 2026-10-01 到期，不得列入后续检测计划', valid: true },
]

export const initialState: WeldState = {
  ...emptyLedger,
  welds: [], selectedId: '', statusFilter: '全部', locked: false, version: 12, audit, ledgerSeeded: false,
}

export const weldReducer = createReducer(
  initialState,
  on(A.loadWeldsSuccess, (state, { welds, plans }) => ({
    ...state,
    welds,
    // 占用账播种前用 API 计划做种子；播种后计划只认占用账，避免重新加载冲掉已预占计划
    plans: state.ledgerSeeded ? state.plans : plans,
    selectedId: state.selectedId || welds[0]?.id || '',
  })),
  on(A.ledgerUpdated, (state, { ledger }) => ({
    ...state,
    ...ledger,
    ledgerSeeded: true,
    // 结果复算后的实际检测比例回写焊缝台账
    welds: state.welds.map((weld) => ledger.ratioPatch[weld.id] != null
      ? { ...weld, inspectionRatio: ledger.ratioPatch[weld.id] }
      : weld),
    // 占用账结构变化（预占 / 结果 / 退回）才推进工作版本，请求状态流转不推进
    version: ledger.revision !== state.revision ? state.version + 1 : state.version,
  })),
  on(A.selectWeld, (state, { id }) => ({ ...state, selectedId: id })),
  on(A.filterStatus, (state, { status }) => ({ ...state, statusFilter: status })),
  on(A.advanceWeld, (state, { id, status }) => ({
    ...state, version: state.version + 1,
    welds: state.welds.map((weld) => weld.id === id ? { ...weld, status } : weld),
    audit: [{ id: `AE-${Date.now()}`, time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }), actor: '当前审核人', action: '状态流转', target: id, detail: `状态变更为 ${status}`, valid: true }, ...state.audit],
  })),
  on(A.lockBaseline, (state) => ({ ...state, locked: true, audit: [{ id: `AE-${Date.now()}`, time: '刚刚', actor: '质量负责人', action: '签字锁定', target: '检测批次', detail: '焊工资质、检测比例与返修闭环已确认', valid: true }, ...state.audit] })),
)
