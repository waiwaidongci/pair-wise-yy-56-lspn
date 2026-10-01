import { Component, EventEmitter, Input, Output, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { SelectModule } from 'primeng/select'
import { MultiSelectModule } from 'primeng/multiselect'
import { ToastModule } from 'primeng/toast'
import { MessageService } from 'primeng/api'
import { LedgerService, METHOD_SLOT_CAPACITY, type WriteOutcome } from './services/ledger.service'

interface PlanForm {
  method: string
  date: string
  inspector: string
  weldIds: string[]
}

@Component({
  selector:'app-plan-create-dialog',
  standalone:true,
  imports:[CommonModule,FormsModule,DialogModule,ButtonModule,SelectModule,MultiSelectModule,ToastModule],
  template:`
    <p-toast position="top-center" />
    <p-dialog [header]="header" [visible]="visible" (visibleChange)="onVisibleChange($event)" [modal]="true" [style]="{width:'580px'}" (onShow)="onShow()">
      <div class="dialog-form">
        <label>检测方法</label>
        <p-select [options]="methodOptions" [(ngModel)]="form.method" optionLabel="label" optionValue="value" />
        <label>计划日期（时段）</label>
        <input type="date" [(ngModel)]="form.date" />
        <label>检测人员</label>
        <p-select [options]="inspectorOptions" [(ngModel)]="form.inspector" optionLabel="label" optionValue="value" />
        <label>预占焊缝（占用账按方法 + 时段容量校验）</label>
        <p-multiSelect [options]="weldOptions" [(ngModel)]="form.weldIds" optionLabel="label" optionValue="id" [filter]="true" placeholder="选择焊缝" />
        <p class="cap-hint">时段容量 {{ capacity.used }}/{{ capacity.total }}（{{ form.method }} · {{ form.date }}）</p>
        <p class="req-hint">请求号：{{ requestId }}</p>
        <div class="conflict" *ngIf="conflict">
          <div><i class="pi pi-exclamation-triangle"></i> 本次保存未放行：版本冲突（对方已提交至 v{{ conflict.currentVersion }}）。写入结果不确定时，可按原请求号重试，不会重复占位。</div>
          <p-button label="按请求号重试" icon="pi pi-refresh" size="small" [loading]="saving" (onClick)="retry()" />
        </div>
      </div>
      <ng-template #footer>
        <p-button label="取消" severity="secondary" (onClick)="close()" />
        <p-button label="保存并预占" [loading]="saving" (onClick)="save()" />
      </ng-template>
    </p-dialog>
  `,
  styles:[`
    .dialog-form{display:grid;gap:8px}.dialog-form input,.dialog-form select{padding:9px;border:1px solid #cbd5e1;border-radius:6px;width:100%}
    .cap-hint{margin:2px 0 0;color:#2563eb;font-size:12px}.req-hint{margin:0;color:#7a8798;font-size:12px}
    .conflict{margin-top:6px;padding:10px;border:1px solid #fca5a5;background:#fef2f2;border-radius:6px;font-size:13px;color:#b91c1c;display:grid;gap:8px}
  `],
})
export class PlanCreateDialogComponent {
  private readonly ledger = inject(LedgerService)
  private readonly toast = inject(MessageService)

  @Input() header = '生成批量检测计划'
  @Input() visible = false
  @Output() visibleChange = new EventEmitter<boolean>()
  @Output() saved = new EventEmitter<void>()

  readonly methodOptions = [
    { label:'UT 超声检测', value:'UT' },
    { label:'MT 磁粉检测', value:'MT' },
    { label:'PT 渗透检测', value:'PT' },
    { label:'UT + MT', value:'UT + MT' },
  ]
  readonly inspectorOptions = [
    { label:'陈锋', value:'陈锋' },
    { label:'赵岚', value:'赵岚' },
  ]
  form: PlanForm = { method:'UT', date:'2026-09-30', inspector:'陈锋', weldIds:[] }
  requestId = ''
  saving = false
  conflict: Extract<WriteOutcome, { ok:false; reason:'conflict' }> | null = null

  get weldOptions() {
    return this.ledger.snapshot.welds.map((w) => ({ id:w.id, label:`${w.id} · ${w.component}（${w.method}）` }))
  }

  get capacity() {
    const { used, capacity:total } = this.ledger.slotUsage(this.form.method, this.form.date)
    return { used, total }
  }

  onVisibleChange(v: boolean) {
    this.visible = v
    this.visibleChange.emit(v)
  }

  close() {
    this.onVisibleChange(false)
  }

  onShow() {
    this.form = { method:'UT', date:'2026-09-30', inspector:'陈锋', weldIds:[] }
    this.conflict = null
    this.requestId = this.ledger.newRequestId()
  }

  private async submit() {
    this.saving = true
    const outcome = await this.ledger.createPlan({
      requestId:this.requestId,
      baseVersion:this.ledger.snapshot.version,
      date:this.form.date,
      method:this.form.method,
      weldIds:this.form.weldIds,
      inspector:this.form.inspector,
    })
    this.saving = false
    if (!outcome.ok) {
      this.handleFailure(outcome)
      return
    }
    if (outcome.kind !== 'plan') return
    this.toast.add({ severity:'success', summary:'计划已预占', detail:`${outcome.plan.id} · ${outcome.occupancy.length} 条焊缝写入占用账（请求号 ${outcome.requestId}）`, life:6000 })
    this.saved.emit()
    this.close()
  }

  save() {
    if (!this.form.weldIds.length) {
      this.toast.add({ severity:'warn', summary:'请选择焊缝', detail:'至少选择一条需要预占的焊缝' })
      return
    }
    this.submit()
  }

  retry() {
    this.submit()
  }

  private handleFailure(outcome: Exclude<WriteOutcome, { ok:true }>) {
    switch (outcome.reason) {
      case 'duplicate':
        this.toast.add({ severity:'error', summary:'重复占用未放行', detail:`焊缝 ${outcome.weldId} 已被计划 ${outcome.originalPlanId}（${outcome.originalPlanDate} · ${outcome.method}）预占，不能重复占位`, life:8000 })
        break
      case 'capacity':
        this.toast.add({ severity:'error', summary:'时段容量不足', detail:`${outcome.method} 方法在 ${outcome.date} 时段容量已满（已用 ${outcome.used}/${outcome.capacity}）`, life:8000 })
        break
      case 'conflict':
        this.conflict = outcome
        break
      case 'mismatch':
        this.toast.add({ severity:'error', summary:'请求号冲突', detail:'该请求号已被内容不同的写入使用，请重新打开对话框生成新请求号', life:8000 })
        break
      case 'not_found':
        this.toast.add({ severity:'error', summary:'焊缝不存在', detail:outcome.message })
        break
      case 'not_occupied':
        this.toast.add({ severity:'warn', summary:'结果未入账', detail:outcome.message, life:8000 })
        break
    }
  }
}
