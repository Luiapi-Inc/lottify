'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { components } from '@lottify/contracts';
import { AdminClient, ApiFailure } from './client';
import Login from './login';
import './workspace.css';

type Admin = components['schemas']['AdminMeResponse'];
type Kind = 'products' | 'bet-types';
type Version = { id:string;version:number;revision:number;state:string;effectiveFrom:string;effectiveUntil:string|null; [key:string]:unknown };
type Resource = {id:string;code?:string;versions:Version[]};
type Choice = {betTypeId:string;betTypeVersionId:string;label:string};
const states:Record<string,string>={DRAFT:'Draft',REVIEW:'รออนุมัติ',PUBLISHED:'เผยแพร่แล้ว'};
const commonFields=[['settlementRuleVersionRef','เวอร์ชันกฎการจ่ายรางวัล'],['reason','เหตุผลการสร้างเวอร์ชัน']] as const;
const productFields=[['timezone','เขตเวลา'],['scheduleTemplateRef','ตารางออกรางวัล'],['resultSchemaVersionRef','เวอร์ชันรูปแบบผลรางวัล'],['defaultPayoutPolicyRef','นโยบายอัตราจ่าย'],['defaultLimitPolicyRef','นโยบายวงเงิน'],['defaultRestrictionPolicyRef','นโยบายเลขอั้น']] as const;
const betFields=[['canonicalNumberFormat','รูปแบบตัวเลข'],['validationPattern','รูปแบบตรวจสอบตัวเลข'],['minStakeMinor','เดิมพันต่ำสุด (สตางค์)'],['maxStakeMinor','เดิมพันสูงสุด (สตางค์)'],['limitPolicyRef','นโยบายวงเงิน'],['restrictionPolicyRef','นโยบายเลขอั้น']] as const;
const labels:Record<string,string>=Object.fromEntries([...commonFields,...productFields,...betFields,['defaultPayout','อัตราจ่าย'],['enabledBetTypes','ประเภทเดิมพันที่เปิดใช้']]);
const date=(s:unknown)=>typeof s==='string'?new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date(s)):'—';
const show=(v:unknown):string=>v===undefined||v===null?'—':typeof v==='object'?JSON.stringify(v,null,2):String(v);

export default function LotteryWorkspace() {
  const [client]=useState(()=>new AdminClient());const [admin,setAdmin]=useState<Admin|null>(null);
  const [boot,setBoot]=useState(true);const [kind,setKind]=useState<Kind>('products');const [state,setState]=useState('');
  const [items,setItems]=useState<Resource[]>([]);const [cursor,setCursor]=useState<string|null>(null);
  const [resource,setResource]=useState<Resource|null>(null);const [version,setVersion]=useState<Version|null>(null);
  const [choices,setChoices]=useState<Choice[]>([]);const [form,setForm]=useState<'identity'|'version'|null>(null);
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
  const [approval,setApproval]=useState(false);const [mfa,setMfa]=useState('');const epoch=useRef(0);
  const can=(action:string)=>admin?.capabilities.includes(`lottery-configuration.${action}` as Admin['capabilities'][number])??false;
  function report(e:unknown) {setError(e instanceof ApiFailure?`${e.message} (${e.code})${e.correlationId?` · อ้างอิง ${e.correlationId}`:''}`:e instanceof Error?e.message:'เชื่อมต่อไม่สำเร็จ กรุณาลองอีกครั้ง');}
  async function initialize() { const me=await client.request<Admin>('auth/me',{});setAdmin(me); }
  useEffect(()=>{void initialize().catch(()=>{}).finally(()=>setBoot(false));},[client]); // Refresh is single-flight, including StrictMode.
  async function load(next?:string) {
    const generation=++epoch.current;setBusy(true);setError('');
    try {const params=new URLSearchParams({limit:'30'});if(state)params.set('state',state);if(next)params.set('cursor',next);
      const page=await client.request<{items:Resource[];nextCursor:string|null}>(`lottery/${kind}?${params}`);
      if(generation===epoch.current){setItems(old=>next?[...old,...page.items]:page.items);setCursor(page.nextCursor);}
    }catch(e){if(generation===epoch.current)report(e);}finally{if(generation===epoch.current)setBusy(false);}
  }
  useEffect(()=>{setResource(null);setVersion(null);setForm(null);setApproval(false);setItems([]);setCursor(null);if(admin)void load();return()=>{epoch.current++;};},[kind,state,admin]);
  async function detail(id:string, selected?:string) { const r=await client.request<Resource>(`lottery/${kind}/${id}`);setResource(r);setVersion(r.versions.find(v=>v.id===selected)??r.versions[0]??null);setApproval(false);setMfa('');return r; }
  async function run(action:()=>Promise<void>) {setBusy(true);setError('');setNotice('');try{await action();}catch(e){report(e);}finally{setBusy(false);}}
  async function openVersion() {
    await run(async()=>{if(kind==='products'){
      const all:Choice[]=[];let next:string|null=null;
      do {const p:{items:Resource[];nextCursor:string|null}=await client.request<{items:Resource[];nextCursor:string|null}>(`lottery/bet-types?limit=100&state=PUBLISHED${next?`&cursor=${next}`:''}`);
        for(const r of p.items)for(const v of r.versions)all.push({betTypeId:r.id,betTypeVersionId:v.id,label:`${r.code} · v${v.version}`});next=p.nextCursor;
      }while(next);setChoices(all);
    }setForm('version');setApproval(false);});
  }
  async function create(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const data=new FormData(event.currentTarget);
    await run(async()=>{
      if(form==='identity') {const result=await client.request<{id:string}>(`lottery/${kind}`,kind==='products'?{}:{code:String(data.get('code')).trim()},true);setForm(null);setResource({id:result.id,code:kind==='bet-types'?String(data.get('code')):undefined,versions:[]});setVersion(null);setNotice('สร้างรายการแล้ว เลือกสร้างเวอร์ชันเพื่อกำหนดรายละเอียด');}
      else if(resource) {
        const body:Record<string,unknown>={version:Number(data.get('version')),effectiveFrom:new Date(String(data.get('effectiveFrom'))).toISOString()};
        if(data.get('effectiveUntil'))body.effectiveUntil=new Date(String(data.get('effectiveUntil'))).toISOString();
        if(body.effectiveUntil&&String(body.effectiveUntil)<=String(body.effectiveFrom))throw new Error('วันสิ้นสุดต้องอยู่หลังวันเริ่มใช้');
        for(const [name] of [...(kind==='products'?productFields:betFields),...commonFields])body[name]=String(data.get(name)??'').trim();
        if(kind==='products')body.enabledBetTypes=data.getAll('enabled').map(id=>{const c=choices.find(c=>c.betTypeVersionId===id)!;return {betTypeId:c.betTypeId,betTypeVersionId:c.betTypeVersionId};});
        else {body.defaultPayout=JSON.parse(String(data.get('defaultPayout')));if(!body.defaultPayout||typeof body.defaultPayout!=='object'||Array.isArray(body.defaultPayout))throw new Error('อัตราจ่ายต้องเป็น object');if(BigInt(String(body.minStakeMinor))>BigInt(String(body.maxStakeMinor)))throw new Error('เดิมพันต่ำสุดต้องไม่เกินเดิมพันสูงสุด');}
        const result=await client.request<{id:string}>(`lottery/${kind}/${resource.id}/versions`,body,true);
        setForm(null);setNotice('บันทึก draft แล้ว ยังไม่มีผลกับงวดหรือการเดิมพัน');await detail(resource.id,result.id);
      }
      await load();
    });
  }
  async function command(action:'submit'|'approve') {
    if(!version||!resource)return;const selected=version;const id=resource.id;
    await run(async()=>{
      if(action==='approve')await client.request('auth/reauth',{actionClass:'lottery-configuration.publish',code:mfa});
      await client.request(`lottery/${kind==='products'?'product':'bet-type'}-versions/${selected.id}/${action}`,{expectedVersion:selected.revision},true);
      setApproval(false);setMfa('');setVersion(null);setNotice(action==='submit'?'ส่งตรวจแล้ว รอผู้มีสิทธิ์อนุมัติ':'เผยแพร่เวอร์ชันสำเร็จ');
      await detail(id,selected.id);await load();
    });
  }
  const previous=resource?.versions.find(v=>version&&v.version<version.version);
  return <div className="lot-shell"><aside className="lot-sidebar"><a className="lot-brand" href="/lottery"><span className="lot-mark">L</span> Lottify <small>ADMIN</small></a><p className="lot-nav-label">พื้นที่ปฏิบัติงาน</p><nav aria-label="เมนูหลัก"><a href="/lottery" aria-current="page">หวยและงวด <span>01</span></a><a href="/accounting-periods">การเงิน <span>02</span></a></nav><div className="lot-sidebar-foot">การตั้งค่าแบบมีเวอร์ชัน<br/>ทุกการเผยแพร่ตรวจสอบย้อนหลังได้</div></aside>
    <main className="lot-main"><header className="lot-top"><span>Admin / หวยและงวด</span>{admin&&<div>{admin.name} <span className="lot-role">{admin.role}</span><button disabled={busy} onClick={()=>void run(async()=>{await client.publicRequest('logout');client.clear();setAdmin(null);setItems([]);setResource(null);setVersion(null);})}>ออกจากระบบ</button></div>}</header>
    {boot?<p role="status">กำลังตรวจสอบ session…</p>:!admin?<Login client={client} onLogin={initialize}/>:<>
    <section className="lot-heading"><div><h1>ตั้งค่าหวย</h1><p>จัดการผลิตภัณฑ์และประเภทเดิมพัน ตั้งแต่ draft จนถึงการเผยแพร่</p></div><span className="lot-timezone">เวลาแสดงผล · Asia/Bangkok</span></section>
    {error&&<div className="lot-error" role="alert">{error}<button disabled={busy} onClick={()=>void run(async()=>{if(resource)await detail(resource.id,version?.id);await load();})}>โหลดข้อมูลล่าสุด</button></div>}
    {notice&&<div className="lot-success" role="status">{notice}</div>}
    <div className="lot-tabs" role="tablist" aria-label="ประเภทการตั้งค่า">{(['products','bet-types'] as const).map(k=><button role="tab" aria-selected={kind===k} key={k} disabled={busy} onClick={()=>{setKind(k);setNotice('');}}>{k==='products'?'ผลิตภัณฑ์หวย':'ประเภทเดิมพัน'}</button>)}</div>
    <section className="lot-panel"><div className="lot-toolbar"><label>สถานะ <select value={state} disabled={busy} onChange={e=>setState(e.target.value)}><option value="">ทั้งหมด</option>{Object.entries(states).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label><div><button disabled={busy} onClick={()=>void load()}>รีเฟรช</button>{can('create')&&<button className="lot-primary" disabled={busy} onClick={()=>{setForm('identity');setApproval(false);setError('');}}>+ สร้าง{kind==='products'?'ผลิตภัณฑ์':'ประเภทเดิมพัน'}</button>}</div></div>
    <div className="lot-table-wrap"><table><thead><tr><th>รายการ / เวอร์ชัน</th><th>สถานะ</th><th>เริ่มใช้</th><th>สิ้นสุด</th><th>รายละเอียด</th></tr></thead><tbody>{items.flatMap(r=>(r.versions.length?r.versions:[null]).filter(v=>!state||v).map(v=><tr key={v?.id??r.id}><td><strong>{r.code??`Product ${r.id.slice(0,8)}`}</strong><small>{v?`v${v.version} · revision ${v.revision}`:'ยังไม่มีเวอร์ชัน'}</small></td><td>{v?<span className={`lot-state ${v.state.toLowerCase()}`}>{states[v.state]??v.state}</span>:'—'}</td><td>{v?date(v.effectiveFrom):'—'}</td><td>{v?.effectiveUntil?date(v.effectiveUntil):'ไม่กำหนด'}</td><td><button disabled={busy} onClick={()=>void run(async()=>{setForm(null);await detail(r.id,v?.id);})}>ดูรายละเอียด</button></td></tr>))}</tbody></table></div>
    {!items.some(r=>!state||r.versions.length)&&<div className="lot-empty"><h2>{busy?'กำลังโหลด…':'ยังไม่มีรายการในสถานะนี้'}</h2><p>รายการจากระบบจะแสดงที่นี่ เมื่อสร้างผลิตภัณฑ์หรือประเภทเดิมพันแล้ว</p></div>}
    {cursor&&<div className="lot-more"><button disabled={busy} onClick={()=>void load(cursor)}>โหลดเพิ่มเติม</button></div>}</section>
    {form&&<section className="lot-panel lot-editor"><div className="lot-section-title"><h2>{form==='identity'?`สร้าง${kind==='products'?'ผลิตภัณฑ์หวย':'ประเภทเดิมพัน'}`:'สร้างเวอร์ชัน draft'}</h2><button disabled={busy} onClick={()=>setForm(null)}>ยกเลิก</button></div><form onSubmit={create} key={`${kind}-${form}-${resource?.id}`}>
      <fieldset disabled={busy}><div className="lot-form-grid">{form==='identity'?(kind==='bet-types'?<label>รหัสประเภทเดิมพัน<input name="code" required maxLength={100} placeholder="เช่น TWO_DIGIT"/></label>:<p>สร้างผลิตภัณฑ์ใหม่ จากนั้นกำหนดรายละเอียดในเวอร์ชัน draft</p>):<>
      <label>หมายเลขเวอร์ชัน<input name="version" type="number" min={1} step={1} defaultValue={Math.max(0,...(resource?.versions.map(v=>v.version)??[]))+1} required/></label>
      <label>เริ่มใช้ (ตามเวลาของอุปกรณ์)<input name="effectiveFrom" type="datetime-local" required/></label><label>สิ้นสุด (ไม่บังคับ)<input name="effectiveUntil" type="datetime-local"/></label>
      {[...(kind==='products'?productFields:betFields),...commonFields].map(([name,label])=><label key={name}>{label}<input name={name} required defaultValue={name==='timezone'?'Asia/Bangkok':undefined} inputMode={name.endsWith('Minor')?'numeric':undefined} pattern={name.endsWith('Minor')?'[0-9]+':undefined}/></label>)}
      {kind==='bet-types'?<label className="lot-wide">การตั้งค่าอัตราจ่าย (JSON ตามสัญญาที่อนุมัติ)<textarea name="defaultPayout" required rows={3} placeholder={'เช่น {"kind":"FIXED","amountMinor":9000}'}/></label>:<fieldset className="lot-wide lot-choices"><legend>ประเภทเดิมพันที่เปิดใช้ · เฉพาะเวอร์ชันเผยแพร่แล้ว</legend>{choices.length?choices.map(c=><label key={c.betTypeVersionId}><input type="checkbox" name="enabled" value={c.betTypeVersionId}/>{c.label}</label>):<p>ยังไม่มี Bet Type ที่เผยแพร่ กรุณาสร้างและเผยแพร่ก่อนเลือกอ้างอิง</p>}</fieldset>}
      </>}</div><p className="lot-hint">การบันทึก draft ยังไม่เผยแพร่ ต้องตรวจรายละเอียดและส่งอนุมัติก่อนใช้กับงวดในอนาคต</p><button className="lot-primary" type="submit">{busy?'กำลังบันทึก…':form==='identity'?'สร้างรายการ':'บันทึก draft'}</button></fieldset></form></section>}
    {resource&&!form&&<section className="lot-panel lot-editor"><div className="lot-section-title"><div><h2>{resource.code??'รายละเอียดผลิตภัณฑ์'}</h2><small className="lot-id">{resource.id}</small></div>{can('create')&&<button disabled={busy} onClick={()=>void openVersion()}>+ สร้างเวอร์ชัน</button>}</div>
    {resource.versions.length>0&&<label className="lot-version-select">เวอร์ชัน <select disabled={busy} value={version?.id??''} onChange={e=>{setVersion(resource.versions.find(v=>v.id===e.target.value)??null);setApproval(false);setMfa('');}}>{resource.versions.map(v=><option key={v.id} value={v.id}>v{v.version} · {states[v.state]}</option>)}</select></label>}
    {version?<><div className="lot-impact"><strong>v{version.version} · {states[version.state]}</strong><p>เริ่มใช้ {date(version.effectiveFrom)} · {version.effectiveUntil?`สิ้นสุด ${date(version.effectiveUntil)}`:'ไม่กำหนดวันสิ้นสุด'}</p>มีผลกับการสร้างงวดในอนาคต งวดเดิมและเดิมพันที่ยืนยันแล้วคงข้อมูลเดิม เวอร์ชันที่เผยแพร่แล้วแก้ไขไม่ได้</div>
    <h3>ตรวจรายละเอียดก่อนส่งตรวจ / อนุมัติ</h3><div className="lot-table-wrap"><table className="lot-diff"><thead><tr><th>การตั้งค่า</th><th>{previous?`เวอร์ชันก่อนหน้า v${previous.version}`:'ก่อนสร้าง'}</th><th>เวอร์ชันที่เลือก</th></tr></thead><tbody>{Object.keys(labels).filter(k=>version[k]!==undefined).map(k=><tr key={k}><th>{labels[k]}</th><td><pre>{show(previous?.[k])}</pre></td><td><pre>{show(version[k])}</pre></td></tr>)}</tbody></table></div>
    <div className="lot-actions">{version.state==='DRAFT'&&can('submit')&&<button className="lot-primary" disabled={busy} onClick={()=>void command('submit')}>ตรวจแล้ว ส่งอนุมัติ</button>}{version.state==='REVIEW'&&can('approve')&&<button className="lot-primary" disabled={busy} onClick={()=>setApproval(!approval)}>อนุมัติและเผยแพร่</button>}{version.state==='REVIEW'&&<p>ADMIN ต้องให้ผู้มีสิทธิ์คนอื่นอนุมัติ ระบบตรวจ maker-checker อีกครั้งก่อนเผยแพร่</p>}{version.state==='PUBLISHED'&&<p>เวอร์ชันนี้เผยแพร่แล้ว หากต้องเปลี่ยนการตั้งค่าให้สร้างเวอร์ชันใหม่</p>}</div>
    {approval&&<form className="lot-approval" onSubmit={e=>{e.preventDefault();void command('approve');}}><h3>ยืนยันการเผยแพร่ v{version.version}</h3><p>ตรวจรายละเอียดและเวลาเริ่มใช้ด้านบนก่อนยืนยัน</p><label>รหัส MFA 6 หลัก<input value={mfa} onChange={e=>setMfa(e.target.value)} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required disabled={busy}/></label><button className="lot-primary" disabled={busy}>ยืนยันอนุมัติและเผยแพร่</button><button type="button" disabled={busy} onClick={()=>{setApproval(false);setMfa('');}}>ยกเลิก</button></form>}</>:<p>รายการนี้ยังไม่มีเวอร์ชัน เริ่มจากสร้าง draft เพื่อกำหนดการตั้งค่า</p>}</section>}
    </>}</main></div>;
}
