import {chromium} from '../../youtube-agent/node_modules/playwright/index.mjs';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage();const html=await readFile(new URL('../dist/index.html',import.meta.url));
await page.addInitScript(()=>{window.EventSource=class {constructor(){setTimeout(()=>this.onopen?.({}),20)}close(){}};});
let job={id:'eta-test',stage:'Composing score',elapsed:12,done:700,total:4096};const errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',r=>{
 const p=new URL(r.request().url()).pathname;
 if(p==='/')return r.fulfill({contentType:'text/html',body:html});
 if(p==='/jobs')return r.fulfill({json:job?[job]:[]});
 if(p==='/logs')return r.fulfill({contentType:'text/event-stream',body:'retry: 50\ndata: [Test] connected\n\n'});
 if(p==='/props')return r.fulfill({json:{model:'test',sample_rate:48000,context:24576,defaults:{style:'Soul',abc_sampling:{},semantic_sampling:{}}}});
 return r.fulfill({json:p==='/presets'?[]:{}});
});
try{
 await page.goto('http://localhost:8087');
 await page.waitForFunction(()=>document.querySelector('.progress-detail')?.textContent.includes('Stage 17%'));
 const cached=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('yue2-generation-eta-v1')));
 const start=await cached();assert.ok(start.snapshot.percent<5);
 job={...job,stage:'Composing performance',elapsed:50,done:3000,total:9000};
 await page.waitForFunction(()=>document.querySelector('.progress-detail')?.textContent.includes('Stage 33%'));
 const middle=await cached();assert.ok(middle.snapshot.percent>=start.snapshot.percent);
 await page.reload();await page.waitForFunction(()=>document.querySelector('.progress-detail')?.textContent.includes('Stage 33%'));
 assert.ok((await cached()).snapshot.percent>=middle.snapshot.percent);
 job=null;await page.waitForFunction(()=>document.querySelector('.progress-detail')?.textContent.includes('No server jobs queued'));
 assert.equal((await cached()).snapshot,null);assert.deepEqual(errors,[]);
 console.log('PASS: overall progress, independent stage detail, reload continuity, idle reset, no browser errors.');
}finally{await browser.close()}
