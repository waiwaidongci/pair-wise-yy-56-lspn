import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { InputTextModule } from 'primeng/inputtext'
import { TextareaModule } from 'primeng/textarea'
import { SelectButtonModule } from 'primeng/selectbutton'
import { WeldState } from '../store/weld.reducer'
import * as A from '../store/weld.actions'
import { OccupancyLedgerService } from '../services/occupancy-ledger.service'
import { LateResultError, PlanRejectedError, type SlotPeriod, type SubmitResultInput } from '../types'

interface ResultForm {
  requestId: string
  reportNo: string
  weldId: string
  method: string
  date: string
  period: SlotPeriod
  verdict: '合格' | '不合格'
  coverage: number
  detail: string
  failWrite: boolean
}

@Component({
  selector:'app-inspections', standalone:true, imports:[CommonModule,FormsModule,TableModule,TagModule,ButtonModule,DialogModule,InputTextModule,TextareaModule,SelectButtonModule],
  template:`
    <main class="page"><div class="page-head"><div><p class="eyebrow">NDT / 返修闭环</p><h1>检测计划与检测结果</h1><p>焊缝、检测计划、检测结果共用一份占用账：结果必须命中预占，晚到的结果不会把已排计划算成已完成。</p></div><p-button label="新增检测结果" icon="pi pi-plus" (onClick)="openDialog()" /></div>
      <div class="grid-2">
        <section class="card"><h2 class="panel-title">批量检测计划（占用账）</h2>
          <p-table [value]="state.plans" [paginator]="true" [rows]="6">
            <ng-template #header><tr><th>计划编号</th><th>日期 / 时段</th><th>方法</th><th>焊缝</th><th>检测人</th><th>状态</th></tr></ng-template>
            <ng-template #body let-plan><tr><td>{{plan.id}}<small class="block muted">请求号 {{plan.requestId}}</small></td><td>{{plan.date}}<small class="block muted">{{plan.period}}</small></td><td>{{plan.method}}</td><td>{{plan.weldIds.length}} 条</td><td>{{plan.inspector}}</td><td><p-tag [value]="plan.state" [severity]="severity(plan.state)" /></td></tr>
            <tr *ngIf="plan.state === '待重排'"><td colspan="6" class="resched"><i class="pi pi-undo"></i> {{plan.rescheduleReason}}</td></tr></ng-template>
          </p-table>
        </section>
        <aside class="card"><h2 class="panel-title">返修状态流转</h2><div class="step" *ngFor="let weld of repairWelds"><div><b>{{weld.id}} · {{weld.component}}</b><small>{{weld.defects.length}} 个缺陷 · 已返修 {{weld.repairs}} 次</small></div><p-tag [value]="weld.status" severity="warn" /><p-selectbutton [options]="['返修中','待复检','合格']" [ngModel]="weld.status" (ngModelChange)="advance(weld.id,$event)" /></div><p class="muted" *ngIf="!repairWelds.length">暂无返修中的焊缝。</p></aside>
      </div>

      <section class="card mt-4"><h2 class="panel-title">检测结果入账记录</h2>
        <p-table [value]="state.results" [paginator]="true" [rows]="8">
          <ng-template #header><tr><th>结果编号</th><th>报告号</th><th>焊缝 / 方法</th><th>日期 / 时段</th><th>结论 / 覆盖</th><th>占用账核对</th><th>请求号</th></tr></ng-template>
          <ng-template #body let-r><tr><td>{{r.id}}</td><td>{{r.reportNo}}</td><td>{{r.weldId}} · {{r.method}}</td><td>{{r.date}} {{r.period}}</td><td><p-tag [value]="r.verdict" [severity]="r.verdict === '合格' ? 'success' : 'danger'" /><small class="block muted">覆盖 {{r.coverage}}%</small></td><td><p-tag [value]="r.state" [severity]="r.state === '已确认' ? 'success' : 'warn'" /><small class="block muted" *ngIf="r.planId">命中计划 {{r.planId}}</small><small class="block muted" *ngIf="!r.planId">无有效预占，计划状态不动</small></td><td>{{r.requestId}}</td></tr></ng-template>
          <ng-template #emptymessage><tr><td class="muted">暂无检测结果。</td></tr></ng-template>
        </p-table>
      </section>

      <section class="card mt-4"><h2 class="panel-title">检测结果与缺陷明细</h2><p-table [value]="defects" [paginator]="true" [rows]="8"><ng-template #header><tr><th>缺陷编号</th><th>焊缝</th><th>位置 / 长度</th><th>类型 / 等级</th><th>检测方法</th><th>报告</th><th>处置</th></tr></ng-template><ng-template #body let-item><tr><td>{{item.defect.id}}</td><td>{{item.weld.id}}</td><td>{{item.defect.position}}% · {{item.defect.length}}mm</td><td>{{item.defect.type}} · {{item.defect.level}}</td><td>{{item.defect.method}}</td><td>{{item.defect.report}}</td><td><p-button label="退回方案" severity="danger" size="small" text /><p-button label="确认复检" size="small" (onClick)="advance(item.weld.id,'合格')" /></td></tr></ng-template></p-table></section>

      <p-dialog header="录入检测结果（核对占用账）" [(visible)]="dialog" [modal]="true" [style]="{width:'640px'}">
        <div class="form">
          <label>请求号（写入失败后凭此号重试）</label>
          <input pInputText [(ngModel)]="form.requestId" />
          <div class="row"><div><label>报告编号</label><input pInputText [(ngModel)]="form.reportNo" /></div>
          <div><label>焊缝编号</label><input pInputText [(ngModel)]="form.weldId" /></div></div>
          <div class="row"><div><label>检测方法</label><select [(ngModel)]="form.method"><option>UT</option><option>MT</option><option>PT</option></select></div>
          <div><label>结论</label><select [(ngModel)]="form.verdict"><option>合格</option><option>不合格</option></select></div></div>
          <div class="row"><div><label>检测日期</label><input type="date" [(ngModel)]="form.date" /></div>
          <div><label>时段</label><select [(ngModel)]="form.period"><option>上午</option><option>下午</option><option>夜班</option></select></div></div>
          <label>本次检测覆盖比例（%，复算时按焊缝取最大值）</label>
          <input pInputText type="number" min="0" max="100" [(ngModel)]="form.coverage" />
          <label>说明 / 缺陷</label><textarea pTextarea [(ngModel)]="form.detail" rows="3"></textarea>
          <label class="check"><input type="checkbox" [(ngModel)]="form.failWrite" /> 模拟首次写入失败（演示按请求号重试）</label>

          <div class="alert" [class.ok]="matched" [class.warn]="!matched">
            <p *ngIf="matched"><i class="pi pi-check-circle"></i> 占用账核对通过：命中计划 <b>{{matched!.planId}}</b>（占用 {{matched!.id}}），提交后确认结果并复算比例。</p>
            <p *ngIf="!matched"><i class="pi pi-exclamation-triangle"></i> 占用账中没有 {{form.weldId}} × {{form.method}} × {{form.date}} {{form.period}} 的有效预占——该结果将记为「结果迟到」，<b>不会</b>把已排计划算成已完成。</p>
          </div>
          <div class="alert danger" *ngIf="errorMsg"><b>{{errorTitle}}</b><p>{{errorMsg}}</p></div>
          <div class="alert warn2" *ngIf="retryHint"><p>{{retryHint}}</p><p-button label="按请求号重试（不重复入账）" icon="pi pi-refresh" size="small" (onClick)="retry()" /></div>
        </div>
        <ng-template #footer><p-button label="取消" severity="secondary" (onClick)="dialog=false" /><p-button label="提交结果" [loading]="saving" [disabled]="!form.weldId || !form.reportNo" (onClick)="submit()" /></ng-template>
      </p-dialog>
    </main>
  `,
  styles:[`.step{display:grid;grid-template-columns:1fr auto;gap:9px;padding:12px 0;border-bottom:1px solid #edf0f5}.step>div,.step small{display:block}.step small{color:#7a8798;margin-top:4px}.step p-selectbutton{grid-column:1/-1}.form{display:grid;gap:9px}.form input,.form select,.form textarea{padding:9px;border:1px solid #cbd5e1;border-radius:6px;width:100%}.form .row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.form label{font-size:13px;color:#475569}.check{display:flex;align-items:center;gap:6px}.check input{width:auto}.block{display:block}.muted{color:#7a8798;font-size:12px}.resched{background:#fffbeb;color:#92400e;font-size:12px;padding:8px 12px}.mt-4{margin-top:16px}
  .alert{border-radius:8px;padding:10px 12px;font-size:13px}.alert.ok{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534}.alert.warn{background:#fffbeb;border:1px solid #fde68a;color:#92400e}.alert.danger{background:#fef2f2;border:1px solid #fecaca;color:#991b1b}.alert.warn2{background:#fffbeb;border:1px solid #fde68a;color:#92400e}.alert p{margin:2px 0}`],
})
export class InspectionsComponent {
  private readonly store = inject(Store<{ welds: WeldState }>)
  private readonly ledger = inject(OccupancyLedgerService)
  state!: WeldState
  dialog = false
  saving = false
  form: ResultForm = this.freshForm()
  errorMsg = ''
  errorTitle = ''
  retryHint = ''
  private lastInput?: SubmitResultInput

  constructor() { this.store.select('welds').subscribe((state) => this.state = state) }

  private freshForm(): ResultForm {
    return { requestId:`REQ-RESULT-${Date.now().toString(36)}`, reportNo:`UT-2026-0930-${Math.floor(Math.random()*90+10)}`, weldId:'W-104', method:'UT', date:'2026-09-29', period:'下午', verdict:'不合格', coverage:10, detail:'端部回波超标，长度 14mm，Ⅲ级，需返修后复检。', failWrite:false }
  }
  openDialog() { this.form = this.freshForm(); this.dialog = true; this.errorMsg = this.retryHint = '' }

  get repairWelds() { return (this.state?.welds ?? []).filter((item) => ['返修中','待复检','待重排'].includes(item.status)) }
  get defects() { return (this.state?.welds ?? []).flatMap((weld) => weld.defects.map((defect) => ({ weld, defect }))) }
  severity(state: string) { return state === '已完成' ? 'success' : state === '执行中' ? 'info' : state === '待重排' ? 'warn' : 'secondary' }

  /** 结果与占用账实时核对 */
  get matched() {
    const key = this.form.method.split('+')[0].trim()
    return (this.state?.occupancies ?? []).find((o) =>
      o.weldId === this.form.weldId && o.method === key
      && o.date === this.form.date && o.period === this.form.period && o.state !== '待重排')
  }

  advance(id: string, status: string) { this.store.dispatch(A.advanceWeld({ id, status: status as never })) }

  private buildInput(): SubmitResultInput {
    return { ...this.form }
  }

  submit() {
    const input = this.buildInput()
    this.lastInput = input
    this.errorMsg = this.retryHint = ''
    this.saving = true
    this.ledger.submitResult(input).then(() => {
      this.saving = false
      this.dialog = false
    }).catch((err) => {
      this.saving = false
      if (err instanceof PlanRejectedError && err.code === 'WRITE_FAILED') { this.retryHint = err.message; return }
      if (err instanceof LateResultError) {
        // 迟到结果已登记在账（不冲销计划），关闭对话框即可在结果表看到
        this.dialog = false
        return
      }
      this.errorTitle = '结果提交失败'
      this.errorMsg = err instanceof Error ? err.message : String(err)
    })
  }

  retry() {
    if (!this.lastInput) return
    this.saving = true
    this.retryHint = this.errorMsg = ''
    this.ledger.submitResult({ ...this.lastInput, requestId: this.form.requestId, failWrite:false })
      .then(() => { this.saving = false; this.dialog = false })
      .catch((err) => {
        this.saving = false
        if (err instanceof LateResultError) { this.dialog = false; return }
        this.errorTitle = '重试失败'
        this.errorMsg = err instanceof Error ? err.message : String(err)
      })
  }
}
