const {createHash} = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const execute = promisify(execFile);
const {openMediaStream} = require('../src/services/safeImageDownload');
const sharp = require('sharp');
// Only use for the explicitly approved public snapshot. The operator binds the
// known site and OSS hosts; no arbitrary hosts, redirects or private IPs allowed.
function createMediaLoader({siteOrigin,allowedHosts,ffmpegPath='ffmpeg',ffprobePath='ffprobe',openStream=openMediaStream}) {
  const origin=new URL(siteOrigin);
  if(origin.protocol!=='https:' || origin.username || origin.password || !Array.isArray(allowedHosts) || !allowedHosts.length)throw Error('Approved public origins required');
  const hosts=new Set(allowedHosts);
  return async work => {
    const address=work.local_path || work[`${work.media}_url`] || work.oss_video_url;
    const url=new URL(address,origin.origin);
    if(!address || !hosts.has(url.hostname) || url.username || url.password || url.protocol!=='https:')throw Error('Unapproved public media host');
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),120000);
    let bytes;
    try {
      const stream=await openStream(url.href,controller.signal);const chunks=[];let size=0;
      const max=work.media==='video'?250*1024*1024:20*1024*1024;
      for await (const chunk of stream) {size+=chunk.length;if(size>max){stream.destroy();throw Error('Media too large');}chunks.push(chunk);}
      bytes=Buffer.concat(chunks);
    } finally {clearTimeout(timer);controller.abort();}
    const sha256=createHash('sha256').update(bytes).digest('hex');
    const encode=async buffer=>({mime:'image/jpeg',base64:(await sharp(buffer,{limitInputPixels:40000000}).rotate().resize({width:1024,height:1024,fit:'inside',withoutEnlargement:true}).jpeg({quality:80}).toBuffer()).toString('base64')});
    if(work.media==='image')return {sha256,images:[await encode(bytes)]};
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'gallery-review-'));await fs.chmod(directory,0o700);
    try {
      const file=path.join(directory,'source.mp4');await fs.writeFile(file,bytes,{mode:0o600});
      const {stdout}=await execute(ffprobePath,['-v','error','-protocol_whitelist','file,pipe','-show_entries','format=duration','-of','json',file],{timeout:15000,maxBuffer:65536});
      const durationSeconds=Number(JSON.parse(stdout).format?.duration);
      if(!Number.isFinite(durationSeconds)||durationSeconds<=0||durationSeconds>1800)throw Error('Invalid or excessive duration');
      const frames=[];
      for(const fraction of [.04,.22,.4,.6,.78,.96]) {
        const timeSeconds=durationSeconds*fraction;
        const frame=await execute(ffmpegPath,['-v','error','-protocol_whitelist','file,pipe','-ss',String(timeSeconds),'-i',file,'-frames:v','1','-vf','scale=1024:1024:force_original_aspect_ratio=decrease','-f','image2pipe','-vcodec','mjpeg','pipe:1'],{encoding:'buffer',timeout:30000,maxBuffer:4*1024*1024});
        frames.push({...await encode(frame.stdout),timeSeconds});
      }
      return {sha256,video:{sha256,durationSeconds,frames}};
    } finally {await fs.rm(directory,{recursive:true,force:true});}
  };
}
module.exports={createMediaLoader};
