import { createAction, props } from '@ngrx/store'
import type { LedgerState } from '../services/occupancy-ledger.service'
import type { InspectionPlan, Weld, WeldStatus } from '../types'

export const loadWelds = createAction('[Weld] Load')
export const loadWeldsSuccess = createAction('[Weld API] Load Success', props<{ welds: Weld[]; plans: InspectionPlan[] }>())
/** 占用账（焊缝 / 计划 / 结果共用一份）每次变更后回放快照 */
export const ledgerUpdated = createAction('[Ledger] Snapshot', props<{ ledger: LedgerState }>())
export const selectWeld = createAction('[Weld] Select', props<{ id: string }>())
export const filterStatus = createAction('[Weld] Filter Status', props<{ status: string }>())
export const advanceWeld = createAction('[Weld] Advance', props<{ id: string; status: WeldStatus }>())
export const lockBaseline = createAction('[Approval] Lock Baseline')
