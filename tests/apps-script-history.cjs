// Run: node tests/apps-script-history.cjs
// Optional: WORKBOOK_FIXTURE=/path/to/workbook.json uses a local exported workbook fixture.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const row=(...values)=>values;
function makeHistory(){const a=Array.from({length:400},()=>Array(18).fill(''));a[216][0]='▶ มิ.ย. 2026';a[218]=row(2,10,8,.8,12.75,15,.85);a[251][0]=new Date('2026-07-01T00:00:00+07:00');a[253]=row(1,20,15,.75,8.125,10,.8125);a[286][0]=new Date('2026-08-01T00:00:00+07:00');a[288]=row(1,'-','-','-','-','-','-');a[321][0]=new Date('2026-09-01T00:00:00+07:00');a[323]=row(1,20,15,.75,150.9,209.8,.719);a[324]=row(2,0,0,0,0,0,0);a[8]=row(1,999,999,1,999,999,1);return a}
const daily=Array.from({length:37},()=>Array(18).fill(''));daily[1][9]=new Date('2026-10-01T00:00:00+07:00');daily[6]=row(1,100,90,.9,7,8,.875);
let sheets={'History (Prepare)':makeHistory(),'History (Assembly)':makeHistory(),'Daily Record (Prepare)':daily,'Daily Record (Assembly)':daily};
if(process.env.WORKBOOK_FIXTURE)sheets=JSON.parse(fs.readFileSync(process.env.WORKBOOK_FIXTURE),(k,v)=>v&&v.$date?new Date(v.$date+'+07:00'):v);
let writes=0;function sheet(name){const a=sheets[name];if(!a)return null;return {getName(){return name},getMaxRows(){return Math.max(a.length,1000)},getLastRow(){let n=a.length;while(n&&a[n-1].every(v=>v===null||v===''))n--;return n},getRange(r,c,n=1,m=1){if(typeof r==='string'){let match=r.match(/^([A-Z]+)(\d+)$/);c=[...match[1]].reduce((x,v)=>x*26+v.charCodeAt(0)-64,0);r=+match[2]}if(n<1||m<1)throw Error('invalid range');return {getValues(){return Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>a[r+i-1]?.[c+j-1]??''))},getValue(){return a[r-1]?.[c-1]??''},setValues(){writes++;throw Error('unexpected write')},setValue(){writes++;throw Error('unexpected write')}}}}}
const ctx={Date,Number,Math,JSON,isNaN,isFinite,Utilities:{formatDate(d){return new Date(d.getTime()+7*3600000).toISOString().slice(0,7)}}};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../apps-script/Code.gs'),'utf8'),ctx);
const u=ctx.Util_;
u.getSheet=(key,required)=>{let sh=sheet(ctx.CONFIG.SHEETS[key]?.name);if(!sh&&required)throw Error('missing '+key);return sh};
u.Cache={wrap:(key,ttl,fn)=>fn(),invalidateAll(){},remove(){}};u.Rev={get:()=> 'test-rev'};
u.readTable=(key,header,start,count,columns)=>{let sh=u.getSheet(key,false);if(!sh)return [];return sh.getRange(start,1,count,18).getValues().map(row=>Object.fromEntries(Object.entries(columns).map(([key,col])=>[key,col.type==='text'?u.toStr(row[col.fallback]):u.toNum(row[col.fallback])])))};
ctx.Log_={debug(){},info(){},warn(){},error(){},correlationId:()=> 'test-request'};
for(let value of ['09-2026','2026-09','ก.ย. 2026','▶ ก.ย. 2026',new Date('2026-09-01T00:00:00+07:00')])assert.equal(u.monthKey(value),'2026-09');
assert.equal(u.parseMonth('13-2026'),null);
function get(month){let selected=u.parseMonth(month);if(month&&!selected)return {ok:false,error:{code:'BAD_MONTH'}};return {ok:true,data:ctx._buildFullPayload({},selected)}}
const sep=get('09-2026');assert.equal(sep.ok,true);assert.equal(sep.data._meta.selectedMonth,'2026-09');assert.equal(sep.data.prepare.source,'history');assert.equal(sep.data.prepare.rows[0].actualHrs,209.8);assert.equal(sep.data.prepare.rows[0].stdHrs,150.9);assert.ok('pctProductivity' in sep.data.prepare.rows[0]);assert.ok('pctAttendance' in sep.data.prepare.rows[0]);assert.ok(!sep.data.prepare.rows.some(r=>r.actualHrs===999));assert.ok(sep.data.productionDailyHistory['2026-06']);assert.ok(sep.data.productionDailyHistory['2026-07']);assert.ok(sep.data.productionDailyHistory['2026-09']);
assert.equal(get('09-2025').data.prepare.rows.length,0);assert.equal(get('09-2027').data.prepare.rows.length,0);assert.equal(get('13-2026').error.code,'BAD_MONTH');assert.equal(get('10-2026').data.prepare.source,'daily');assert.equal(get(null).data._meta.selectedMonth,'2026-10');assert.equal(writes,0);
u.withWriteLock=(label,fn)=>fn();
assert.throws(()=>ctx.HistoryService.saveMonth('prepare',{monthIdx:8,year:2027}),e=>e.code==='YEAR_CONFLICT');
assert.equal(writes,0);
assert.equal(ctx.HistoryService.readArchive('prepare',{monthIdx:8,year:2025}).rows.length,0);
assert.ok(ctx.HistoryService.readArchive('prepare').months.some(m=>m.monthKey==='2026-09'));
// A missing live sheet must not prevent reading the legacy archive.
const oldDaily=sheets['Daily Record (Prepare)'];delete sheets['Daily Record (Prepare)'];assert.equal(get('09-2026').data.prepare.rows[0].actualHrs,209.8);sheets['Daily Record (Prepare)']=oldDaily;
// Preserve the original router delegates (including POST auth/write handling).
let delegated;const dispatch=ctx.Router_.dispatch;ctx.Router_.dispatch=(method,e)=>{delegated=method;return 'delegated'};assert.equal(ctx.doGet({}),'delegated');assert.equal(delegated,'GET');ctx.Router_.dispatch=dispatch;
// Imported Production History retains priority over legacy blocks.
const readImport=ctx.ProductionHistoryService.readMonthRoom;ctx.ProductionHistoryService.readMonthRoom=()=>({rows:[{day:1,actualHrs:123,stdHrs:100}],monthKey:'2026-09',source:'productionHistory'});assert.equal(get('09-2026').data.prepare.source,'productionHistory');assert.equal(get('09-2026').data.productionDailyHistory['2026-09'].prepare.rows[0].actualHrs,123);ctx.ProductionHistoryService.readMonthRoom=readImport;
if(process.env.WORKBOOK_FIXTURE){assert.equal(sep.data.prepare.rows.length,24);assert.equal(sep.data.assembly.rows.length,23);fs.writeFileSync('/tmp/production-api-real.json',JSON.stringify(sep.data));}else{assert.equal(get('08-2026').data.prepare.rows.length,0);assert.equal(sep.data.prepare.rows[1].stdHrs,0)}
console.log('PASS Apps Script: mixed date/text headings, timezone, month filtering, hours, missing/zero, no display duplication, no cross-year fallback, API fields, no writes'+(process.env.WORKBOOK_FIXTURE?' (real workbook)':''));
module.exports={get};
