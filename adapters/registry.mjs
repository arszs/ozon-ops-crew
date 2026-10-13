// Implementation availability, never an assertion of merchant authorization or connectivity.
const platforms = [
 {id:'ozon',name:'Ozon',stage:'primary',implemented:true,summary:'当前核心场景 · 商品本地化、单品经济与价格 / 广告实验',validation:'目录、财务和广告读取已验证；真实写入仍需店铺授权与人工确认。'},
 {id:'amazon',name:'Amazon',stage:'planned',implemented:false,summary:'计划通过独立 API 适配器接入',validation:'尚未实现；不支持连接或执行店铺操作。'},
 {id:'shopify',name:'Shopify',stage:'planned',implemented:false,summary:'计划通过独立 API 适配器接入',validation:'尚未实现；不支持连接或执行店铺操作。'},
 {id:'wb',name:'Wildberries',stage:'preview',implemented:true,summary:'扩展预研 · 已有部分读取和人工确认操作代码',validation:'尚无真实账号验证；当前测试使用合成响应，完整接入仍在计划中。'},
 {id:'tiktok_shop',name:'TikTok Shop',stage:'planned',implemented:false,summary:'计划通过独立 API 适配器接入',validation:'尚未实现；不支持连接或执行店铺操作。'},
];
export function marketplaceRegistry(){return structuredClone(platforms);}
export function requireStoreAdapter(store){
 const platform=platforms.find(p=>p.id===store?.marketplace);
 if(!platform)throw Error('marketplace_unknown: 未识别的平台');
 if(!platform.implemented)throw Error('marketplace_planned: '+platform.name+' API 适配器尚未实现');
 if(!['live','mock'].includes(store.mode))throw Error('marketplace_mode_invalid: 店铺模式必须为 live 或 mock');
 return platform.id;
}
