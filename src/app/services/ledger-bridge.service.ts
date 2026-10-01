import { Injectable, inject } from '@angular/core'
import { Store } from '@ngrx/store'
import { Subscription } from 'rxjs'
import { OccupancyLedgerService } from './occupancy-ledger.service'
import { WeldState } from '../store/weld.reducer'
import * as A from '../store/weld.actions'
import type { InspectionPlan } from '../types'

/**
 * 占用账桥接：
 *  - 台账数据加载后把计划播种进唯一占用账（仅一次）；
 *  - 占用账每次变更向 NgRx 回放快照，页面只订阅 store 即可。
 */
@Injectable({ providedIn: 'root' })
export class LedgerBridgeService {
  private readonly store = inject(Store<{ welds: WeldState }>)
  private readonly ledger = inject(OccupancyLedgerService)
  private seeded = false
  private sub?: Subscription

  start(): Subscription {
    this.ledger.bindRequiredRatio((weldId) => this.latestWelds.find((weld) => weld.id === weldId)?.requiredRatio ?? 20)
    this.sub = this.ledger.state$.subscribe((ledger) => this.store.dispatch(A.ledgerUpdated({ ledger })))
    this.store.select('welds').subscribe((state) => {
      this.latestWelds = state.welds
      if (!this.seeded && state.welds.length && state.plans.length) {
        this.seeded = true
        this.ledger.seed({ plans: state.plans as InspectionPlan[] })
      }
    })
    return this.sub!
  }

  private latestWelds: WeldState['welds'] = []
}
