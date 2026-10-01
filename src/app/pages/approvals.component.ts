import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Store } from '@ngrx/store'
import { ButtonModule } from 'primeng/button'
import { TimelineModule } from 'primeng/timeline'
import { TagModule } from 'primeng/tag'
import { TableModule } from 'primeng/table'
import { WeldState } from '../store/weld.reducer'
import * as A from '../store/weld.actions'

@Component({
  selector:'app-approvals', standalone:true, imports:[CommonModule,ButtonModule,TimelineModule,TagModule,TableModule],
  template:`
    <main class="page"><div class="page-head"><div><p class="eyebrow">签字、版本与追溯</p><h1>逐段确认与锁定</h1><p>计划因检测比例不足退回待重排时，原审核结论保留留痕，并标出导致失效的检测结果来源。</p></div><p-button [label]="state.locked ? '已锁定' : '签字锁定检测批次'" icon="pi pi-lock" [disabled]="state.locked" (onClick)="lock()" /></div>
      <div class="grid-2"><section class="card"><h2 class="panel-title">待审核焊缝</h2><div class="review" *ngFor="let weld of reviewWelds"><div><b>{{weld.id}} · {{weld.component}}</b><small>{{weld.method}} · {{weld.welder}} · 返修 {{weld.repairs}} 次</small></div><p-tag [value]="weld.status" [severity]="weld.status === '待复检' ? 'warn' : 'danger'" /><p-button label="要求复检" severity="danger" text size="small" /><p-button label="确认合格" size="small" (onClick)="confirm(weld.id)" /></div><p class="muted" *ngIf="!reviewWelds.length">暂无待审核焊缝。</p><p-button label="导出质量追溯包" icon="pi pi-file-export" severity="secondary" styleClass="w-full" /></section>
      <aside class="card"><h2 class="panel-title">审核结论效力</h2>
        <div class="conclusion" *ngFor="let event of invalidatedConclusions">
          <div class="c-head"><b>{{event.actor}} · {{event.action}}</b><p-tag value="已失效" severity="danger" /></div>
          <p><strong>{{event.target}}</strong>：{{event.detail}}</p>
          <p class="src"><i class="pi pi-flag"></i> 失效来源：检测结果 <b>{{event.invalidatedBy}}</b><span *ngIf="event.invalidatedAt"> · {{event.invalidatedAt | date:'short'}}</span></p>
          <p class="muted">{{event.invalidReason}}</p>
        </div>
        <p class="muted" *ngIf="!invalidatedConclusions.length">尚无失效结论；原结论在比例复算不达标时保留并标记来源。</p>
      </aside></div>

      <section class="card mt-4"><h2 class="panel-title">完整审计时间线</h2><p-timeline [value]="state.audit" align="left"><ng-template #content let-event><div class="audit" [class.invalid]="event.valid === false"><div><b>{{event.actor}} · {{event.action}}</b><span>{{event.time}}</span></div><p><strong>{{event.target}}</strong> {{event.detail}}</p><p class="invalidation" *ngIf="event.valid === false"><i class="pi pi-ban"></i> 该结论已被检测结果 <b>{{event.invalidatedBy}}</b> 判定失效：{{event.invalidReason}}</p></div></ng-template></p-timeline></section>

      <section class="card mt-4"><h2 class="panel-title">写入请求台账（按请求号幂等）</h2>
        <p-table [value]="state.requests" [paginator]="true" [rows]="6">
          <ng-template #header><tr><th>请求号</th><th>业务</th><th>阶段</th><th>状态</th><th>说明</th><th>原占用计划</th></tr></ng-template>
          <ng-template #body let-r><tr><td>{{r.requestId}}</td><td>{{r.kind}}</td><td>{{r.phase}}</td><td><p-tag [value]="r.status" [severity]="reqSeverity(r.status)" /></td><td>{{r.detail}}<small class="block muted" *ngIf="r.errorMessage">{{r.errorMessage}}</small></td><td><b *ngIf="r.conflictPlanId">{{r.conflictPlanId}}</b><span class="muted" *ngIf="!r.conflictPlanId">—</span></td></tr></ng-template>
          <ng-template #emptymessage><tr><td class="muted">暂无写入请求。</td></tr></ng-template>
        </p-table>
      </section>

      <section class="card mt-4"><h2 class="panel-title">版本快照</h2><div class="snapshot"><div><b>v{{state.version}}</b><small>当前工作版本 · {{state.welds.length}} 条焊缝 · {{state.plans.length}} 个检测计划 · {{state.occupancies.length}} 条占用账</small></div><p-tag [value]="state.locked ? '已签字锁定' : '可编辑'" [severity]="state.locked ? 'success' : 'warn'" /><p-button label="查看差异" text /></div><p>版本快照记录焊缝状态、缺陷、返修方案、附件哈希和签字人。任何后续修改必须从当前版本派生新修订，不覆盖原始检测记录。</p></section>
    </main>
  `,
  styles:[`.review{display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;padding:12px 0;border-bottom:1px solid #edf0f5}.review b,.review small{display:block}.review small{color:#7a8798;margin-top:4px}
  .audit{background:#fff;border:1px solid #e1e7ef;border-radius:6px;padding:10px}.audit.invalid{background:#fef2f2;border-color:#fecaca}.audit>div{display:flex;justify-content:space-between}.audit span{color:#7a8798;font-size:12px}.audit p{margin:5px 0 0;font-size:13px}.invalidation{color:#991b1b !important}
  .conclusion{border:1px solid #fecaca;background:#fef2f2;border-radius:8px;padding:10px 12px;margin-bottom:10px}.c-head{display:flex;justify-content:space-between;align-items:center}.conclusion p{margin:6px 0 0;font-size:13px}.conclusion .src{color:#991b1b}.block{display:block}.muted{color:#7a8798;font-size:12px}
  .snapshot{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;padding:12px;background:#f8fafc;border-radius:6px}.snapshot b,.snapshot small{display:block}.snapshot small{color:#7a8798;margin-top:4px}.mt-4{margin-top:16px}@media(max-width:760px){.review{grid-template-columns:1fr auto}.review .p-button{width:100%}}`],
})
export class ApprovalsComponent {
  private readonly store = inject(Store<{ welds: WeldState }>)
  state!: WeldState
  constructor() { this.store.select('welds').subscribe((state) => this.state = state) }
  get reviewWelds() { return (this.state?.welds ?? []).filter((item) => ['待复检','返修中','待检测','待重排'].includes(item.status)) }
  get invalidatedConclusions() { return (this.state?.audit ?? []).filter((event) => event.valid === false) }
  reqSeverity(status: string) {
    if (status === '已提交' || status === '已完成') return 'success'
    if (status === '写入失败待重试') return 'warn'
    if (status === '已拒绝') return 'danger'
    return 'info'
  }
  confirm(id: string) { this.store.dispatch(A.advanceWeld({ id, status:'合格' })) }
  lock() { this.store.dispatch(A.lockBaseline()) }
}
