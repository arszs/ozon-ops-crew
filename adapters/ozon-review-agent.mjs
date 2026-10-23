import {randomUUID} from 'node:crypto';
import {ozonCall} from './ozon-products.mjs';
import {priceAccount} from './ozon-prices.mjs';
import {draftReviewAgent,reviewReplyIssues,guardReviewDraft} from '../core/review-agent.mjs';
import {audit,hash,maskPII} from '../core/repository.mjs';
const sourceHash=r=>hash({id:r.id,sku:String(r.sku),text:r.text,rating:r.rating});
const errorCode=e=>/^[a-z0-9_]{1,100}$/.test(e.message)?e.message:'review_agent_failed';
export class OzonReviewAgent{
 constructor({call=ozonCall,account=priceAccount,draft=draftReviewAgent,clock=()=>new Date()}={}){Object.assign(this,{call,account,draft,clock});}
 async info(store,id){const r=await this.call(store,'/v1/review/info',{review_id:id});if(String(r.id)!==id||!/^\d+$/.test(String(r.sku))||typeof r.text!=='string'||!Number.isFinite(r.rating))throw Error('review_identity_unknown');return r;}
 async comments(store,id){const all=[];let offset=0;for(let page=0;page<5;page++){const r=await this.call(store,'/v1/review/comment/list',{review_id:id,sort_dir:'DESC',limit:100,offset});if(!Array.isArray(r.comments)||r.comments.some(c=>typeof c.text!=='string'||typeof c.is_owner!=='boolean'))throw Error('review_comments_unavailable');all.push(...r.comments);if(r.comments.length<100)return all;const next=Number.isSafeInteger(r.offset)&&r.offset>offset?r.offset:offset+r.comments.length;if(next<=offset)throw Error('review_comments_unavailable');offset=next;}throw Error('review_comments_incomplete');}
 async process({service,store,policy}){
  if(await this.account(store)!==policy.accountRef)throw Error('strategy_account_changed');
  const rows=[],seen=new Set();let last='';
  for(let page=0;page<3;page++){
   const r=await this.call(store,'/v1/review/list',{limit:100,status:'UNPROCESSED',sort_dir:'DESC',last_id:last});if(!Array.isArray(r.reviews)||typeof r.has_next!=='boolean')throw Error('reviews_read_unavailable');
   for(const v of r.reviews){if(typeof v.id!=='string'||seen.has(v.id))throw Error('review_identity_unknown');seen.add(v.id);if(String(v.sku)===policy.sku)rows.push(v);}
   if(!r.has_next)break;if(typeof r.last_id!=='string'||!r.last_id||r.last_id===last)throw Error('reviews_read_unavailable');last=r.last_id;
  }
  let processed=0;
  for(const source of rows){
   if(processed>=3)break;
   const existing=((await service.repo.read()).strategyReviews||[]).findLast(r=>r.accountRef===policy.accountRef&&r.externalId===source.id);
   if(existing&&['draft_ready','not_sent'].includes(existing.state)){
    if(policy.mode==='auto'&&existing.draft?.safeToReply){processed++;await this.sendOrRecordFailure({service,store,policy,item:existing});}
    continue;
   }
   if(existing&&(existing.state!=='draft_failed'||(existing.draftAttempts||1)>=3||Date.parse(existing.retryAt||0)>+this.clock()))continue;
   const review=await this.info(store,source.id);if(String(review.sku)!==policy.sku||review.status!=='UNPROCESSED'||!review.text.trim())continue;
   if((await this.comments(store,source.id)).some(c=>c.is_owner===true))continue;
   const id=existing?.id||randomUUID(),key=hash({accountRef:policy.accountRef,reviewId:review.id});let reserved=false;
   await service.repo.mutate(db=>{
    db.strategyReviews??=[];let row=db.strategyReviews.find(r=>r.accountRef===policy.accountRef&&r.externalId===review.id);
    if(row&&(row.id!==id||row.state!=='draft_failed'||(row.draftAttempts||1)>=3||Date.parse(row.retryAt||0)>+this.clock()))return;
    if(!row){row={id,key,storeId:store.id,sku:policy.sku,policyId:policy.id,accountRef:policy.accountRef,externalId:review.id,at:this.clock().toISOString()};db.strategyReviews.push(row);}
    Object.assign(row,{sourceHash:sourceHash(review),sourceText:maskPII(review.text).slice(0,8000),rating:review.rating,state:'drafting',draftAttempts:(row.draftAttempts||0)+1,error:null});reserved=true;
   });
   if(!reserved)continue;processed++;
   try{
    const draft=await this.draft({textRu:review.text,rating:review.rating});
    await service.repo.mutate(db=>{
     const row=db.strategyReviews.find(r=>r.id===id);Object.assign(row,{state:'draft_ready',draft:draft.output,provider:draft.provider,attempts:draft.attempts,error:null,retryAt:null});
     for(const a of db.ownerAlerts)if(a.reviewId===id&&['review_agent_needs_owner','review_agent_failed'].includes(a.code))a.resolved=true;
     if(draft.output.needsOwner||!draft.output.safeToReply)service.alert(db,{storeId:store.id,sku:policy.sku,code:'review_needs_owner',severity:!draft.output.safeToReply&&draft.output.riskCode!=='factual_question'?'urgent':'warning',reviewId:id,summary:{ru:draft.output.summaryRu,zh:draft.output.summaryZh,en:draft.output.summaryEn}});
     audit(db,{kind:'strategy.review.drafted',reviewId:id,outputHash:hash(draft.output)});
    });
    if(policy.mode==='auto'&&draft.output.safeToReply)await this.sendOrRecordFailure({service,store,policy,item:(await service.repo.read()).strategyReviews.find(r=>r.id===id)});
   }catch(e){await this.recordFailure(service,store,policy,id,e);}
  }
  return {processed,scope:'first_300_unprocessed_reviews'};
 }
 async sendOrRecordFailure(args){try{return await this.sendDraft(args);}catch(e){await this.recordFailure(args.service,args.store,args.policy,args.item.id,e);}}
 async sendDraft({service,store,policy,item}){
  if(policy.mode!=='auto'||!policy.allowReviews||item.accountRef!==policy.accountRef||item.sku!==policy.sku||item.draft?.safeToReply!==true||item.draft.confidence<.9||reviewReplyIssues(item.draft).length)return;
  const fresh=await this.info(store,item.externalId);
  if(sourceHash(fresh)!==item.sourceHash||fresh.status!=='UNPROCESSED'||(await this.comments(store,item.externalId)).some(c=>c.is_owner))throw Object.assign(Error('review_source_changed'),{noWrite:true});
  if(await this.account(store)!==policy.accountRef)throw Object.assign(Error('strategy_account_changed'),{noWrite:true});
  const guarded=guardReviewDraft({textRu:fresh.text,rating:fresh.rating},item.draft);
  if(hash(guarded)!==hash(item.draft)){await service.repo.mutate(db=>{const row=db.strategyReviews.find(r=>r.id===item.id);if(!row||!['draft_ready','not_sent'].includes(row.state))return;row.draft=guarded;if(!guarded.safeToReply)service.alert(db,{storeId:store.id,sku:policy.sku,code:'review_needs_owner',severity:guarded.riskCode==='factual_question'?'warning':'urgent',reviewId:item.id,summary:{ru:guarded.summaryRu,zh:guarded.summaryZh,en:guarded.summaryEn}});audit(db,{kind:'strategy.review.guards_rechecked',reviewId:item.id,outputHash:hash(guarded)});});item={...item,draft:guarded};}
  if(!guarded.safeToReply)return;
  let sending=false;
  await service.repo.mutate(db=>{
   const p=db.policies.find(p=>p.id===policy.id),r=db.strategyReviews.find(r=>r.id===item.id);
   if(db.strategyPaused||p?.mode!=='auto'||p.revision!==policy.revision||p.accountRef!==policy.accountRef||!p.allowReviews||!['draft_ready','not_sent'].includes(r?.state))return;
   r.state='executing';r.sentAt=this.clock().toISOString();audit(db,{kind:'strategy.review.reserved',reviewId:r.id,replyHash:hash(r.draft.replyRu)});sending=true;
  });if(!sending)return;
  const beforeWrite=async()=>{
   if(await this.account(store)!==policy.accountRef)return false;
   const db=await service.repo.read(),p=db.policies.find(p=>p.id===policy.id),r=db.strategyReviews.find(r=>r.id===item.id);
   return !db.strategyPaused&&p?.mode==='auto'&&p.revision===policy.revision&&p.accountRef===policy.accountRef&&p.allowReviews===true&&r?.state==='executing';
  };
  const receipt=await this.call(store,'/v1/review/comment/create',{review_id:item.externalId,text:item.draft.replyRu,mark_review_as_processed:true},{write:true,beforeWrite,expectedAccountRef:policy.accountRef});
  if(typeof receipt.comment_id!=='string'||!receipt.comment_id)throw Error('review_reply_receipt_unknown');
  let verified=false;try{verified=(await this.comments(store,item.externalId)).some(c=>c.id===receipt.comment_id&&c.is_owner===true&&c.text===item.draft.replyRu);}catch{}
  await service.repo.mutate(db=>{
   const row=db.strategyReviews.find(r=>r.id===item.id);Object.assign(row,{state:verified?'verified':'accepted',commentId:receipt.comment_id,finishedAt:this.clock().toISOString(),error:null});
   for(const a of db.ownerAlerts)if(a.reviewId===item.id&&a.code==='strategy_action_cancelled')a.resolved=true;
   audit(db,{kind:'strategy.review.sent',reviewId:item.id,verified,receiptHash:hash(receipt)});
   if(!verified)service.alert(db,{storeId:store.id,sku:policy.sku,code:'review_reply_verification_pending',severity:'warning',reviewId:item.id});
  });
 }
 async recordFailure(service,store,policy,id,e){
  await service.repo.mutate(db=>{
   const row=db.strategyReviews.find(r=>r.id===id);row.error=errorCode(e);
   row.state=row.state==='executing'?(e.noWrite===true?'not_sent':'unknown'):row.state==='drafting'?'draft_failed':'blocked';
   if(row.state==='draft_failed')row.retryAt=new Date(+this.clock()+Math.min(60,(row.draftAttempts||1)*15)*60000).toISOString();
   service.alert(db,{storeId:store.id,sku:policy.sku,code:row.state==='unknown'?'review_reply_unknown':row.error,severity:row.state==='unknown'?'urgent':'warning',reviewId:id});
   audit(db,{kind:'strategy.review.failed',reviewId:id,state:row.state,error:row.error});
  });
 }
 async reconcile(service,store,item){
  if(await this.account(store)!==item.accountRef)throw Error('strategy_account_changed');
  const comments=await this.comments(store,item.externalId),match=comments.find(c=>c.is_owner&&c.text===item.draft?.replyRu&&(!item.commentId||c.id===item.commentId));if(!match)return {verified:false};
  return service.repo.mutate(db=>{const r=db.strategyReviews.find(r=>r.id===item.id);r.state='verified';r.commentId=match.id;r.finishedAt=this.clock().toISOString();for(const a of db.ownerAlerts)if(a.reviewId===item.id&&['review_reply_unknown','review_reply_verification_pending'].includes(a.code))a.resolved=true;audit(db,{kind:'strategy.review.reconciled',reviewId:item.id});return {verified:true};});
 }
}
