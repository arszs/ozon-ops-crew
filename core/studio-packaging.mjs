// This remains an estimate, not a claim about the manufacturer's shipping box.
// Never let the default box be shorter than a supported single-item dimension.
export function studioPackaging(product,options){
 const attributes=product.attributes||{},values=Object.entries(attributes).filter(([name])=>/^(?:尺寸|产品尺寸|商品尺寸|Размер|Размеры)$/iu.test(name.trim())).map(([,value])=>String(value).normalize('NFKC').trim());
 const sizes=values.flatMap(value=>{const m=value.match(/^(\d+(?:[.,]\d+)?)\s*[*×xX]\s*(\d+(?:[.,]\d+)?)(?:\s*[*×xX]\s*(\d+(?:[.,]\d+)?))?\s*(cm|厘米|см|mm|毫米|мм)$/iu);if(!m)return [];const scale=/cm|厘米|см/iu.test(m[4])?10:1;const dimensions=m.slice(1,4).filter(Boolean).map(v=>Number(v.replace(',','.'))*scale);return dimensions.every(n=>Number.isFinite(n)&&n>0&&n<=2000)?dimensions:[];}).filter(n=>Number.isFinite(n)&&n>0&&n<=2000).sort((a,b)=>b-a);
 const keys=['width','height','depth'].sort((a,b)=>Number(options[b])-Number(options[a])),next={...options},adjustments=[];
 for(let i=0;i<sizes.length;i++){const key=keys[i];if(Number(next[key])>=sizes[i])continue;const value=Math.ceil((sizes[i]+20)/10)*10;adjustments.push({field:key,previous:Number(next[key]),value,sourceDimensionMm:sizes[i]});next[key]=value;}
 return {options:next,estimated:true,adjustments,source:'selected-product-attributes'};
}
export const packagingNotice=options=>`包装 ${options.width/10}×${options.height/10}×${options.depth/10} cm / ${options.weight}g 为估计，可在费用中修改；不是厂家确认的运输包装。`;
