const {chromium}=require('playwright');const fs=require('fs');const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1100,height:900}});const errors=[],posts=[],queries=[];page.on('pageerror',e=>errors.push(e.message));
 const result=(decision,map=false)=>({decision,mapDetected:map,confidence:.9,categories:map?['map']:[],reasons:[{code:'fixture',text:'合成审核说明 / Synthetic review reason'}],scores:{map:map?.5:0},checks:[{scores:{map:map?.5:0}}]});
 const rows=[501,502,503].map(id=>({id,username:'合成学生',group_id:10,group_name:'合成班级',prompt:'合成课堂作品',gallery_state:'pending',revision:1,has_asset:true,moderation_status:'pass',machine_decision:id===503?'review':'allow',map_detected:id===503,machine_review:result(id===503?'review':'allow',id===503)}));
 await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.hostname!=='127.0.0.1')return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue();let data={};
 if(url.pathname.endsWith('/asset'))return route.fulfill({contentType:'image/png',body:fs.readFileSync('/test/fixture.png')});
 if(request.method()==='POST'){const body=request.postDataJSON();posts.push({path:url.pathname,body});if(url.pathname.endsWith('/batch')){rows[0].gallery_state='approved';rows[1].revision=2;data={applied:1,failed:1,results:[{id:501,success:true},{id:502,success:false,message:'记录已变更，请刷新'}]};}else data={gallery_status:'approved'};}
 else if(url.pathname.endsWith('/groups'))data=[{id:10,name:'合成班级'}];
 else {queries.push(Object.fromEntries(url.searchParams));let filtered=rows.filter(r=>r.gallery_state===(url.searchParams.get('state')||'pending'));const m=url.searchParams.get('machine');if(m==='allow')filtered=filtered.filter(r=>r.machine_decision==='allow');if(m==='map')filtered=filtered.filter(r=>r.map_detected);data=url.pathname.endsWith('/selection')?{items:filtered}:{data:filtered,total:filtered.length};}
 return route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,data})});
 });
 await page.goto('http://127.0.0.1:4417/dev/gallery-moderation-preview/index.html');
 await page.getByRole('combobox',{name:'机器检查结果'}).locator('xpath=../..').click();await page.locator('.ant-select-item-option').filter({hasText:'机器放行，待人工批准'}).click();
 await page.getByRole('button',{name:'全选筛选结果（最多100条）'}).click();await page.getByText('已选 2 条',{exact:true}).waitFor();await page.getByRole('button',{name:'批量批准公开',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByRole('textbox',{name:'本批处理理由'}).fill('已核对本批所选作品');await dialog.getByRole('checkbox').check();await page.screenshot({path:'/out/batch-confirm.png',fullPage:true});await dialog.getByRole('button',{name:/OK|确\s*定/}).click();
 await page.getByText('已处理 1 条，未处理 1 条',{exact:true}).waitFor();assert.equal(posts[0].body.items.length,2);assert.equal(posts[0].body.confirmed,true);
 await page.getByRole('combobox',{name:'机器检查结果'}).locator('xpath=../..').click();await page.locator('.ant-select-item-option').filter({hasText:'地图须逐件复核'}).click();
 await page.getByRole('button',{name:'全选筛选结果（最多100条）'}).click();await page.getByText('已选 1 条',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'批量批准公开',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:/^复\s*核$/}).click();await dialog.getByPlaceholder('请填写处理原因').fill('核验地图来源和使用范围');await dialog.getByRole('checkbox').check();const approve=dialog.getByRole('button',{name:'审核通过并公开',exact:true});assert.equal(await approve.isDisabled(),true);
 await dialog.getByRole('textbox',{name:'地图来源（官方地址或自绘说明）'}).fill('合成官方地图来源');await dialog.getByRole('textbox',{name:'审图号或版本／非真实疆界说明'}).fill('fixture-001');await dialog.getByRole('textbox',{name:'已核验的使用范围'}).fill('仅测试课堂');assert.equal(await approve.isEnabled(),true);await page.screenshot({path:'/out/map-review.png',fullPage:true});await approve.click();
 assert.equal(posts[1].body.mapReview.approval,'fixture-001');assert.deepEqual(errors,[]);assert(queries.some(x=>x.machine==='allow'));assert(queries.some(x=>x.machine==='map'));
 fs.writeFileSync('/out/batch-browser.json',JSON.stringify({passed:true,posts,queries,errors,fixture:true},null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
