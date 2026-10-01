import type { AuditEvent, InspectionPlan, Weld } from './types'

export const seedWelds: Weld[] = [
  { id:'W-101', drawing:'SG-04-钢柱', component:'KZ-12 / 柱翼缘', joint:'全熔透坡口焊', method:'GMAW', welder:'王凯', qualification:'GB/T 9448 · 2027-06', qualificationValid:true, inspectionRatio:100, requiredRatio:100, length:1200, status:'合格', x:18, y:24, repairs:0, defects:[] },
  { id:'W-104', drawing:'SG-07-屋面梁', component:'GL-21 / 下翼缘', joint:'对接焊缝', method:'SAW', welder:'刘强', qualification:'GB/T 9448 · 2028-03', qualificationValid:true, inspectionRatio:100, requiredRatio:100, length:1500, status:'待复检', x:48, y:38, repairs:2, defects:[{id:'D-31',position:42,type:'夹渣',length:12,level:'Ⅱ级',method:'UT',report:'UT-2026-0918'}] },
  { id:'W-107', drawing:'SG-07-屋面梁', component:'GL-21 / 腹板', joint:'角焊缝', method:'FCAW', welder:'赵明', qualification:'GB/T 9448 · 2027-01', qualificationValid:true, inspectionRatio:20, requiredRatio:20, length:1000, status:'返修中', x:61, y:42, repairs:1, defects:[{id:'D-32',position:68,type:'未熔合',length:18,level:'Ⅲ级',method:'MT',report:'MT-2026-0921'}] },
  { id:'W-109', drawing:'SG-12-平台梁', component:'PL-08 / 节点板', joint:'角焊缝', method:'SMAW', welder:'孙鹏', qualification:'GB/T 9448 · 2026-10-01', qualificationValid:false, inspectionRatio:10, requiredRatio:20, length:1000, status:'待检测', x:78, y:60, repairs:0, defects:[] },
  { id:'W-112', drawing:'SG-12-平台梁', component:'PL-08 / 腹板', joint:'组合焊缝', method:'GMAW', welder:'王凯', qualification:'GB/T 9448 · 2027-06', qualificationValid:true, inspectionRatio:50, requiredRatio:50, length:800, status:'已关闭', x:36, y:68, repairs:0, defects:[] },
]

export const seedPlans: InspectionPlan[] = [
  { id:'IP-2026-0930-A', date:'2026-09-30', method:'UT + MT', weldIds:['W-105','W-106','W-108'], inspector:'陈锋', state:'待执行' },
  { id:'IP-2026-0929-B', date:'2026-09-29', method:'UT', weldIds:['W-104'], inspector:'赵岚', state:'执行中' },
]

export const seedAudit: AuditEvent[] = [
  { id:'AE-0', time:'2026-09-20 10:05', actor:'质量负责人', action:'审核通过', target:'IP-2026-0930-A', detail:'批量检测计划审核通过，按 09-30 时段 UT+MT 执行' },
  { id:'AE-1', time:'2026-09-29 16:38', actor:'赵岚', action:'提交复检', target:'W-104', detail:'返修后 UT 复检合格，等待审核签字' },
  { id:'AE-2', time:'2026-09-29 15:12', actor:'陈锋', action:'录入缺陷', target:'W-107', detail:'翼缘板端部夹渣，长度 12mm，Ⅱ级' },
  { id:'AE-3', time:'2026-09-29 14:20', actor:'系统', action:'资质预警', target:'W-109', detail:'焊工证书 2026-10-01 到期，不得列入后续检测计划' },
]
