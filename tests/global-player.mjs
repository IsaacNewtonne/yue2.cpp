// Real browser audio, isolated library and mocked server; never touches user media.
import {chromium} from '../tools/youtube-agent/node_modules/playwright/index.mjs';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1536,height:900}}), errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  localStorage.setItem('yue2-glass-introduced','1');localStorage.setItem('yue2-theme','orange');
  const OriginalAudio=window.Audio;window.testAudio=[];
  window.Audio=function(...args){const audio=new OriginalAudio(...args);window.testAudio.push(audio);return audio;};
  window.EventSource=class{close(){}};
 });
 await page.route('**/*',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/')return route.fulfill({contentType:'text/html',body:await readFile('tools/webui/dist/index.html')});
  if(path==='/jobs'||path==='/presets')return route.fulfill({json:[]});
  return route.fulfill({json:{status:'ok',model:'YuE2-3B-Q8_0',context:24576,sample_rate:48000,defaults:{}}});
 });
 await page.goto('http://localhost:8087');
 await page.waitForFunction(()=>!!document.querySelector('.global-player'));
 await page.evaluate(()=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('yue2-songs');request.onsuccess=()=>{
   const db=request.result,tx=db.transaction('songs','readwrite');
   const samples=8000*30,bytes=new ArrayBuffer(44+samples*2),view=new DataView(bytes);
   const text=(at,value)=>[...value].forEach((c,i)=>view.setUint8(at+i,c.charCodeAt(0)));
   text(0,'RIFF');view.setUint32(4,36+samples*2,true);text(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,samples*2,true);
   for(let i=0;i<samples;i++)view.setInt16(44+i*2,Math.sin(i/8000*440*Math.PI*2)*1000,true);
   for(const name of ['First fixture','Second fixture','Third fixture'])tx.objectStore('songs').put({name,created:Date.now(),audio:new Blob([bytes],{type:'audio/wav'}),originalAudio:new Blob([bytes],{type:'audio/wav'}),duration:30,format:'wav',style:'Test',request:{style:'Test',lyrics:'',abc_sampling:{},semantic_sampling:{}},peaks:new Float32Array(4096).fill(.2)});
   tx.oncomplete=()=>{db.close();window.dispatchEvent(new Event('yue2-library-changed'));resolve();};tx.onerror=()=>reject(tx.error);
  };request.onerror=()=>reject(request.error);
 }));
 const nav=page.getByRole('navigation',{name:'Main navigation'});
 await nav.getByRole('button',{name:/^Library/}).click();
 await page.getByRole('button',{name:'Play First fixture',exact:true}).click();
 await page.waitForFunction(()=>window.testAudio[0]?.currentTime>.3&&!window.testAudio[0].paused);
 const start=await page.evaluate(()=>window.testAudio[0].currentTime);
 for(const name of ['Albums','Create','Home','Library'])await nav.getByRole('button',{name:new RegExp('^'+name)}).click();
 await page.waitForFunction(t=>window.testAudio[0].currentTime>t+.5,start);
 assert.equal(await page.evaluate(()=>window.testAudio.length),1,'one persistent audio element');
 await page.getByRole('button',{name:'Pause First fixture',exact:true}).waitFor();
 await page.getByRole('button',{name:'Pause playback',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.testAudio[0].paused),true);
 await page.getByRole('slider',{name:'Playback position',exact:true}).fill('12');
 assert.ok(Math.abs(await page.evaluate(()=>window.testAudio[0].currentTime)-12)<.2);
 await page.getByRole('button',{name:'Play playback',exact:true}).click();
 await page.waitForFunction(()=>window.testAudio[0].currentTime>12.2);
 await page.getByRole('slider',{name:'Playback volume left',exact:true}).fill('0.25');
 assert.equal(await page.getByRole('slider',{name:'Playback volume right',exact:true}).inputValue(),'0.25');
 assert.equal(await page.evaluate(()=>window.testAudio[0].volume),.25);
 await page.getByRole('button',{name:'Mute playback',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.testAudio[0].volume),0);
 await page.getByRole('button',{name:'Unmute playback',exact:true}).click();
 await page.getByRole('button',{name:'Next track',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.now-playing').textContent==='Third fixture'&&!window.testAudio[0].paused);
 const source=await page.evaluate(()=>window.testAudio[0].src);
 await nav.getByRole('button',{name:'Create',exact:true}).click();
 await page.getByRole('button',{name:'Pause preview',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.testAudio[0].paused),true);
 await page.getByRole('button',{name:'Play preview',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.testAudio[0].src),source,'preview resumes same source');
 await mkdir('build/ui-review',{recursive:true});
 for(const width of [1920,1536,1280,1024,900,768,390]){
  await page.setViewportSize({width,height:900});
  const bounds=await page.locator('.global-player').boundingBox();assert.ok(bounds.width>=300,`usable player width ${width}`);assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1,`player fits ${width}`);
  const header=await page.locator('.topbar').boundingBox();assert.ok(bounds.y+bounds.height<=header.y+header.height+1,`header contains player ${width}`);
 }
 await page.screenshot({path:'build/ui-review/global-player-mobile.png'});
 await page.setViewportSize({width:1536,height:900});await page.screenshot({path:'build/ui-review/global-player-desktop.png'});
 for(const theme of ['orange','studio','dark','mint','cyberpunk','colorful','burnt-orange']) {
  await page.getByLabel('Color theme',{exact:true}).selectOption(theme);
  await page.mouse.move(0,0);await page.waitForTimeout(700);
  const cassette=page.locator('.cassette').nth(1),before=await cassette.evaluate(el=>getComputedStyle(el).transform);
  await cassette.hover();
  for(const delay of [30,160,350]) {await page.waitForTimeout(delay);assert.equal(await cassette.evaluate(el=>getComputedStyle(el).transform),before,theme+' hover preserves cassette position');}
  assert.equal(await cassette.evaluate(el=>getComputedStyle(el).transitionDuration),'0.65s, 0.5s',theme+' retains smooth carousel timing');
  const stage=await page.locator('.carousel-stage').boundingBox(),controls=await page.locator('.transport-buttons').boundingBox();
  assert.ok(Math.abs(stage.x+stage.width/2-controls.x-controls.width/2)<1,theme+' centered transport');
 }
 await page.getByLabel('Color theme',{exact:true}).selectOption('orange');
 await page.mouse.move(0,0);await page.waitForTimeout(700);
 await page.screenshot({path:'build/ui-review/global-player-desktop.png'});
 await page.getByRole('button',{name:'Play cassette Second fixture',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.now-playing').textContent==='Second fixture'&&!window.testAudio[0].paused,{},{timeout:5000}).catch(async error=>{console.log(await page.evaluate(()=>({title:document.querySelector('.now-playing').textContent,paused:window.testAudio[0].paused,buttons:[...document.querySelectorAll('.cassette')].map(b=>({label:b.getAttribute('aria-label'),chosen:b.getAttribute('aria-current')}))})));throw error;});
 await page.getByRole('group',{name:'Cassette track carousel'}).hover();await page.mouse.wheel(0,150);
 await page.waitForFunction(()=>document.querySelector('.now-playing').textContent==='First fixture');
 await page.getByRole('button',{name:'Play cassette First fixture',exact:true}).focus();await page.keyboard.press('ArrowRight');
 await page.waitForFunction(()=>document.querySelector('.now-playing').textContent==='Third fixture');
 const carousel=await page.locator('.carousel-stage').boundingBox();
 await page.mouse.move(carousel.x+carousel.width/2,carousel.y+25);await page.mouse.down();await page.mouse.move(carousel.x+carousel.width/2-60,carousel.y+25,{steps:8});await page.mouse.up();
 await page.waitForFunction(()=>document.querySelector('.now-playing').textContent==='Second fixture');
 assert.equal(await page.locator('.cassette.chosen .reel').first().evaluate(el=>getComputedStyle(el).animationPlayState),'running');
 await page.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await page.locator('.cassette.chosen .reel').first().evaluate(el=>getComputedStyle(el).animationName),'none');
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.getByRole('slider',{name:'Playback position',exact:true}).fill('29.8');
 await page.waitForFunction(()=>window.testAudio[0].paused&&window.testAudio[0].currentTime===0);
 await page.getByRole('button',{name:'Play playback',exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 console.log('PASS: real audio continues across tabs; shared card/preview/banner controls, seek, volume, mute, track switching, single source, responsive banner, cassette click/wheel/keyboard/swipe, spinning reels, reduced motion and natural ending.');
} finally {await browser.close();}
