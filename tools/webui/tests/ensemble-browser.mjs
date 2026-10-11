import {chromium} from '../../youtube-agent/node_modules/playwright/index.mjs';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const html=await readFile(new URL('../dist/index.html',import.meta.url));
const wav=(freq,amp)=>{const n=44100,b=Buffer.alloc(44+n*4);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(44100,24);b.writeUInt32LE(176400,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*4,40);for(let i=0;i<n;i++){const v=Math.round(Math.sin(i*2*Math.PI*freq/44100)*amp);b.writeInt16LE(v,44+i*4);b.writeInt16LE(v,46+i*4);}return b;};
const jobs=new Map(),requests=[],stemRequests=[];let hold=true;
const multipart=(parts)=>Buffer.concat(parts.flatMap(([type,body])=>[Buffer.from(`--fixture\r\nContent-Type: ${type}\r\n\r\n`),body,Buffer.from('\r\n')]).concat(Buffer.from('--fixture--\r\n')));
await context.route('**/*',async r=>{
 const u=new URL(r.request().url()),p=u.pathname;
 if(p==='/')return r.fulfill({contentType:'text/html',body:html});
 if(p==='/props')return r.fulfill({json:{model:'fixture',sample_rate:48000,context:24576,defaults:{style:'Soul',abc_sampling:{},semantic_sampling:{}}}});
 if(p==='/capabilities')return r.fulfill({json:{separator:true,ffmpeg:true}});
 if(p==='/jobs')return r.fulfill({json:[]});
 if(p==='/synth'){const id=r.request().headers()['x-yue2-job-id'];if(!jobs.has(id)){const request=r.request().postDataJSON();requests.push(request);jobs.set(id,{request,kind:'synth',index:requests.length});}return r.fulfill({json:{id}});}
 if(p==='/vocal-balance'){const id=r.request().headers()['x-yue2-job-id'];assert.match(r.request().postData(),/stems_only/);if(!jobs.has(id)){stemRequests.push(id);jobs.set(id,{kind:'stems',index:stemRequests.length});}return r.fulfill({json:{id}});}
 if(p==='/job'){
  const j=jobs.get(u.searchParams.get('id'));if(!j)return r.fulfill({status:404,json:{error:'unknown'}});
  if(u.searchParams.has('result')){const parts=j.kind==='synth'?[['application/json',Buffer.from(JSON.stringify({...j.request,abc:'X:1\nM:4/4\nK:C\nC4|',semantic_tokens:'1,2,3'}))],['audio/wav',wav(220,3000)]]:[['audio/wav',wav(220*j.index,3000)],['audio/wav',wav(110,1000)]];return r.fulfill({contentType:'multipart/mixed; boundary=fixture',body:multipart(parts)});}
  return r.fulfill({json:{status:hold?'running':'done',durable:true}});
 }
 return r.fulfill({json:p==='/presets'?[]:{}});
});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
async function open(){await page.goto('http://localhost:8087');await page.locator('.ensemble-builder > summary').click();}
try{
 await open();await page.getByLabel('Different voices',{exact:true}).selectOption('3');
 await page.getByLabel('Ensemble passage lyrics').fill('[Hook]\nJust enough to stand');
 await page.getByLabel('Ensemble title').fill('Ensemble integration test');
 await page.getByRole('button',{name:'Generate separate vocal takes',exact:true}).click();
 for(let i=0;i<60&&!requests.length;i++)await page.waitForTimeout(100);
 assert.equal(requests.length,1);assert.equal(requests[0].abc,undefined);
 await page.getByRole('button',{name:'Pause after current server job',exact:true}).click();
 await page.getByRole('button',{name:'Resume ensemble',exact:true}).waitFor();
 await page.reload();await page.locator('.ensemble-builder > summary').click();
 await page.getByRole('button',{name:'Resume ensemble',exact:true}).waitFor();hold=false;
 await page.getByRole('button',{name:'Resume ensemble',exact:true}).click();
 await page.getByRole('button',{name:'Mix shared backing preview',exact:true}).waitFor({timeout:45000});
 assert.equal(requests.length,3,'resume must not duplicate the first generation');assert.equal(stemRequests.length,3);
 assert.equal(requests[1].abc,'X:1\nM:4/4\nK:C\nC4|');assert.equal(requests[2].abc,requests[1].abc);
 assert.equal(new Set(requests.map(r=>r.seed)).size,3);
 assert.ok(requests.every(r=>!r.semantic_tokens),'each singer receives fresh performance tokens');
 await page.getByLabel('Ensemble voice order').fill('1,9');await page.getByRole('button',{name:'Mix shared backing preview',exact:true}).click();await page.locator('.ensemble-builder [role=alert]').waitFor();
 await page.getByLabel('Ensemble voice order').fill('1,2,3,2');await page.getByRole('button',{name:'Mix shared backing preview',exact:true}).click();
 await page.getByRole('button',{name:'Save ensemble to Library',exact:true}).waitFor();
 const metrics=await page.evaluate(async()=>{const a=document.querySelector('.ensemble-builder audio'),b=await(await fetch(a.src)).arrayBuffer(),ctx=new OfflineAudioContext(2,1,44100),decoded=await ctx.decodeAudioData(b);const x=decoded.getChannelData(0),n=x.length/4;let peak=0,same=true;for(let i=0;i<x.length;i++)peak=Math.max(peak,Math.abs(x[i]));for(let i=0;i<n;i++)if(x[n+i]!==x[3*n+i])same=false;return {duration:decoded.duration,peak,same};});
 assert.equal(metrics.duration,4);assert.ok(metrics.peak<1);assert.ok(metrics.same,'hook reuse must be sample-identical');
 await page.getByRole('button',{name:'Save ensemble to Library',exact:true}).click();await page.getByRole('button',{name:'Saved to Library',exact:true}).waitFor();
 await page.reload();await page.locator('.ensemble-builder > summary').click();await page.getByRole('button',{name:'Saved to Library',exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await mkdir(new URL('../../../build/ui-review/',import.meta.url),{recursive:true});
 await page.locator('.ensemble-builder').screenshot({path:new URL('../../../build/ui-review/ensemble-builder.png',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')});
 await page.getByRole('button',{name:'New ensemble',exact:true}).click();await page.getByLabel('Ensemble passage lyrics').waitFor();
 await page.reload();await page.locator('.ensemble-builder > summary').click();await page.getByLabel('Ensemble passage lyrics').waitFor();
 assert.deepEqual(errors,[]);console.log('PASS: persistent resume, 3 fresh voices sharing exact score, 3 stem jobs, order validation, shared backing mix, identical hook return, library save, reload, mobile.',metrics);
}finally{await browser.close()}
