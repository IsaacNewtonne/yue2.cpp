import {chromium} from '../../youtube-agent/node_modules/playwright/index.mjs';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage();
const html=await readFile(new URL('../dist/index.html',import.meta.url));
let submitted;const errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',r=>{
 const p=new URL(r.request().url()).pathname;
 if(p==='/')return r.fulfill({contentType:'text/html',body:html});
 if(p==='/synth'){submitted=r.request().postDataJSON();return r.fulfill({status:503,json:{error:'Test stops before GPU generation'}});}
 if(p==='/props')return r.fulfill({json:{model:'test',sample_rate:48000,context:24576,defaults:{style:'Soul',abc_sampling:{},semantic_sampling:{}}}});
 return r.fulfill({json:p==='/jobs'||p==='/presets'?[]:{}});
});
try{
 await page.goto('http://localhost:8087');
 await page.getByLabel('Different voices',{exact:true}).selectOption('3');
 const lyrics='## [Verse 1]\nFirst singer words\n\n## [Hook]\nSecond singer words\n\n## [Verse 2]\nThird singer words';
 await page.locator('#lyrics-editor textarea').evaluate((e,text)=>{e.value=text;e.dispatchEvent(new Event('input',{bubbles:true}));},lyrics);
 await page.locator('.cast-assignments').getByText('Verse 2 - Voice 3',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Repeat existing hook before outro',exact:true}).click();
 assert.match(await page.locator('#lyrics-editor textarea').inputValue(),/\[Final Chorus\]\nSecond singer words/);
 assert.equal(await page.locator('.section-plan li.chorus').count(),2);
 await page.getByRole('button',{name:'Undo chorus repeat',exact:true}).click();
 assert.equal(await page.locator('#lyrics-editor textarea').inputValue(),lyrics);
 await page.getByRole('button',{name:'Repeat existing hook before outro',exact:true}).click();
 const arranged=await page.locator('#lyrics-editor textarea').inputValue();
 await page.locator('.generate-btn').click();
 for(let i=0;i<50&&!submitted;i++)await page.waitForTimeout(100);
 assert.ok(submitted,'generation request intercepted');
 for(const n of [1,2,3])assert.match(submitted.lyrics,new RegExp(`Voice ${n}`));
 assert.equal(await page.locator('#lyrics-editor textarea').inputValue(),arranged);
 assert.match(submitted.style,/Section performance plan/);
 assert.match(submitted.style,/repeat that core melody/);
 assert.match(submitted.lyrics,/\[Final Chorus - Voice 2\]/);
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);
 console.log('PASS: cast, chorus repeat/undo, stable chorus singer, section performance instructions, editor preserved, mobile width; no GPU job or browser errors.');
}finally{await browser.close()}
