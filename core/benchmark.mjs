// Only measured successful tool time is reported. This is not end-to-end go-live time.
export function migrationBenchmark(db){
 const groups={synthetic_ai:[],fixture_demo:[],seller_export:[]};
 for(const j of db.jobs){
  const group=j.mode==='sample'?'synthetic_ai':j.synthetic||j.mode==='mock'?'fixture_demo':'seller_export';
  const events=db.audit.filter(a=>a.jobId===j.id&&a.kind==='tool.complete'&&Number.isFinite(a.durationMs)&&a.durationMs>=0);
  const stages={};for(const e of events){stages[e.stage]??={successfulRuns:0,totalMs:0};stages[e.stage].successfulRuns++;stages[e.stage].totalMs+=e.durationMs;}
  const history=j.translationHistory||[];const tracked=['title','description'];const changed=new Set();let edits=0;
  for(let i=1;i<history.length;i++){if(history[i].output?.editedBy!=='human')continue;edits++;for(const k of tracked)if(history[i].output[k]!==history[i-1].output?.[k])changed.add(k);}
  const hasBaseline=history.length>0&&tracked.every(k=>typeof history[0].output?.[k]==='string');
  groups[group].push({jobId:j.id,sku:j.canonical?.sku,storeId:j.storeId,state:j.state,sourceVerified:false,createdAt:j.createdAt,stages,successfulToolMs:events.length?events.reduce((n,e)=>n+e.durationMs,0):null,textFieldsMeasured:hasBaseline?2:0,textFieldsEverChanged:hasBaseline?changed.size:null,humanEditVersions:edits,translationVersions:history.length,endToEndLiveMs:null,moderationVerified:false});
 }
 const summary=Object.fromEntries(Object.entries(groups).map(([name,rows])=>[name,{jobs:rows.length,timedJobs:rows.filter(r=>r.successfulToolMs!==null).length,successfulToolMs:rows.some(r=>r.successfulToolMs!==null)?rows.reduce((n,r)=>n+(r.successfulToolMs||0),0):null,textFieldsMeasured:rows.reduce((n,r)=>n+r.textFieldsMeasured,0),textFieldsEverChanged:rows.reduce((n,r)=>n+(r.textFieldsEverChanged||0),0)}]));
 return {schemaVersion:1,generatedAt:new Date().toISOString(),summary,groups,limits:['Tool time includes successful stage reruns; failed-call time and human waiting are not measured.','Text edits cover title and description only, not attributes, categories or images.','Seller export is a source declaration, not independently verified Taobao data.','Go-live time, first-pass moderation and monetary AI cost are not yet measured.'],targets:{realSkuSample:10,maxEndToEndMinutes:10,minUneditedFieldPct:80},targetsMeasured:false};
}
