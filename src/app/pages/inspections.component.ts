import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { InputTextModule } from 'primeng/inputtext'
import { InputNumberModule } from 'primeng/inputnumber'
import { TextareaModule } from 'primeng/textarea'
import { SelectModule } from 'primeng/select'
import { SelectButtonModule } from 'primeng/selectbutton'
import { ToastModule } from 'primeng/toast'
import { MessageService } from 'primeng/api'
import { LedgerService, type LedgerState, type WriteOutcome } from '../services/ledger.service'
import { PlanCreateDialogComponent } from '../plan-create-dialog.component'
import type { DefectLevel, InspectionPlan, WeldStatus } from '../types'

@Component({
  selector:'app-inspections', standalone:true,
  imports:[CommonModule,FormsModule,TableModule,TagModule,ButtonModule,DialogModule,InputTextModule,InputNumberModule,TextareaModule,SelectModule,SelectButtonModule,ToastModule,PlanCreateDialogComponent],
  template:`
    <p-toast position="top-center" />
    <main class="page"><div class="page-head"><div><p class="eyebrow">NDT / 返修闭环</p><h1>检测计划与返修</h1><p>焊缝、检测计划、检测结果共用一份占用账：计划按方法与时段容量预占，结果凭预占账核销，不足退回待重排。</p></div>
      <div class="head-actions"><p-button label="模拟两人同时保存" icon="pi pi-users" severity="secondary" outlined (onClick)="simulateConcurrent()" /><p-button label="新增检测结果" icon="pi pi-plus" (onClick)="openResultDialog()" /><p-button label="新建检测计划" icon="pi pi-calendar-plus" (onClick)="planDialog = true" /></div></div>

      <div class="grid-2"><section class="card"><h2 class="panel-title">批量检测计划（占用账预占）</h2><p-table [value]="state.plans" [paginator]="true" [rows]="6"><ng-template #header><tr><th>计划编号</th><th>日期（时段）</th><th>方法</th><th>焊缝</th><th>检测人</th><th>状态</th><th>失效说明</th></tr></ng-template><ng-template #body let-plan><tr><td>{{plan.id}}</td><td>{{plan.date}}</td><td>{{plan.method}}</td><td>{{plan.weldIds.length}} 条</td><td>{{plan.inspector}}</td><td><p-tag [value]="plan.state" [severity]="planStateSeverity(plan.state)" /></td><td class="invalid-note">{{ invalidNote(plan) }}</td></tr></ng-template></p-table></section>
      <aside class="card"><h2 class="panel-title">返修状态流转</h2><div class="step" *ngFor="let weld of repairWelds"><div><b>{{weld.id}} · {{weld.component}}</b><small>{{weld.defects.length}} 个缺陷 · 已返修 {{weld.repairs}} 次 · 比例 {{weld.inspectionRatio}}%/{{weld.requiredRatio}}%</small></div><p-tag [value]="weld.status" severity="warn" /><p-selectbutton [options]="['返修中','待复检','合格']" [ngModel]="weld.status" (ngModelChange)="advance(weld.id,$event)" /></div><p-button label="提交质量负责人审核" icon="pi pi-send" styleClass="w-full" /></aside></div>

      <section class="card mt-4"><h2 class="panel-title">占用账（焊缝 · 方法 · 时段）</h2><p-table [value]="state.occupancy" [paginator]="true" [rows]="8"><ng-template #header><tr><th>占用编号</th><th>焊缝</th><th>检测方法</th><th>时段</th><th>归属计划</th><th>检测人</th><th>状态</th><th>请求号</th></tr></ng-template><ng-template #body let-occ><tr><td>{{occ.id}}</td><td><b>{{occ.weldId}}</b></td><td>{{occ.method}}</td><td>{{occ.date}}</td><td>{{occ.planId}}</td><td>{{occ.inspector}}</td><td><p-tag [value]="occ.status" [severity]="occ.status === '预占' ? 'warn' : occ.status === '已核销' ? 'success' : 'secondary'" /></td><td class="req">{{occ.requestId}}</td></tr></ng-template></p-table></section>

      <section class="card mt-4"><h2 class="panel-title">检测结果与缺陷明细</h2><p-table [value]="state.results" [paginator]="true" [rows]="8"><ng-template #header><tr><th>结果编号</th><th>归属计划</th><th>焊缝</th><th>方法</th><th>缺陷</th><th>检测长度</th><th>时间</th><th>请求号</th></tr></ng-template><ng-template #body let-res><tr><td>{{res.id}}</td><td>{{res.planId}}</td><td><b>{{res.weldId}}</b></td><td>{{res.method}}</td><td><span *ngFor="let d of res.defects" class="defect-chip">{{d.type}} · {{d.level}}</span></td><td>{{res.inspectedLength}} mm</td><td>{{res.time}}</td><td class="req">{{res.requestId}}</td></tr></ng-template></p-table></section>

      <p-dialog header="录入检测结果（凭预占账核销）" [(visible)]="resultDialog" [modal]="true" [style]="{width:'620px'}"><div class="form"><label>检测计划</label><p-select [options]="planOptions" [(ngModel)]="resultForm.planId" optionLabel="label" optionValue="value" placeholder="选择计划" (ngModelChange)="onPlanChange()" /><label>焊缝（仅显示本计划预占中的焊缝）</label><p-select [options]="weldOptions" [(ngModel)]="resultForm.weldId" optionLabel="label" optionValue="value" placeholder="选择焊缝" /><label>本次检测覆盖长度（mm）</label><p-inputnumber [(ngModel)]="resultForm.inspectedLength" [min]="10" [max]="5000" suffix=" mm" /><div class="ratio-hint" *ngIf="selectedWeld">该焊缝总长 {{selectedWeld.length}}mm · 要求比例 {{selectedWeld.requiredRatio}}% · 当前 {{selectedWeld.inspectionRatio}}%，录入后重算。</div><label>缺陷位置（0–100%）</label><input pInputText type="number" [(ngModel)]="resultForm.position" /><label>缺陷类型</label><input pInputText [(ngModel)]="resultForm.type" placeholder="如：未熔合" /><label>缺陷等级</label><p-select [options]="levelOptions" [(ngModel)]="resultForm.level" optionLabel="label" optionValue="value" /><label>检测方法</label><p-select [options]="methodOptions" [(ngModel)]="resultForm.method" optionLabel="label" optionValue="value" /><label>缺陷长度（mm）</label><p-inputnumber [(ngModel)]="resultForm.defectLength" [min]="1" suffix=" mm" /><label>报告编号与说明</label><textarea pTextarea [(ngModel)]="resultForm.report" rows="3"></textarea><p class="req-hint">请求号：{{resultRequestId}}</p><div class="conflict" *ngIf="resultConflict"><div><i class="pi pi-exclamation-triangle"></i> 本次保存未放行：版本冲突（对方已提交至 v{{resultConflict.currentVersion}}）。可按原请求号重试，不会重复核销。</div><p-button label="按请求号重试" icon="pi pi-refresh" size="small" [loading]="savingResult" (onClick)="retryResult()" /></div></div><ng-template #footer><p-button label="取消" severity="secondary" (onClick)="resultDialog = false" /><p-button label="提交结果并核销" [loading]="savingResult" [disabled]="!resultForm.planId || !resultForm.weldId" (onClick)="submitResult()" /></ng-template></p-dialog>

      <app-plan-create-dialog [(visible)]="planDialog" />
    </main>
  `,
  styles:[`.step{display:grid;grid-template-columns:1fr auto;gap:9px;padding:12px 0;border-bottom:1px solid #edf0f5}.step>div,.step small{display:block}.step small{color:#7a8798;margin-top:4px}.step p-selectbutton{grid-column:1/-1}.form{display:grid;gap:9px}.form input,.form select,.form textarea{padding:9px;border:1px solid #cbd5e1;border-radius:6px;width:100%}.mt-4{margin-top:16px}.head-actions{display:flex;gap:8px;flex-wrap:wrap}.defect-chip{display:inline-block;margin-right:6px;padding:2px 8px;background:#fff1f2;border-radius:4px;font-size:12px;color:#b91c1c}.req{font-size:12px;color:#7a8798}.req-hint{margin:0;color:#7a8798;font-size:12px}.ratio-hint{font-size:12px;color:#2563eb}.invalid-note{font-size:12px;color:#b91c1c;max-width:220px}.conflict{margin-top:6px;padding:10px;border:1px solid #fca5a5;background:#fef2f2;border-radius:6px;font-size:13px;color:#b91c1c;display:grid;gap:8px}`],
})
export class InspectionsComponent {
  private readonly ledger = inject(LedgerService)
  private readonly toast = inject(MessageService)
  state!: LedgerState
  planDialog = false
  resultDialog = false
  savingResult = false
  resultRequestId = ''
  resultConflict: Extract<WriteOutcome, { ok:false; reason:'conflict' }> | null = null
  resultForm = { planId:'', weldId:'', inspectedLength:200, position:42, type:'未熔合', level:'Ⅲ级' as DefectLevel, method:'UT', defectLength:18, report:'' }

  readonly levelOptions = [
    { label:'Ⅰ级', value:'Ⅰ级' }, { label:'Ⅱ级', value:'Ⅱ级' }, { label:'Ⅲ级', value:'Ⅲ级' }, { label:'Ⅳ级', value:'Ⅳ级' },
  ]
  readonly methodOptions = [
    { label:'UT 超声检测', value:'UT' }, { label:'MT 磁粉检测', value:'MT' }, { label:'PT 渗透检测', value:'PT' },
  ]

  constructor() {
    this.ledger.ledger$.subscribe((state) => this.state = state)
  }

  get repairWelds() { return this.state.welds.filter((w) => ['返修中','待复检'].includes(w.status)) }

  get planOptions() {
    return this.state.plans
      .filter((p) => this.state.occupancy.some((o) => o.planId === p.id && o.status === '预占'))
      .map((p) => ({ label:`${p.id} · ${p.method} · ${p.date}`, value:p.id }))
  }

  get weldOptions() {
    return this.state.occupancy
      .filter((o) => o.planId === this.resultForm.planId && o.status === '预占')
      .map((o) => ({ label:`${o.weldId} · ${o.method}（预占中）`, value:o.weldId }))
  }

  get selectedWeld() {
    return this.state.welds.find((w) => w.id === this.resultForm.weldId)
  }

  planStateSeverity(state: InspectionPlan['state']) {
    return state === '已完成' ? 'success' : state === '执行中' ? 'info' : state === '待重排' ? 'danger' : 'warn'
  }

  invalidNote(plan: InspectionPlan): string {
    if (plan.state !== '待重排') return ''
    const event = this.state.audit.find((a) => a.action === '计划退回待重排' && a.target === plan.id)
    return event?.detail ?? '比例不足，退回待重排'
  }

  onPlanChange() {
    this.resultForm.weldId = ''
  }

  openResultDialog() {
    this.resultForm = { planId:'', weldId:'', inspectedLength:200, position:42, type:'未熔合', level:'Ⅲ级', method:'UT', defectLength:18, report:'' }
    this.resultConflict = null
    this.resultRequestId = this.ledger.newRequestId()
    this.resultDialog = true
  }

  private async submit() {
    this.savingResult = true
    const outcome = await this.ledger.recordResult({
      requestId:this.resultRequestId,
      baseVersion:this.ledger.snapshot.version,
      planId:this.resultForm.planId,
      weldId:this.resultForm.weldId,
      inspectedLength:this.resultForm.inspectedLength,
      defects:[{
        position:this.resultForm.position, type:this.resultForm.type, length:this.resultForm.defectLength,
        level:this.resultForm.level, method:this.resultForm.method, report:this.resultForm.report,
      }],
    })
    this.savingResult = false
    if (!outcome.ok) {
      this.handleFailure(outcome)
      return
    }
    if (outcome.kind !== 'result') return
    const messages: string[] = [`${outcome.result.weldId} 预占已核销，检测比例重算为 ${this.selectedWeld?.inspectionRatio ?? '—'}%`]
    if (outcome.plan.state === '待重排') messages.push(`计划 ${outcome.plan.id} 比例不足，退回待重排`)
    if (outcome.plan.state === '已完成') messages.push(`计划 ${outcome.plan.id} 已完成`)
    if (outcome.released.length) messages.push(`已释放 ${outcome.released.join('、')} 的预占，可重新排计划`)
    this.toast.add({ severity: outcome.plan.state === '待重排' ? 'warn' : 'success', summary:'结果已入账', detail:messages.join('；'), life:8000 })
    this.resultDialog = false
  }

  submitResult() {
    if (!this.resultForm.planId || !this.resultForm.weldId) return
    this.submit()
  }

  retryResult() {
    this.submit()
  }

  private handleFailure(outcome: Exclude<WriteOutcome, { ok:true }>) {
    switch (outcome.reason) {
      case 'conflict':
        this.resultConflict = outcome
        break
      case 'not_occupied':
        this.toast.add({ severity:'warn', summary:'结果未入账', detail:outcome.message, life:8000 })
        break
      case 'duplicate':
        this.toast.add({ severity:'error', summary:'重复占用未放行', detail:`焊缝 ${outcome.weldId} 已被计划 ${outcome.originalPlanId} 预占`, life:8000 })
        break
      case 'capacity':
        this.toast.add({ severity:'error', summary:'时段容量不足', detail:`${outcome.method} 时段容量 ${outcome.used}/${outcome.capacity}`, life:8000 })
        break
      case 'mismatch':
        this.toast.add({ severity:'error', summary:'请求号冲突', detail:'该请求号已被内容不同的写入使用，请重新打开对话框', life:8000 })
        break
      case 'not_found':
        this.toast.add({ severity:'error', summary:'未找到', detail:outcome.message })
        break
    }
  }

  advance(id: string, status: string) {
    const requestId = this.ledger.newRequestId()
    this.ledger.setWeldStatus({ requestId, baseVersion:this.ledger.snapshot.version, weldId:id, status:status as WeldStatus, actor:'当前审核人' }).then((outcome) => {
      if (!outcome.ok) this.handleFailure(outcome)
    })
  }

  /** 演示两人同时保存：同版本并发提交，只放行一笔；冲突后按原请求号重试，不重复占位 */
  async simulateConcurrent() {
    const base = this.ledger.snapshot.version
    const r1 = this.ledger.newRequestId()
    const r2 = this.ledger.newRequestId()
    const cmd1 = { date:'2026-10-01', method:'UT', weldIds:['W-112'], inspector:'陈锋' }
    const cmd2 = { date:'2026-10-01', method:'UT', weldIds:['W-101'], inspector:'赵岚' }
    const [a, b] = await Promise.all([
      this.ledger.createPlan({ requestId:r1, baseVersion:base, ...cmd1 }),
      this.ledger.createPlan({ requestId:r2, baseVersion:base, ...cmd2 }),
    ])
    const first = a.ok ? a : b.ok ? b : null
    const conflictedOutcome = [a, b].find((o) => !o.ok && o.reason === 'conflict')
    const conflictedCmd = conflictedOutcome?.requestId === r1 ? cmd1 : cmd2
    if (first) {
      this.toast.add({ severity:'success', summary:'并发保存 ① 放行', detail:`请求号 ${first.requestId} 已提交（计划 ${first.kind === 'plan' ? first.plan.id : ''}）`, life:6000 })
    }
    if (conflictedOutcome && !conflictedOutcome.ok && conflictedOutcome.reason === 'conflict') {
      this.toast.add({ severity:'warn', summary:'并发保存 ② 冲突未放行', detail:`请求号 ${conflictedOutcome.requestId} 版本冲突（v${conflictedOutcome.currentVersion}），按原请求号重试…`, life:6000 })
      const retry = await this.ledger.createPlan({
        requestId:conflictedOutcome.requestId, baseVersion:this.ledger.snapshot.version, ...conflictedCmd,
      })
      if (retry.ok) {
        this.toast.add({ severity:'success', summary:'重试成功且无重复占位', detail:`请求号 ${retry.requestId} 重试放行（计划 ${retry.kind === 'plan' ? retry.plan.id : ''}），焊缝未被二次预占`, life:8000 })
      } else {
        this.handleFailure(retry)
      }
    }
  }
}
