import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { ButtonModule } from 'primeng/button'
import { TagModule } from 'primeng/tag'
import { DialogModule } from 'primeng/dialog'
import { WeldState } from '../store/weld.reducer'
import { OccupancyLedgerService, methodKeys, slotId } from '../services/occupancy-ledger.service'
import { PlanRejectedError, type CreatePlanInput, type SlotPeriod } from '../types'
import type { Weld } from '../types'

interface PlanForm {
  requestId: string
  date: string
  period: SlotPeriod
  method: string
  weldIds: string
  inspector: string
  failWrite: boolean
}

@Component({
  selector:'app-weld-map', standalone:true, imports:[CommonModule,FormsModule,ButtonModule,TagModule,DialogModule],
  template:`
    <main class="page"><div class="page-head"><div><p class="eyebrow">二维构件定位</p><h1>构件焊缝地图</h1><p>建计划即按检测方法 × 时段容量在统一占用账上预占；同一焊缝重复占用会指出原计划号，两人同时保存只放行一笔。</p></div><p-button label="批量生成检测计划" icon="pi pi-calendar-plus" (onClick)="openDialog()" /></div>
      <div class="map-grid"><section class="card drawing-card"><div class="drawing-head"><span>构件图 SG-07-屋面梁 · 展开示意</span><span>单位：mm · 比例 1:50</span></div><svg viewBox="0 0 100 90" class="weld-map"><defs><pattern id="grid" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M5 0H0V5" fill="none" stroke="#dbe2ea" stroke-width=".2"/></pattern></defs><rect x="3" y="3" width="94" height="84" fill="url(#grid)" stroke="#334155"/><path d="M8 20H92M8 42H92M8 66H92" stroke="#94a3b8" stroke-width="4"/><path d="M16 12V78M42 12V78M70 12V78M86 12V78" stroke="#cbd5e1" stroke-width="7"/><g *ngFor="let weld of state.welds"><circle [attr.cx]="weld.x" [attr.cy]="weld.y" r="3.2" [attr.fill]="color(weld)" stroke="#fff" stroke-width="1" (click)="select(weld)" /><text [attr.x]="weld.x+4" [attr.y]="weld.y-4" class="label">{{weld.id}}</text><circle *ngFor="let defect of weld.defects" [attr.cx]="weld.x + defect.position / 30" [attr.cy]="weld.y + 4" r="1.4" fill="#dc2626" /></g><text x="50" y="86" class="axis">构件长度方向 →</text></svg></section>
        <aside class="card"><h2 class="panel-title">焊缝明细</h2><div *ngIf="selected" class="detail"><div class="detail-head"><div><small>{{selected.drawing}}</small><h3>{{selected.id}} · {{selected.component}}</h3></div><p-tag [value]="selected.status" [severity]="selected.status === '合格' || selected.status === '已关闭' ? 'success' : selected.status === '返修中' ? 'danger' : 'warn'" /></div><div class="kv"><span>焊接方法</span><b>{{selected.method}} / {{selected.joint}}</b></div><div class="kv"><span>焊工</span><b>{{selected.welder}}</b></div><div class="kv"><span>检测比例</span><b [class.danger]="selected.inspectionRatio < selected.requiredRatio">{{selected.inspectionRatio}}% / {{selected.requiredRatio}}%</b></div><div class="kv"><span>返修次数</span><b>{{selected.repairs}}</b></div><h3>缺陷记录</h3><div *ngFor="let defect of selected.defects" class="defect"><b>{{defect.id}} · {{defect.type}}</b><p>位置 {{defect.position}}% · 长度 {{defect.length}}mm · {{defect.level}} · {{defect.method}}</p></div><p class="muted" *ngIf="!selected.defects.length">当前无未关闭缺陷。</p></div></aside></div>

      <section class="card mt-4"><h2 class="panel-title">时段容量占用账</h2><p class="muted">每个检测方法 × 时段有班组容量上限；退回待重排的占用自动释放。</p>
        <div class="cap-grid">
          <div class="cap" *ngFor="let cap of usedCapacities">
            <div class="cap-head"><b>{{cap.method}}</b><span>{{cap.date}} {{cap.period}}</span></div>
            <div class="bar"><i [style.width.%]="usagePct(cap.slotId)"></i></div>
            <small [class.full]="usageCount(cap.slotId) >= cap.limit">{{usageCount(cap.slotId)}} / {{cap.limit}} 条 · <ng-container *ngIf="holders(cap.slotId).length">{{holders(cap.slotId)}}</ng-container><ng-container *ngIf="!holders(cap.slotId).length">空闲</ng-container></small>
          </div>
          <p class="muted" *ngIf="!usedCapacities.length">当前尚无占用。</p>
        </div>
      </section>

      <p-dialog header="生成批量检测计划（占用账预占）" [(visible)]="planDialog" [modal]="true" [style]="{width:'620px'}">
        <div class="dialog-form">
          <label>请求号（写入失败后凭此号重试，幂等不重复占位）</label>
          <input [(ngModel)]="form.requestId" placeholder="留空自动生成；重试请保留原请求号" />
          <div class="row"><div><label>检测方法</label><select [(ngModel)]="form.method"><option>UT</option><option>MT</option><option>PT</option><option>UT + MT</option></select></div>
          <div><label>时段</label><select [(ngModel)]="form.period"><option>上午</option><option>下午</option><option>夜班</option></select></div></div>
          <div class="row"><div><label>计划日期</label><input type="date" [(ngModel)]="form.date" /></div>
          <div><label>检测人员</label><select [(ngModel)]="form.inspector"><option>陈锋</option><option>赵岚</option></select></div></div>
          <label>焊缝编号（逗号分隔）</label>
          <input [(ngModel)]="form.weldIds" placeholder="W-104,W-109" />
          <label class="check"><input type="checkbox" [(ngModel)]="form.failWrite" /> 模拟首次写入失败（用于演示按请求号重试）</label>

          <div class="preview" *ngIf="preview.length">
            <p class="muted">预检：{{form.date}} {{form.period}} · {{form.method}} · {{preview.length}} 条焊缝</p>
            <div class="pv" *ngFor="let pv of preview" [class.ok]="pv.kind==='ok'" [class.busy]="pv.kind==='busy'" [class.full]="pv.kind==='full'">
              <b>{{pv.weldId}} × {{pv.method}}</b>
              <span *ngIf="pv.kind==='ok'">可预占（容量剩余 {{pv.free}}）</span>
              <span *ngIf="pv.kind==='busy'">已被原计划 <b>{{pv.planId}}</b> 占用，重复占用将被拒绝</span>
              <span *ngIf="pv.kind==='full'">时段容量已满 {{pv.limit}} 条</span>
            </div>
          </div>

          <div class="alert danger" *ngIf="errorMsg">
            <b>{{errorTitle}}</b>
            <p>{{errorMsg}}</p>
            <p *ngIf="conflictPlanId">原占用计划号：<b>{{conflictPlanId}}</b>，请调整焊缝 / 方法 / 时段后再保存。</p>
          </div>
          <div class="alert warn" *ngIf="retryHint">
            <p>{{retryHint}}</p>
            <p-button label="按请求号重试（不重复占位）" icon="pi pi-refresh" size="small" (onClick)="retry()" />
          </div>
          <div class="alert ok" *ngIf="successMsg"><p>{{successMsg}}</p></div>
        </div>
        <ng-template #footer>
          <p-button label="取消" severity="secondary" (onClick)="planDialog = false" />
          <p-button label="保存（甲）" [loading]="saving" [disabled]="!canSubmit" (onClick)="submit(false)" />
          <p-button label="同时保存（乙）" severity="info" [loading]="saving" [disabled]="!canSubmit" (onClick)="submit(true)" />
        </ng-template>
      </p-dialog>
    </main>
  `,
  styles:[`.map-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(310px,.65fr);gap:16px}.drawing-card{padding:0;overflow:hidden}.drawing-head{display:flex;justify-content:space-between;padding:13px 16px;background:#f8fafc;border-bottom:1px solid #e1e7ef;color:#64748b;font-size:13px}.weld-map{width:100%;height:min(58vh,560px);display:block;background:#fff}.weld-map circle{cursor:pointer}.label{font-size:2.4px;font-weight:700;fill:#334155}.axis{font-size:2.2px;fill:#94a3b8}.detail-head{display:flex;justify-content:space-between}.detail-head small{color:#7a8798}.detail-head h3{margin:5px 0}.kv{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #edf0f5}.kv span{color:#667085}.danger{color:#dc2626}.defect{margin-top:10px;padding:10px;background:#fff1f2;border-left:3px solid #ef4444;border-radius:5px}.defect p{margin:4px 0 0;font-size:13px}.dialog-form{display:grid;gap:8px}.dialog-form input,.dialog-form select{padding:9px;border:1px solid #cbd5e1;border-radius:6px;width:100%}.dialog-form .row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.dialog-form label{font-size:13px;color:#475569}.check{display:flex;align-items:center;gap:6px}.check input{width:auto}.muted{color:#7a8798;font-size:12px}
  .cap-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-top:10px}.cap{border:1px solid #e1e7ef;border-radius:8px;padding:10px}.cap-head{display:flex;justify-content:space-between;font-size:13px}.cap-head span{color:#7a8798}.bar{height:6px;background:#eef2f7;border-radius:4px;margin:8px 0 4px;overflow:hidden}.bar i{display:block;height:100%;background:#2563eb}.bar i[style*="100"]{background:#dc2626}.cap small{color:#7a8798}.cap small.full{color:#dc2626;font-weight:700}
  .preview{display:grid;gap:6px;margin-top:4px}.pv{display:flex;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:6px;font-size:13px;border:1px solid}.pv.ok{background:#f0fdf4;border-color:#bbf7d0}.pv.busy,.pv.full{background:#fef2f2;border-color:#fecaca}.pv span{color:#475569}
  .alert{border-radius:8px;padding:10px 12px;margin-top:6px;font-size:13px}.alert p{margin:4px 0 0}.alert.danger{background:#fef2f2;border:1px solid #fecaca;color:#991b1b}.alert.warn{background:#fffbeb;border:1px solid #fde68a;color:#92400e}.alert.ok{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534}.mt-4{margin-top:16px}`],
})
export class WeldMapComponent {
  readonly store = inject(Store<{ welds: WeldState }>)
  private readonly ledger = inject(OccupancyLedgerService)
  state!: WeldState
  planDialog = false
  saving = false
  form: PlanForm = this.freshForm()
  errorMsg = ''
  errorTitle = ''
  conflictPlanId?: string
  retryHint = ''
  successMsg = ''
  private lastInput?: CreatePlanInput

  constructor() { this.store.select('welds').subscribe((state) => this.state = state) }

  private freshForm(): PlanForm {
    return { requestId:`REQ-PLAN-${Date.now().toString(36)}`, date:'2026-09-30', period:'上午', method:'UT + MT', weldIds:'W-105,W-109', inspector:'陈锋', failWrite:false }
  }
  openDialog() {
    this.form = this.freshForm()
    this.planDialog = true
    this.errorMsg = this.errorTitle = this.retryHint = this.successMsg = ''
    this.conflictPlanId = undefined
  }

  get selected() { return this.state?.welds.find((item) => item.id === this.state.selectedId) }
  select(weld: Weld) { this.store.dispatch({ type:'[Weld] Select', id: weld.id }) }
  color(weld: Weld) { return weld.status === '合格' || weld.status === '已关闭' ? '#16a34a' : weld.status === '返修中' || !weld.qualificationValid ? '#dc2626' : weld.status === '待复检' ? '#7c3aed' : '#f59e0b' }

  usageCount(slot: string) { return (this.state?.occupancies ?? []).filter((o) => o.slotId === slot && o.state !== '待重排').length }
  usagePct(slot: string) { const cap = this.state.capacities.find((c) => c.slotId === slot); return cap ? Math.min(100, Math.round(this.usageCount(slot) / cap.limit * 100)) : 0 }
  holders(slot: string) { return [...new Set((this.state?.occupancies ?? []).filter((o) => o.slotId === slot && o.state !== '待重排').map((o) => o.planId))] }
  /** 只显示已有占用的时段，并按日期/时段排序 */
  get usedCapacities() {
    const used = new Set((this.state?.occupancies ?? []).filter((o) => o.state !== '待重排').map((o) => o.slotId))
    return (this.state?.capacities ?? []).filter((cap) => used.has(cap.slotId)).sort((a, b) => a.date.localeCompare(b.date) || a.period.localeCompare(b.period))
  }

  get weldIdList() { return this.form.weldIds.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean) }
  get canSubmit() { return !!this.form.date && this.weldIdList.length > 0 && !this.saving }

  /** 建账前预检：逐条焊缝 × 方法给出占用 / 容量结论 */
  get preview() {
    if (!this.state?.capacities.length) return []
    const out: { weldId: string; method: string; kind:'ok'|'busy'|'full'; planId?: string; free?: number; limit?: number }[] = []
    for (const weldId of this.weldIdList) {
      for (const key of methodKeys(this.form.method)) {
        const id = slotId(this.form.date, this.form.period, key)
        const cap = this.state.capacities.find((c) => c.slotId === id)
        const holder = this.state.occupancies.find((o) => o.slotId === id && o.weldId === weldId && o.state !== '已完成' && o.state !== '待重排')
        const used = this.usageCount(id)
        if (holder) out.push({ weldId, method:key, kind:'busy', planId: holder.planId })
        else if (cap && used >= cap.limit) out.push({ weldId, method:key, kind:'full', limit: cap.limit })
        else out.push({ weldId, method:key, kind:'ok', free: cap ? cap.limit - used : undefined })
      }
    }
    return out
  }

  private buildInput(): CreatePlanInput {
    return {
      requestId: this.form.requestId, date: this.form.date, period: this.form.period,
      method: this.form.method, weldIds: this.weldIdList, inspector: this.form.inspector,
      failWrite: this.form.failWrite,
    }
  }

  /** 保存：两笔几乎同时提交时由占用账串行化，第二笔会拿到原计划号冲突 */
  submit(_rival: boolean) {
    const input = this.buildInput()
    this.lastInput = input
    this.errorMsg = this.errorTitle = this.retryHint = this.successMsg = ''
    this.conflictPlanId = undefined
    this.saving = true

    if (_rival) {
      // 乙用相同请求内容、独立请求号几乎同时保存，演示两人同时保存只放行一笔
      const rivalInput = { ...input, requestId: `${input.requestId}-B`, failWrite:false }
      setTimeout(() => this.ledger.createPlan(rivalInput).catch((err) => this.onError(err, true)), 0)
    }
    this.ledger.createPlan(input).then((plan) => {
      this.successMsg = `计划 ${plan.id} 已预占成功（请求号 ${plan.requestId}）。`
      this.saving = false
    }).catch((err) => { this.onError(err, false) })
  }

  private onError(err: unknown, rival: boolean) {
    this.saving = false
    if (err instanceof PlanRejectedError) {
      if (err.code === 'WRITE_FAILED') {
        this.retryHint = err.message
        return
      }
      this.errorTitle = rival ? '同时保存的第二笔被拒绝' : '建计划被拒绝'
      this.errorMsg = err.message
      this.conflictPlanId = err.conflictPlanId
      return
    }
    this.errorTitle = '保存失败'
    this.errorMsg = String(err)
  }

  /** 写入失败后按原请求号重试；占用账保证不会重复占位 */
  retry() {
    if (!this.lastInput) return
    this.saving = true
    this.retryHint = this.errorMsg = ''
    this.ledger.createPlan({ ...this.lastInput, requestId: this.form.requestId, failWrite:false })
      .then((plan) => { this.successMsg = `重试成功：计划 ${plan.id}（原请求号 ${plan.requestId}），未重复占位。`; this.saving = false })
      .catch((err) => { this.saving = false; this.onError(err, false) })
  }
}
