import type { Song, Yue2Request } from './types.js';
import { synthSubmit, pollJob, jobResultTracks, parseMultipartParts, JobTerminalError } from './api.js';
import { putJobSongs } from './db.js';

export interface EnsembleTake { profile:string; seed:number; lmSeed:number; job?:string; mix?:Blob; score?:string; request?:Yue2Request; stemJob?:string; vocals?:Blob; backing?:Blob; }
export interface EnsembleProject { id:string; name:string; lyrics:string; seconds:number; bpm:number; style:string; order:number[]; takes:EnsembleTake[]; output?:Blob; duration?:number; stage:string; saved?:boolean; mixId?:string; }
export function validateOrder(text:string,count:number):number[] {
 const items=text.split(',').map(s=>s.trim());
 if(!items.length || items.length>12 || items.some(s=>!/^\d+$/.test(s) || Number(s)<1 || Number(s)>count))throw new Error(`Use 1–${count}, separated by commas, with at most 12 sections.`);
 return items.map(s=>Number(s)-1);
}
export function takeRequest(p:EnsembleProject,index:number):Yue2Request {
 const take=p.takes[index];
 if(index>0 && !p.takes[0].score?.trim())throw new Error('The first voice has no composition score. Start a new ensemble.');
 return {style:`${p.style}\n${p.bpm} BPM. One solo vocalist: ${take.profile}. Natural human vocal performance, clear words, no choir, no doubled lead, no vocoder. Start the supplied passage immediately, with sparse drums and quiet accompaniment. Follow the supplied score when present.`,lyrics:p.lyrics,duration:p.seconds,abc:index>0?p.takes[0].score:undefined,lm_seed:take.lmSeed,seed:take.seed,steps:32,lm_batch_size:1,synth_batch_size:1,output_format:'wav16',mastering_profile:'off',abc_sampling:{},semantic_sampling:{}};
}
function database():Promise<IDBDatabase> {return new Promise((resolve,reject)=>{const r=indexedDB.open('yue2-ensemble',1);r.onupgradeneeded=()=>r.result.createObjectStore('projects');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function saveEnsemble(project:EnsembleProject) {
 const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('projects','readwrite');tx.objectStore('projects').put(project,'current');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}
}
export async function loadEnsemble():Promise<EnsembleProject|undefined> {
 const db=await database();try{return await new Promise((resolve,reject)=>{const r=db.transaction('projects').objectStore('projects').get('current');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}
}
export async function clearEnsemble(){const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('projects','readwrite');tx.objectStore('projects').delete('current');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}finally{db.close();}}
const id=()=>crypto.randomUUID().replaceAll('-','');
async function stems(t:EnsembleTake,signal:AbortSignal,save:()=>Promise<void>){
 t.stemJob??=id();await save();
 const form=new FormData();form.append('audio',t.mix!,'mix.wav');form.append('vocal_gain_db','0');form.append('stems_only','1');
 const r=await fetch('vocal-balance',{method:'POST',headers:{'X-Yue2-Job-Id':t.stemJob},body:form,signal});
 if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error || 'Could not start vocal separation');
 await pollJob(t.stemJob,signal);
 const result=await fetch(`job?id=${t.stemJob}&result=1`,{signal});if(!result.ok)throw new Error('Could not retrieve vocal stems');
 const boundary=result.headers.get('content-type')?.match(/boundary=([^;\s]+)/)?.[1];if(!boundary)throw new Error('Missing stem boundary');
 const parts=parseMultipartParts(new Uint8Array(await result.arrayBuffer()),boundary);
 if(parts.length!==2 || parts.some(b=>b.type!=='audio/wav'))throw new Error('Expected vocals and backing stems');
 [t.vocals,t.backing]=parts;await save();
}
export async function runEnsemble(p:EnsembleProject,signal:AbortSignal,update:(p:EnsembleProject)=>void){
 const save=async()=>{await saveEnsemble(p);update(p);};
 const jobs=await fetch('jobs',{signal});if(!jobs.ok)throw new Error('Cannot check the server queue');
 const active=await jobs.json();const owned=new Set(p.takes.flatMap(t=>[t.job,t.stemJob]).filter(Boolean));
 if(active.some((j:{id:string})=>!owned.has(j.id)))throw new Error('The server is busy with another operation. Resume after it finishes.');
 const capabilities=await fetch('capabilities',{signal}).then(r=>r.json());if(!capabilities.separator||!capabilities.ffmpeg)throw new Error('Vocal separation and FFmpeg are required.');
 // Finish generation before separation, keeping one GPU job active at a time.
 for(let i=0;i<p.takes.length;i++){
  signal.throwIfAborted();const t=p.takes[i];if(t.mix)continue;
  p.stage=`Generating voice ${i+1} of ${p.takes.length}`;
  t.job??=id();await save();
  try{
   await synthSubmit(takeRequest(p,i),'wav16',t.job);await pollJob(t.job,signal);
   const tracks=await jobResultTracks(t.job);if(tracks.length!==1)throw new Error('Expected one generated take');
   t.mix=tracks[0].audio;t.score=tracks[0].request.abc;t.request=tracks[0].request;await save();
  }catch(e){if(e instanceof JobTerminalError){t.job=undefined;await save();}throw e;}
 }
 for(let i=0;i<p.takes.length;i++){
  signal.throwIfAborted();const t=p.takes[i];if(t.vocals&&t.backing)continue;
  p.stage=`Separating voice ${i+1} of ${p.takes.length}`;await save();
  try{await stems(t,signal,save);}catch(e){if(e instanceof JobTerminalError){t.stemJob=undefined;await save();}throw e;}
 }
 signal.throwIfAborted();p.stage='Ready to mix';await save();
}
export function encodeWav(left:Float32Array,right:Float32Array,rate:number):Blob {
 const buffer=new ArrayBuffer(44+left.length*4),view=new DataView(buffer);const text=(offset:number,s:string)=>[...s].forEach((c,i)=>view.setUint8(offset+i,c.charCodeAt(0)));
 text(0,'RIFF');view.setUint32(4,buffer.byteLength-8,true);text(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);view.setUint32(24,rate,true);view.setUint32(28,rate*4,true);view.setUint16(32,4,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,left.length*4,true);
 for(let i=0;i<left.length;i++){view.setInt16(44+i*4,Math.round(Math.max(-1,Math.min(1,left[i]))*32767),true);view.setInt16(46+i*4,Math.round(Math.max(-1,Math.min(1,right[i]))*32767),true);}
 return new Blob([buffer],{type:'audio/wav'});
}
export async function mixEnsemble(p:EnsembleProject):Promise<void>{
 validateOrder(p.order.map(i=>i+1).join(','),p.takes.length);
 const ctx=new OfflineAudioContext(2,1,44100);
 const decode=async(b:Blob|undefined)=>{if(!b)throw new Error('Generate all voice stems first');return ctx.decodeAudioData(await b.arrayBuffer());};
 const backing=await decode(p.takes[0].backing);const vocals=await Promise.all(p.takes.map(t=>decode(t.vocals)));
 const n=backing.length,rate=backing.sampleRate;
 if(vocals.some(v=>Math.abs(v.length-n)>rate*.1))throw new Error('Take lengths differ by more than 100 ms. Review the takes before mixing.');
 const rms=(v:AudioBuffer)=>{let energy=0;for(let c=0;c<v.numberOfChannels;c++){const a=v.getChannelData(c);for(const x of a)energy+=x*x;}return Math.sqrt(energy/(v.length*v.numberOfChannels));};
 const target=rms(vocals[0]);if(target<.00001)throw new Error('The first vocal stem is silent. Generate a new ensemble.');
 const gains=vocals.map(v=>Math.min(3,target/Math.max(rms(v),.00001)));
 const left=new Float32Array(n*p.order.length),right=new Float32Array(left.length);let peak=0;
 p.order.forEach((voice,section)=>{for(let c=0;c<2;c++){const b=backing.getChannelData(Math.min(c,backing.numberOfChannels-1)),v=vocals[voice].getChannelData(Math.min(c,vocals[voice].numberOfChannels-1)),out=c?right:left;
  for(let i=0;i<n;i++){const fade=Math.max(0,Math.min(1,i/(rate*.035),(n-1-i)/(rate*.035)));const value=(b[i]+(v[i]||0)*gains[voice])*fade;out[section*n+i]=value;peak=Math.max(peak,Math.abs(value));}
 }});
 const gain=Math.min(1,.94/Math.max(peak,.00001));for(let i=0;i<left.length;i++){left[i]*=gain;right[i]*=gain;}
 p.output=encodeWav(left,right,rate);p.duration=left.length/rate;p.stage='Preview ready';p.saved=false;p.mixId=id();await saveEnsemble(p);
}
export async function saveEnsembleSong(p:EnsembleProject){
 if(!p.output)throw new Error('Mix the ensemble first');
 const first=p.takes[0];
 const request:Yue2Request={style:p.style,lyrics:p.order.map(i=>`[Voice ${i+1}]\n${p.lyrics}`).join('\n\n'),duration:p.duration,abc_sampling:{},semantic_sampling:{},output_format:'wav16'};
 const song:Song={name:p.name,format:'wav16',created:Date.now(),style:p.style,seed:first.lmSeed,duration:p.duration||0,score:'',request,audio:p.output,ensemble:{profiles:p.takes.map(t=>t.profile),order:p.order,sectionSeconds:(p.duration||0)/p.order.length}};
 await putJobSongs(`ensemble-${p.id}-${p.mixId}`, [song]);p.saved=true;await saveEnsemble(p);
}
