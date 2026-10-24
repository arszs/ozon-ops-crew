import sharp from 'sharp';
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
// Render actual glyphs rather than estimating text width from character count.
export async function fitVisualText(value,{width,height,size=40,minSize=24,color='#142c2b',bold=false}={}){
 const text=String(value??'').trim().replace(/\s+/g,' ');if(!text||text.length>8000)throw Error('visual_text_invalid');
 if(![width,height,size,minSize].every(Number.isSafeInteger)||Math.min(width,height,size,minSize)<=0||minSize>size)throw Error('visual_text_bounds_invalid');
 let fontSize=size;
 for(let attempt=0;attempt<12;attempt++){
  let rendered;try{rendered=await sharp({text:{text:`<span foreground="${color}">${escape(text)}</span>`,font:`Arial${bold?' Bold':''} ${fontSize}`,width,rgba:true,wrap:'word-char',spacing:Math.round(fontSize*.18)}}).png().toBuffer({resolveWithObject:true});}catch{throw Error('visual_text_render_failed');}const {data,info}=rendered;
  if(info.width<=width&&info.height<=height)return {buffer:data,width:info.width,height:info.height,fontSize};
  if(fontSize===minSize)break;const ratio=Math.min(width/info.width,height/info.height);fontSize=Math.max(minSize,Math.min(fontSize-1,Math.floor(fontSize*Math.max(.5,ratio)*.97)));
 }
 throw Error('visual_text_overflow');
}
