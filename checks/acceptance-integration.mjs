// Creates labelled, authorized synthetic test records in the current local platform.
// This is rules acceptance only. It never configures a model or reads credentials.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRuntimeClient, standardAssembly, standardPermissions } from '@personal/capability-sdk';
const api=createRuntimeClient('http://127.0.0.1:4313');
const out=resolve(process.env.ACCEPTANCE_OUTPUT_DIR || 'artifacts/integration-0.3');
await mkdir(out,{recursive:true});await mkdir(join(out,'inputs'),{recursive:true});
const write=async(name,data)=>writeFile(join(out,name),typeof data==='string'?data:JSON.stringify(data,null,2));
const sha=(text)=>createHash('sha256').update(text).digest('hex');
const poll=async(id)=>{for(let i=0;i<300;i++){const r=await api.run(id);if(['waiting_approval','failed','completed','canceled','rejected'].includes(r.status))return r;await new Promise(r=>setTimeout(r,30));}throw new Error('Run did not settle: '+id)};
const steps=structuredClone(standardAssembly);steps[2].config={query:'档案保留期限五年',limit:5};
const project=await api.createProject({name:'资料核验 · 整合验收',layout:'agent',permissions:standardPermissions,steps});
const documents=[{id:'archive',text:'档案保留期限为五年。访问资料需要登记。',source:'授权测试手册#档案期限',scope:'general'},{id:'procedure',text:'五年到期后，管理员处理档案销毁申请。',source:'授权测试说明#销毁安排',scope:'general'},{id:'room',text:'会议室位于三楼，预约请联系前台。',source:'授权测试场地说明#会议',scope:'general'}];
const valid={documents,claims:[{key:'保留期限',value:'五年',source:'archive'},{key:'保留期限',value:'五年',source:'procedure'}]};
const j=x=>JSON.stringify(x,null,2);
const cases=[
 {name:'非空问题与多来源',text:j(valid),expected:'waiting_approval',keep:true},
 {name:'冲突事实',text:j({documents:[documents[0],{...documents[1],text:'档案保留期限为三年。'}],claims:[valid.claims[0],{key:'保留期限',value:'三年',source:'procedure'}]}),expected:'UNRESOLVED_CONFLICT'},
 {name:'缺少来源',text:j({documents:[{id:'no-source',text:'合法文字但未提供来源。'}]}),expected:'MISSING_SOURCE'},
 {name:'声明来源不存在',text:j({documents,claims:[{key:'保留期限',value:'五年',source:'unknown'}]}),expected:'SOURCE_NOT_FOUND'},
 {name:'越权范围',text:j({documents:[{...documents[0],scope:'private-not-authorized'}]}),expected:'SCOPE_DENIED'},
 {name:'损坏JSON',text:'{"documents":',expected:'INVALID_JSON'},
 {name:'空顶层',text:'null',expected:'INVALID_DOCUMENTS'},
 {name:'原文不支持声明值',text:j({documents,claims:[{key:'保留期限',value:'九十九年',source:'archive'}]}),expected:'CLAIM_NOT_SUPPORTED'},
 {name:'未提供事实声明',text:j({documents}),expected:'waiting_approval',noClaims:true},
];
const results=[];let positive;
for(const c of cases){const filename=c.name+'.json';await write('inputs/'+filename,c.text);const r=await api.execute(project.id,{filename,text:c.text},project.revision);const actual=await poll(r.id);if(c.expected==='waiting_approval'){if(actual.status!=='waiting_approval')throw Error(c.name+': '+j(actual.error));}else if(actual.error?.code!==c.expected||actual.artifacts.length)throw Error(c.name+': '+j(actual.error));
 if(c.keep){positive=actual;const citations=actual.steps.find(s=>s.capabilityId==='knowledge.search').output.citations;if(citations.map(c=>c.documentId).join(',')!=='archive,procedure'||citations[1].score>=1)throw Error('Retrieval quality incorrect');}
 if(c.noClaims && actual.steps[1].output.checks[1].status!=='not_evaluated')throw Error('Missing claims falsely verified');
 await write(c.name+'-run.json',actual);let final=actual;if(actual.status==='waiting_approval'&&!c.keep){await api.cancel(r.id);final=await poll(r.id);}
 results.push({case:c.name,input:'inputs/'+filename,runId:r.id,expected:c.expected,observedStatus:actual.status,error:actual.error,citations:actual.steps.find(s=>s.capabilityId==='knowledge.search')?.output?.citations,finalStatus:final.status,artifacts:actual.artifacts.length});
}
// Empty query is explicit absence, not full relevance for every paragraph.
const emptySteps=structuredClone(steps);emptySteps[2].config.query='';const ep=await api.createProject({name:'无检索问题 · 边界验收',layout:'agent',permissions:standardPermissions,steps:emptySteps});const er=await api.execute(ep.id,{filename:'无问题.json',text:j(valid)},ep.revision);const ew=await poll(er.id);if(ew.steps[2].output.citations.length)throw Error('Empty query fabricated hits');await api.cancel(er.id);results.push({case:'空检索问题',runId:er.id,input:'inputs/非空问题与多来源.json',observedStatus:ew.status,finalStatus:'canceled',citations:[]});await write('空检索问题-run.json',await api.run(er.id));
// Existing success is read only, including original report bytes and intermediate snapshot.
const old=await api.run('run_564038c1-0122-46a4-b7ec-80c3ca58e19d');const oldFiles=[];
for(const a of old.artifacts){const res=await fetch(api.artifactUrl(old.id,a.id));const bytes=Buffer.from(await res.arrayBuffer());if(!res.ok||sha(bytes)!==a.sha256)throw Error('Historical artifact mismatch');oldFiles.push({id:a.id,filename:a.filename,sha256:sha(bytes),bytes:bytes.length});}
const receiptResponse=await fetch(api.receiptUrl(old.id));const receipt=await receiptResponse.json();if(!receiptResponse.ok||receipt.finalStatus!=='completed')throw Error('Historical receipt inconsistent');await write('historical-final-receipt.json',receipt);await write('historical-audit.json',{runId:old.id,status:old.status,approvals:old.approvals,exportStep:old.steps.find(s=>s.capabilityId==='report.export'),files:oldFiles,executionSnapshot:old.steps.find(s=>s.capabilityId==='runtime.snapshot')?.output?.execution,checkedAt:new Date().toISOString()});
const catalog=await api.catalog();const model=catalog.providers.find(p=>p.id==='platform-model');await write('catalog.json',catalog);
const modelSteps=structuredClone(steps);modelSteps.splice(3,0,{capabilityId:'model.verify',version:'1.0.0',config:{}});const mp=await api.createProject({name:'模型核验 · 配置待就绪',layout:'agent',permissions:[...standardPermissions,'model:invoke','data:external'],steps:modelSteps});
let blocked;try{await api.execute(mp.id,{filename:'公开合成测试.json',text:j(valid),modelConsent:true},mp.revision);throw Error('Unexpected configured model; stop and inspect authorization');}catch(e){if(e.message.includes('Unexpected'))throw e;blocked={httpStatus:e.status,code:e.code,message:e.message,issues:e.issues};}
await write('ai-acceptance.json',{checkedAt:new Date().toISOString(),status:'BLOCKED_MODEL_NOT_CONFIGURED',projectId:mp.id,runId:null,provider:model,attempt:blocked,realModelCalls:0,normalResponse:'BLOCKED',modelError:'BLOCKED',timeout:'BLOCKED',cancel:'BLOCKED',invalidSchema:'BLOCKED',note:'Separate isolated synthetic Provider contract checks are not real AI acceptance.'});
await write('rules-acceptance.json',{checkedAt:new Date().toISOString(),scope:'Actual local Runtime using authorized synthetic materials; no AI',projectId:project.id,positiveWaitingRun:positive.id,cases:results});
await write('context.json',{projectId:project.id,waitingRunId:positive.id,modelProjectId:mp.id,modelConfigured:model.available});
console.log(JSON.stringify({projectId:project.id,waitingRunId:positive.id,ruleCases:results.length,model:model.available?'configured':'BLOCKED_MODEL_NOT_CONFIGURED'}));
