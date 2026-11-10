// Existing, operator-approved model endpoints only. No discovery, credentials in logs, or media URL fetches.
export function createOpenAIAdapter({endpoint,apiKey,model,fetchImpl=globalThis.fetch,allowLoopbackHTTP=false,onUsage}) {
  const url=new URL(endpoint);
  const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(url.username||url.password||url.hash||url.search||!(url.protocol==='https:'||allowLoopbackHTTP&&loopback&&url.protocol==='http:'))throw Error('Invalid configured model endpoint');
  if(typeof apiKey!=='string'||!apiKey.trim()||typeof model!=='string'||!model.trim())throw Error('Existing model configuration required');
  if(onUsage!==undefined&&typeof onUsage!=='function')throw Error('Invalid usage observer');
  return async({system,text,images=[],maxOutputTokens=600,signal})=>{
    const content=[{type:'text',text:JSON.stringify({untrusted_text:text})},...images.map(x=>({type:'image_url',image_url:{url:`data:${x.mime};base64,${x.base64}`}}))];
    const response=await fetchImpl(url.href,{method:'POST',redirect:'error',signal,headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model,temperature:0,max_tokens:maxOutputTokens,messages:[{role:'system',content:system},{role:'user',content}]})});
    if(!response.ok)throw Error('Model request failed');
    const reader=response.body?.getReader();if(!reader)throw Error('Missing model body');
    const chunks=[];let size=0;
    try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024*1024){await reader.cancel();throw Error('Model response too large');}chunks.push(value);}}
    finally{reader.releaseLock();}
    const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const usage={};
    for(const key of ['prompt_tokens','completion_tokens','total_tokens','prompt_cache_hit_tokens','prompt_cache_miss_tokens'])if(Number.isSafeInteger(data.usage?.[key])&&data.usage[key]>=0)usage[key]=data.usage[key];
    if(onUsage)onUsage({model:typeof data.model==='string'?data.model.slice(0,120):null,usage});
    const choice=data.choices?.[0];if(choice?.finish_reason!=='stop'||typeof choice.message?.content!=='string')throw Error('Incomplete model response');
    return JSON.parse(choice.message.content);
  };
}
