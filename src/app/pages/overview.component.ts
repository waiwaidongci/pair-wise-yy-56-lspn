import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { ButtonModule } from 'primeng/button'
import { SelectModule } from 'primeng/select'
import { FormsModule } from '@angular/forms'
import { LedgerService, type LedgerState } from '../services/ledger.service'
import type { Weld } from '../types'

@Component({
  selector:'app-overview', standalone:true, imports:[CommonModule,TableModule,TagModule,ButtonModule,SelectModule,FormsModule],
  template:`
    <main class="page"><div class="page-head"><div><p class="eyebrow">焊缝、资质与检测比例</p><h1>焊缝台账总览</h1><p>按构件、图纸和检验节点管理焊缝，优先暴露焊工资质过期、检测比例不足和重复返修。</p></div><p-button label="批量导入焊缝" icon="pi pi-upload" severity="secondary" /></div>
      <div class="grid-4"><article class="card metric"><span>焊缝总数</span><strong>{{state.welds.length}}</strong><small>占用账焊缝 {{occupiedCount}} 条</small></article><article class="card metric"><span>待检测 / 返修</span><strong class="warning">{{pending}}</strong><small>{{state.plans.length}} 个检测计划</small></article><article class="card metric"><span>资质或比例预警</span><strong class="danger">{{warnings}}</strong><small>必须处理后才可锁定</small></article><article class="card metric"><span>版本快照</span><strong>v{{state.version}}</strong><small>{{state.locked ? '已签字锁定' : '可继续修改'}}</small></article></div>
      <div class="grid-2"><section class="card"><div class="toolbar"><p-select [options]="statusOptions" [(ngModel)]="filter" (ngModelChange)="applyFilter($event)" placeholder="筛选状态" styleClass="w-full md:w-40" /><span class="spacer"></span><p-button label="导出焊缝台账" icon="pi pi-file-excel" severity="secondary" /></div><p-table [value]="filtered" [paginator]="true" [rows]="8" selectionMode="single" (onRowSelect)="select($event.data)" dataKey="id"><ng-template #header><tr><th>焊缝 / 构件</th><th>方法与焊工</th><th>检测</th><th>返修</th><th>状态</th></tr></ng-template><ng-template #body let-weld><tr><td><b>{{weld.id}}</b><small class="block">{{weld.drawing}} · {{weld.component}}</small></td><td>{{weld.method}} · {{weld.welder}}<small class="block" [class.danger]="!weld.qualificationValid">{{weld.qualificationValid ? '资质有效' : '资质即将过期'}}</small></td><td><b [class.danger]="weld.inspectionRatio < weld.requiredRatio">{{weld.inspectionRatio}}% / {{weld.requiredRatio}}%</b><small class="block">要求检测比例</small></td><td>{{weld.repairs}} 次<small class="block" *ngIf="weld.repairs >= 2">重复返修关注</small></td><td><p-tag [value]="weld.status" [severity]="weld.status === '合格' || weld.status === '已关闭' ? 'success' : weld.status === '返修中' ? 'danger' : 'warn'" /></td></tr></ng-template></p-table></section>
      <aside class="card"><h2 class="panel-title">规则预警</h2><div class="warning-row" *ngFor="let weld of warningWelds"><i [class.red]="!weld.qualificationValid || weld.repairs >= 2"></i><div><b>{{weld.id}} {{weld.component}}</b><p>{{warningText(weld)}}</p></div></div><p-button label="生成处置任务" icon="pi pi-check-square" styleClass="w-full" /></aside></div>
    </main>
  `,
  styles:[`.block{display:block;color:#7a8798;margin-top:3px}.warning-row{display:flex;gap:10px;padding:12px 0;border-bottom:1px solid #edf0f5}.warning-row i{width:6px;border-radius:5px;background:#f59e0b;flex:none}.warning-row i.red{background:#ef4444}.warning-row div{flex:1}.warning-row p{margin:4px 0 0;font-size:13px}.warning-row .p-button{width:100%}`],
})
export class OverviewComponent {
  private readonly ledger = inject(LedgerService)
  state!: LedgerState
  filter = '全部'
  statusOptions = ['全部','待检测','合格','返修中','待复检','已关闭']
  constructor() { this.ledger.ledger$.subscribe((state) => this.state = state) }
  get filtered() { return this.filter === '全部' ? this.state.welds : this.state.welds.filter((item) => item.status === this.filter) }
  get pending() { return this.state.welds.filter((item) => ['待检测','返修中','待复检'].includes(item.status)).length }
  get warnings() { return this.warningWelds.length }
  get occupiedCount() { return new Set(this.state.occupancy.filter((o) => o.status === '预占').map((o) => o.weldId)).size }
  get warningWelds() { return this.state.welds.filter((item) => !item.qualificationValid || item.inspectionRatio < item.requiredRatio || item.repairs >= 2) }
  warningText(weld: Weld) {
    const parts: string[] = []
    if (!weld.qualificationValid) parts.push(`焊工证书 ${weld.qualification} 到期，不得列入后续检测计划`)
    if (weld.inspectionRatio < weld.requiredRatio) parts.push(`检测比例 ${weld.inspectionRatio}% 不足 ${weld.requiredRatio}%`)
    if (weld.repairs >= 2) parts.push('同一位置二次返修，需确认返修工艺')
    return parts.join('；')
  }
  applyFilter(status: string) { this.filter = status; this.ledger.setStatusFilter(status) }
  select(weld: Weld | Weld[] | undefined) { if (weld && !Array.isArray(weld)) this.ledger.selectWeld(weld.id) }
}
