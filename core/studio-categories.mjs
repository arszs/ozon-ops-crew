export const motorcycleSource=product=>/摩托车|摩托配件|摩托车配件|мотоцикл|мототех/i.test([product.titleZh,product.descriptionZh,product.categoryZh].join(' '));
export const cameraGlassesSource=product=>/智能眼镜|AI眼镜|умные очки|смарт.?очки/i.test([product.titleZh,product.descriptionZh,product.categoryZh].join(' '))&&/拍摄|拍照|相机|摄像|камер|съ[её]мк/i.test([product.titleZh,product.descriptionZh,product.categoryZh].join(' '));
const exactSparkType=value=>/^(?:摩托车)?火花塞$|^свеча зажигания$/i.test(String(value||'').normalize('NFKC').trim());
function selectedMotorcycleSpark(product){
 if(!motorcycleSource(product))return false;
 // The seller title can advertise coils and kits beside the selected single part.
 const lines=String(product.descriptionZh||'').split(/\r?\n/),option=lines.map(s=>s.match(/^已选规格\s*[:：]\s*(.+)$/)).find(Boolean)?.[1];
 if(option&&/火花塞|点火线圈|高压包|高压帽|点火器|套装|свеч|катушк|комплект/i.test(option)){
  const value=option.normalize('NFKC').trim().replace(/^【(.*)】$/,'$1');
  return /^(?:原装|原厂)?火花塞(?:\s*[1-9]\d*\s*个)?$|^свеча зажигания(?:,\s*[1-9]\d*\s*шт\.?)?$/i.test(value);
 }
 const type=lines.map(s=>s.match(/^(?:商品类型|产品类型)\s*[:：]\s*(.+)$/)).find(Boolean)?.[1];
 if(type)return exactSparkType(type);
 return exactSparkType(product.categoryZh)||exactSparkType(product.localized?.attributes?.['Тип']);
}
const exactSparkLeaf=name=>String(name||'').normalize('NFKC').trim().toLowerCase()==='свеча зажигания';
export function studioCategoryChoices(leaves,words,product){
 // Camera glasses are not VR headsets, corrective frames or camera accessories.
 // An unavailable type must remain blocked instead of being replaced by a nearby one.
 if(cameraGlassesSource(product))return leaves.filter(c=>/очки.*камер|камер.*очки|умные очки|смарт.?очки/i.test(c.name)).slice(0,35);
 const scored=leaves.map(c=>({...c,score:words.reduce((n,w)=>n+(c.name.toLowerCase().includes(w.slice(0,Math.min(5,w.length)))?1:0),0)})).sort((a,b)=>b.score-a.score),ranked=scored.filter(c=>c.score>0);
 // Domain-specific matches must not fall out of the shortlist behind car accessories.
 const motor=motorcycleSource(product)?ranked.filter(c=>/мототех|мотоцикл/i.test(c.name)):[];
 if(selectedMotorcycleSpark(product)){
  const shared=scored.filter(c=>exactSparkLeaf(c.name)),dedicated=scored.filter(c=>/мототех|мотоцикл/i.test(c.name)&&/^свеч[аи] зажигания(?:\s|$)/i.test(c.name)),rest=(motor.length?motor:ranked).filter(c=>!shared.includes(c)&&!dedicated.includes(c));
  return [...dedicated.slice(0,Math.max(0,35-shared.length)),...shared,...rest].slice(0,35);
 }
 return (motor.length?motor:ranked).slice(0,35);
}
export const motorcycleCategoryConflict=(product,name,leafName=name)=>motorcycleSource(product)&&/автомобил/i.test(name||'')&&!(selectedMotorcycleSpark(product)&&exactSparkLeaf(leafName));
