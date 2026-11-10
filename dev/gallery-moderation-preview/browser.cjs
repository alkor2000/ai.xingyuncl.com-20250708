const {chromium}=require('playwright');
const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{
 const media=process.env.TEST_MEDIA==='video'?'video':'image';
 const browser=await chromium.launch({headless:true,executablePath:'/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1100,height:900}}); const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE',e.message);});
 let state='approved',revision=1,posts=[];
 await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1')return route.abort();if(!u.pathname.startsWith('/api/'))return route.continue();
  const req=route.request();let data={};
  if(u.pathname.endsWith('/asset'))return route.fulfill({contentType:media==='video'?'video/mp4':'image/png',body:fs.readFileSync(`/test/fixture.${media==='video'?'mp4':'png'}`)});
  if(req.method()==='POST'){const body=req.postDataJSON();posts.push({path:u.pathname,body});if(u.pathname.endsWith('/visibility')){state=body.action==='down'?'removed':'approved';revision++;}data={temporarily_hidden:true};}
  else if(u.pathname.endsWith('/groups'))data=[{id:10,name:'本地合成班级'}];
  else if(u.pathname.endsWith('/events'))data={threshold:3,reports:[{category:'discrimination',reason:'请检查语境',created_at:'2026-11-10'}],events:[{actor_id:9,state:'removed',reason:'课堂不宜',created_at:'2026-11-10'}]};
  else data={data:[{id:501,username:'本地合成学生',prompt:'本地合成作品',gallery_state:state,group_id:10,group_name:'本地合成班级',machine_decision:'allow',machine_review:{decision:'allow',categories:[],confidence:.9,mapDetected:false,reasons:[{code:'accepted',text:'本地模型夹具允许 / Local model fixture allowed'}],scores:{},checks:[]},moderation_status:'pass',revision,has_asset:true,reports:3,gallery_reason:state==='removed'?'课堂不宜':null}],total:1};
  return route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,data})});
 });
 await page.goto('http://127.0.0.1:4417/dev/gallery-moderation-preview/index.html?media='+media);
 await page.screenshot({path:`/out/${media}-start.png`});
 await page.getByRole('button',{name:/^复\s*核$/}).click();
 const dialog=page.getByRole('dialog');await dialog.getByPlaceholder('请填写处理原因').fill('课堂不宜');await dialog.getByRole('button',{name:/^下\s*架$/}).click();
 await page.getByRole('button',{name:/^复\s*核$/}).click();
 const restore=dialog.getByRole('button',{name:'复核后恢复公开'});assert.equal(await restore.isDisabled(),true);
 await dialog.getByPlaceholder('请填写处理原因').fill('已逐项复核完整作品');if(media==='video'){assert.equal(await dialog.getByRole('checkbox').isDisabled(),true);await dialog.locator('video').evaluate(v=>{v.muted=true;return v.play();});await page.waitForFunction(()=>document.querySelector('video')?.ended);}
 await dialog.getByRole('checkbox').check();assert.equal(await restore.isEnabled(),true);
 await dialog.getByRole('button',{name:'处理记录'}).click();await dialog.getByText('请检查语境').waitFor();
 await page.screenshot({path:`/out/${media}-admin-restore.png`,fullPage:true});await restore.click();
 await page.getByRole('button',{name:/^举\s*报$/}).click();const reportDialog=page.getByRole('dialog');assert.equal(await reportDialog.getByRole('button',{name:/^确\s*[认定]$/}).isDisabled(),true);
 await reportDialog.getByRole('combobox').click();await page.getByText('侮辱或歧视',{exact:true}).last().click();
 await reportDialog.locator('textarea').fill('请检查是否有贬低群体的语境');await page.screenshot({path:`/out/${media}-report.png`,fullPage:true});await reportDialog.getByRole('button',{name:/^确\s*[认定]$/}).click();
 await page.getByRole('button',{name:'举报已提交',exact:true}).waitFor();
 assert.equal(posts.length,3);assert.equal(posts[1].body.reviewed,true);assert.equal(posts[2].body.category,'discrimination');assert.deepEqual(errors,[]);
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:/^复\s*核$/}).click();await page.getByRole('dialog').waitFor({state:'visible'});await page.screenshot({path:`/out/${media}-mobile.png`,fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 fs.writeFileSync(`/out/${media}-browser.json`,JSON.stringify({passed:true,posts,errors,note:'Real components, synthetic local APIs and one-second synthetic MP4; no production access.'},null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
