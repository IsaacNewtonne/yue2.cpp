// Isolated storage and mocked generation: never alters the real library or GPU queue.
import {chromium} from '../../youtube-agent/node_modules/playwright/index.mjs';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='http://localhost:8087';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const html=await readFile(new URL('../dist/index.html',import.meta.url));
let submits=0,complete=false;const errors=[];
const wav=Buffer.alloc(32044);wav.write('RIFF');wav.writeUInt32LE(32036,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);
await context.route('**/*',async r=>{
 const url=new URL(r.request().url());
 if(url.pathname==='/')return r.fulfill({contentType:'text/html',body:html});
 if(url.pathname==='/synth'){submits++;if(complete)return r.fulfill({json:{id:r.request().headers()['x-yue2-job-id']}});return r.fulfill({status:503,json:{error:'Album fixture: generation unavailable'}});}
 if(url.pathname==='/job'){if(url.searchParams.has('result')){const payload=Buffer.concat([Buffer.from('--fixture\r\nContent-Type: application/json\r\n\r\n'+JSON.stringify({style:'Hip hop',abc_sampling:{},semantic_sampling:{}})+'\r\n--fixture\r\nContent-Type: audio/wav\r\n\r\n'),wav,Buffer.from('\r\n--fixture--\r\n')]);return r.fulfill({contentType:'multipart/mixed; boundary=fixture',body:payload});}return r.fulfill({json:{status:'done',durable:true}});}
 if(url.pathname==='/props')return r.fulfill({json:{model:'Audit',context:24576,sample_rate:48000,defaults:{style:'Hip hop',abc_sampling:{},semantic_sampling:{}}}});
 if(url.pathname==='/presets')return r.fulfill({json:[]});
 return r.fulfill({json:{}});
});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
async function records(dbName,store){return page.evaluate(({dbName,store})=>new Promise((resolve,reject)=>{const r=indexedDB.open(dbName);r.onsuccess=()=>{const db=r.result,q=db.transaction(store).objectStore(store).getAll();q.onsuccess=()=>{resolve(q.result);db.close();};q.onerror=()=>reject(q.error);};r.onerror=()=>reject(r.error);}),{dbName,store});}
async function until(fn,label){for(let i=0;i<100;i++){if(await fn())return;await page.waitForTimeout(100);}throw Error(label);}
const step=name=>page.getByRole('navigation',{name:'Album creation steps'}).getByRole('button',{name:new RegExp(name)}).click();
try{
 await page.goto(base);await page.getByRole('heading',{name:'Create your song'}).waitFor();
 await page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('yue2-songs');r.onsuccess=()=>{const db=r.result,tx=db.transaction('songs','readwrite');const wav=new ArrayBuffer(32044),v=new DataView(wav);const str=(p,s)=>[...s].forEach((c,i)=>v.setUint8(p+i,c.charCodeAt(0)));str(0,'RIFF');v.setUint32(4,32036,true);str(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,32000,true);tx.objectStore('songs').put({name:'Saved fixture',format:'wav',created:Date.now(),style:'Hip hop',seed:1,duration:1,score:'',request:{style:'Hip hop',lyrics:'Saved words',abc_sampling:{},semantic_sampling:{}},audio:new Blob([wav],{type:'audio/wav'}),peaks:new Float32Array(4096)});tx.oncomplete=()=>{db.close();window.dispatchEvent(new Event('yue2-library-changed'));resolve();};tx.onerror=()=>reject(tx.error);};}));
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Albums',exact:true}).click();
 await page.getByLabel('Album name',{exact:true}).fill('Browser audit album');await page.getByRole('button',{name:'Create album',exact:true}).click();
 await page.getByRole('heading',{name:'Browser audit album',exact:true}).waitFor();
 await step('Add saved songs');await page.getByRole('button',{name:'Add to album',exact:true}).click();await page.getByRole('button',{name:'Added ✓',exact:true}).waitFor();
 await step('Add lyrics');await page.getByLabel('Track title',{exact:true}).fill('New lyric fixture');await page.locator('#albums').getByLabel('Lyrics',{exact:true}).fill('[Verse]\nWalking through the city');await page.getByRole('button',{name:'Add lyric track',exact:true}).click();
 await until(async()=> (await records('yue2-albums','albums'))[0].tracks.length===2,'lyrics saved');assert.equal(await page.locator('#albums').getByLabel('Lyrics',{exact:true}).inputValue(),'');
 await page.getByRole('button',{name:'Edit lyrics',exact:true}).click();await page.locator('#albums').getByLabel('Lyrics',{exact:true}).fill('[Verse]\nEdited city lines');await page.getByRole('button',{name:'Save lyric changes',exact:true}).click();
 await until(async()=> (await records('yue2-albums','albums'))[0].tracks[1].lyrics.includes('Edited'),'lyric edit persisted');
 await page.locator('input[type=file][accept=".txt,.md"]').setInputFiles({name:'Imported.txt',mimeType:'text/plain',buffer:Buffer.from('[Chorus]\nImported words')});
 await until(async()=> (await records('yue2-albums','albums'))[0].tracks.length===3,'import saved');
 await step('Arrange');await page.getByRole('button',{name:'Move New lyric fixture up',exact:true}).click();
 await until(async()=> (await records('yue2-albums','albums'))[0].tracks[0].title==='New lyric fixture','order saved');
 await page.locator('.track-order li').filter({hasText:'Imported'}).getByRole('button',{name:'Remove',exact:true}).click();
 await until(async()=> (await records('yue2-albums','albums'))[0].tracks.length===2,'removal saved');
 await step('Generate');await page.getByRole('button',{name:'Generate album',exact:true}).click();
 await until(async()=> (await records('yue2-albums','albums'))[0].status==='paused','failed generation recoverable');assert.equal(submits,1);
 await page.getByRole('button',{name:'Resume album',exact:true}).click();await until(()=>submits===2,'resume submitted');await until(async()=> (await records('yue2-albums','albums'))[0].status==='paused','resume paused');
 assert.equal((await records('yue2-songs','songs')).length,1,'existing audio not duplicated');
 await until(async()=>await page.getByRole('button',{name:'Export album ZIP',exact:true}).isEnabled(),'export enabled');
 const download=page.waitForEvent('download',{timeout:5000}).catch(async e=>{throw Error(e.message+' PAGE: '+await page.locator('body').innerText());});await page.getByRole('button',{name:'Export album ZIP',exact:true}).click();assert.equal((await download).suggestedFilename(),'Browser audit album.zip');
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:/^Library/}).click();assert.equal(await page.locator('#albums').isVisible(),false,'album form absent in Library');
 await page.getByRole('button',{name:'Track actions',exact:true}).click();await page.getByRole('menuitem',{name:'Send to album',exact:true}).click();await page.getByRole('dialog').waitFor();
 await until(async()=> !(await page.getByRole('dialog').innerText()).includes('Loading'),'send dialog loads');assert.deepEqual(errors,[]);
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'Open album Browser audit album',exact:true}).click();await step('Arrange');
 await mkdir(new URL('../../../build/ui-review/',import.meta.url),{recursive:true});
 for(const theme of ['studio','dark','cyberpunk','mint','colorful','burnt-orange']){await page.getByLabel('Color theme',{exact:true}).selectOption(theme);await page.screenshot({path:new URL('../../../build/ui-review/album-'+theme+'.png',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,theme+' overflow');}
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile overflow');
 await page.reload();await page.getByRole('button',{name:'Open album Browser audit album',exact:true}).click();assert.equal((await records('yue2-albums','albums'))[0].tracks[0].title,'New lyric fixture');
 await step('Generate');await page.getByLabel('Generate a shared cover and artwork for new tracks').uncheck();await until(async()=>!(await records('yue2-albums','albums'))[0].artwork,'artwork off');await page.getByLabel('Export new tracks as MP4 (includes artwork)').uncheck();await until(async()=>!(await records('yue2-albums','albums'))[0].video,'video off');
 complete=true;await page.getByRole('button',{name:'Resume album',exact:true}).click();await until(async()=>(await records('yue2-albums','albums'))[0].status==='complete','completed album');assert.equal((await records('yue2-songs','songs')).length,2,'one new song saved');
 const before=submits;await page.getByRole('button',{name:'Generate album',exact:true}).click();await until(async()=>await page.getByRole('button',{name:'Generate album',exact:true}).isEnabled(),'completed rerun');assert.equal(submits,before,'completed tracks are not regenerated');assert.equal((await records('yue2-songs','songs')).length,2);assert.deepEqual(errors,[]);
 console.log('PASS: album creation, saved-song membership, lyric editing/import, reorder/remove, generation failure/resume, ZIP export, Library separation, send dialog, theme/mobile overflow, reload persistence; no page errors. Successful audio completion and repeat-generation deduplication passed. Generation mocked.');
}finally{await context.close();await browser.close();}
