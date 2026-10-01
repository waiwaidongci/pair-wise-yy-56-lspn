import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { ButtonModule } from 'primeng/button'
import { TimelineModule } from 'primeng/timeline'
import { TagModule } from 'primeng/tag'
import { ToastModule } from 'primeng/toast'
import { MessageService } from 'primeng/api'
import { LedgerService, type LedgerState, type WriteOutcome } from '../services/ledger.service'

@Component({
  selector:'app-approvals', standalone:true, imports:[CommonModule,ButtonModule,TimelineModule,TagModule,ToastModule],
  template:`
    <p-toast position="top-center" />
    <main class="page"><div class="page-head"><div><p class="eyebrow">签字、版本与追溯</p><h1>逐段确认与锁定</h1><p>审核人按焊缝或检测计划确认、退回或要求复检；锁定后生成只读版本快照。结论失效不删除，保留原位并标出失效来源。</p></div><p-button [label]="state.locked ? '已锁定' : '签字锁定检测批次'" icon="pi pi-lock" [disabled]="state.locked" (onClick)="lock()" /></div>
      <div class="grid-2"><section class="card"><h2 class="panel-title">待审核焊缝</h2><div class="review" *ngFor="let weld of reviewWelds"><div><b>{{weld.id}} · {{weld.component}}</b><small>{{weld.method}} · {{weld.welder}} · 返修 {{weld.repairs}} 次 · 比例 {{weld.inspectionRatio}}%/{{weld.requiredRatio}}%</small></div><p-tag [value]="weld.status" [severity]="weld.status === '待复检' ? 'warn' : 'danger'" /><p-button label="要求复检" severity="danger" text size="small" /><p-button label="确认合格" size="small" (onClick)="confirm(weld.id)" /></div><p-button label="导出质量追溯包" icon="pi pi-file-export" severity="secondary" styleClass="w-full" /></section>
      <aside class="card"><h2 class="panel-title">完整审计时间线</h2><p-timeline [value]="state.audit" align="left"><ng-template #content let-event><div class="audit" [class.invalid]="event.invalid"><div><b>{{event.actor}} · {{event.action}}</b><span>{{event.time}}</span></div><p><strong>{{event.target}}</strong> {{event.detail}}</p><p-tag *ngIf="event.invalid" value="已失效" severity="danger" icon="pi pi-ban" /><span class="invalid-source" *ngIf="event.invalid">失效来源：{{event.invalidSource}}</span></div></ng-template></p-timeline></aside></div>
      <section class="card mt-4"><h2 class="panel-title">版本快照</h2><div class="snapshot"><div><b>v{{state.version}}</b><small>当前工作版本 · {{state.welds.length}} 条焊缝 · {{state.plans.length}} 个检测计划 · {{state.occupancy.length}} 条占用账</small></div><p-tag [value]="state.locked ? '已签字锁定' : '可编辑'" [severity]="state.locked ? 'success' : 'warn'" /><p-button label="查看差异" text /></div><p>版本快照记录焊缝状态、缺陷、返修方案、附件哈希和签字人。任何后续修改必须从当前版本派生新修订，不覆盖原始检测记录；结果更新导致结论失效时，结论保留原位并标注来源。</p></section>
    </main>
  `,
  styles:[`.review{display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;padding:12px 0;border-bottom:1px solid #edf0f5}.review b,.review small{display:block}.review small{color:#7a8798;margin-top:4px}.audit{background:#fff;border:1px solid #e1e7ef;border-radius:6px;padding:10px}.audit>div{display:flex;justify-content:space-between}.audit span{color:#7a8798;font-size:12px}.audit p{margin:5px 0 0;font-size:13px}.audit.invalid{background:#fef2f2;border-color:#fca5a5}.audit.invalid b{text-decoration:line-through;color:#b91c1c}.invalid-source{display:inline-block;margin-top:6px;font-size:12px;color:#b91c1c}.snapshot{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;padding:12px;background:#f8fafc;border-radius:6px}.snapshot b,.snapshot small{display:block}.snapshot small{color:#7a8798;margin-top:4px}.mt-4{margin-top:16px}@media(max-width:760px){.review{grid-template-columns:1fr auto}.review .p-button{width:100%}}`],
})
export class ApprovalsComponent {
  private readonly ledger = inject(LedgerService)
  private readonly toast = inject(MessageService)
  state!: LedgerState
  constructor() { this.ledger.ledger$.subscribe((state) => this.state = state) }
  get reviewWelds() { return this.state.welds.filter((item) => ['待复检','返修中','待检测'].includes(item.status)) }

  private handleFailure(outcome: Exclude<WriteOutcome, { ok:true }>) {
    if (outcome.reason === 'conflict') {
      this.toast.add({ severity:'warn', summary:'版本冲突', detail:`保存未放行（v${outcome.currentVersion}），请刷新后重试`, life:6000 })
    } else {
      this.toast.add({ severity:'error', summary:'操作失败', detail: outcome.reason === 'not_found' ? outcome.message : outcome.reason })
    }
  }

  confirm(id: string) {
    const requestId = this.ledger.newRequestId()
    this.ledger.setWeldStatus({ requestId, baseVersion:this.ledger.snapshot.version, weldId:id, status:'合格', actor:'质量负责人' }).then((outcome) => {
      if (outcome.ok) this.toast.add({ severity:'success', summary:'已确认合格', detail:`焊缝 ${id} 审核结论已留痕（请求号 ${outcome.requestId}）`, life:5000 })
      else this.handleFailure(outcome)
    })
  }

  lock() {
    const requestId = this.ledger.newRequestId()
    this.ledger.lockBaseline({ requestId, baseVersion:this.ledger.snapshot.version, actor:'质量负责人' }).then((outcome) => {
      if (outcome.ok) this.toast.add({ severity:'success', summary:'已签字锁定', detail:`检测批次已锁定（请求号 ${outcome.requestId}）`, life:5000 })
      else this.handleFailure(outcome)
    })
  }
}
