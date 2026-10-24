export const motorcycleSource=product=>/摩托车|摩托配件|摩托车配件|мотоцикл|мототех/i.test([product.titleZh,product.descriptionZh,product.categoryZh].join(' '));
export function studioCategoryChoices(leaves,words,product){
 const ranked=leaves.map(c=>({...c,score:words.reduce((n,w)=>n+(c.name.toLowerCase().includes(w.slice(0,Math.min(5,w.length)))?1:0),0)})).filter(c=>c.score>0).sort((a,b)=>b.score-a.score);
 // Domain-specific matches must not fall out of the shortlist behind car accessories.
 const motor=motorcycleSource(product)?ranked.filter(c=>/мототех|мотоцикл/i.test(c.name)):[];
 return (motor.length?motor:ranked).slice(0,35);
}
export const motorcycleCategoryConflict=(product,name)=>motorcycleSource(product)&&/автомобил/i.test(name||'');
