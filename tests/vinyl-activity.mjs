import {chromium} from '../tools/youtube-agent/node_modules/playwright/index.mjs';
import {readFile, mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';

await mkdir('build/ui-review/vinyl', {recursive:true});
const browser = await chromium.launch({channel:'msedge',headless:true});
try {
 const page = await browser.newPage({viewport:{width:1440,height:1080}});
 const errors=[];page.on('pageerror', e=>errors.push(e.message));
 let jobs=[], status='done';
 await page.addInitScript(()=>{
  localStorage.setItem('yue2-theme','mint');
  localStorage.setItem('yue2-generation-eta-v1', JSON.stringify({snapshot:{id:'vinyl-demo',phase:2,elapsed:100,spent:200,percent:64}}));
  window.EventSource=class {
   constructor(){setTimeout(()=>{this.onopen?.();this.onmessage?.({data:'[NAR] Rendering audio'});},50);}
   close(){}
  };
 });
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:await readFile('tools/webui/dist/index.html')});
  if(url.pathname==='/jobs')return route.fulfill({json:jobs});
  if(url.pathname==='/job')return route.fulfill({json:{status,durable:true}});
  if(url.pathname==='/presets')return route.fulfill({json:[]});
  if(url.pathname.endsWith('/tags'))return route.fulfill({json:{models:[]}});
  return route.fulfill({json:{status:'ok',defaults:{},sample_rate:48000,context:24576}});
 });
 jobs=[{id:'vinyl-demo',stage:'Rendering audio',done:16,total:32,elapsed:100}];
 await page.goto('http://localhost:8087');
 const card=page.locator('.vinyl-activity').first();
 const progress=card.getByRole('progressbar');
 await card.getByRole('heading',{name:'Rendering audio',exact:true}).waitFor();
 await page.waitForFunction(()=>document.querySelector('.vinyl-activity [role=progressbar]')?.getAttribute('aria-valuenow')==='64');
 assert.equal(await card.getByRole('region',{name:'Server activity log'}).count(),0);
 assert.equal(await card.locator('.record-spin').evaluate(el=>getComputedStyle(el).animationPlayState),'running');
 await card.screenshot({path:'build/ui-review/vinyl/progress.png',animations:'disabled'});
 await card.getByRole('button',{name:/Detailed logs/}).click();
 assert.equal(await card.getByRole('region',{name:'Server activity log'}).count(),1);
 await card.getByRole('button',{name:/Detailed logs/}).click();
 jobs=[];status='done';
 await card.getByRole('heading',{name:'Track complete',exact:true}).waitFor();
 assert.equal(await progress.getAttribute('aria-valuenow'),'100');
 assert.equal(await card.locator('.record-spin').evaluate(el=>getComputedStyle(el).animationPlayState),'paused');
 await card.screenshot({path:'build/ui-review/vinyl/complete.png',animations:'disabled'});
 jobs=[{id:'vinyl-unknown',stage:'Preparing models',done:0,total:0,elapsed:0}];
 await card.getByRole('heading',{name:'Preparing models',exact:true}).waitFor();
 assert.equal(await progress.getAttribute('aria-valuenow'),null,'unknown progress is indeterminate');
 await page.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await card.locator('.record-spin').evaluate(el=>getComputedStyle(el).animationName),'none');
 jobs=[];status='cancelled';
 await card.getByRole('heading',{name:'Generation cancelled',exact:true}).waitFor();
 assert.notEqual(await progress.getAttribute('aria-valuenow'),'100','cancelled job must not look complete');
 await page.setViewportSize({width:390,height:844});
 await card.screenshot({path:'build/ui-review/vinyl/mobile.png',animations:'disabled'});
 assert.ok(await card.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
 assert.deepEqual(errors,[]);
 console.log('PASS: vinyl progress, confirmed completion, cancellation, indeterminate state, log dropdown, reduced motion, mobile fit; isolated mocked browser.');
} finally {await browser.close();}
