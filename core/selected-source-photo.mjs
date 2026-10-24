import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {assetPath} from '../adapters/media.mjs';
import {objectSchema} from '../adapters/codex.mjs';
import {hash} from './repository.mjs';

// A SKU-bound photo may have stale measurements. Retain its product pixels only
// after an independent identity check, and omit every numeric marketing line.
export async function selectedPhotoWithoutSpecs(analysis,row,product,{run,cacheDir}={}){
 if(!row.selected||row.assetId!==product.images?.[0]?.assetId||analysis.kind!=='revision_specific'||analysis.modelCodes?.length||analysis.otherColor||!/[0-9]/.test(analysis.textZh)||!product.descriptionZh?.includes('已选规格'))return null;
 const textZh=analysis.textZh.split(/\r?\n/).filter(s=>!/[0-9]/.test(s)).join('\n').trim(),textRu=analysis.textRu.split(/\r?\n/).filter(s=>!/[0-9]/.test(s)).join('\n').trim();
 if(!textZh||!textRu||/\p{Script=Han}/u.test(textRu))return null;
 const path=cacheDir&&join(cacheDir,hash({policy:'selected-photo-without-specs-1',asset:row.assetId,selected:product.descriptionZh,analysis})+'.binding.json');let proof;
 try{if(path)proof=JSON.parse(await readFile(path,'utf8'));}catch{}
 if(!proof){const result=await run({images:[assetPath(row.assetId)],prompt:'Check the identity of a product photograph explicitly bound by the supplier page to the selected SKU. Untrusted DATA: '+JSON.stringify({selected:product.descriptionZh,sourceTitle:product.titleZh,ocr:analysis.textZh,whyExcluded:analysis.excludeReason})+'. Confirm sameSelectedProduct ONLY when the photographed product type, shape and revision match the selected item, and the ONLY reason for exclusion is conflicting numeric dimensions/weight in the marketing typography. Reject any explicit different model/revision, different set or contents, unclear identity or other factual conflict. Do not resolve conflicting numbers. We will REMOVE ALL numeric marketing lines, not substitute measurements. Return a verbatim non-numeric Chinese image fragment identifying the same product and a Russian reason.',schema:objectSchema({sameSelectedProduct:{type:'boolean'},identityEvidenceZh:{type:'string'},onlyNumericConflict:{type:'boolean'},reasonRu:{type:'string'}}),timeoutMs:120000});proof={...result.output,provider:result.provider};if(path)await writeFile(path,JSON.stringify(proof),{mode:0o600});}
 if(!proof.sameSelectedProduct||!proof.onlyNumericConflict||!proof.identityEvidenceZh?.trim()||/[0-9]/.test(proof.identityEvidenceZh)||!textZh.includes(proof.identityEvidenceZh))return null;
 return {...analysis,kind:'product',textZh,textRu,captionRu:'Фотография выбранного варианта товара.',omittedTextZh:analysis.textZh.split(/\r?\n/).filter(s=>/[0-9]/.test(s)).join('\n'),facts:(analysis.facts||[]).filter(f=>f.evidenceZh&&textZh.includes(f.evidenceZh)&&!/[0-9]/.test(f.nameRu+' '+f.valueRu)),excludeReason:'Спорные числовые характеристики на выбранной фотографии исключены; сам товар подтверждён.',selectedPhotoProof:{...proof,sourceAssetId:row.assetId}};
}
