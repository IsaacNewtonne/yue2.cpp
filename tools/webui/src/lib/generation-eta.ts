export interface JobProgress { id:string; stage:string; done:number; total:number; elapsed:number; }
// Initial estimates measured on this studio's 360-second, 32-step MP3 render.
// They are estimates, not deadlines. Learned durations replace them over time.
export const initialTimings = [69,143,320,10,150];
export function phaseIndex(stage:string):number {
 if(stage==='Composing score')return 0;
 if(stage==='Composing performance')return 1;
 if(stage.startsWith('Rendering audio'))return 2;
 if(stage==='Decoding audio')return 3;
 if(stage==='Encoding and mastering')return 4;
 return -1;
}
export interface EtaSnapshot { id:string; phase:number; elapsed:number; spent:number; percent:number; }
export class GenerationEta {
 timings:number[];
 snapshot:EtaSnapshot|null=null;
 constructor(timings:unknown=initialTimings,snapshot:unknown=null){
  this.timings=Array.isArray(timings)&&timings.length===5&&timings.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0&&n<86400)?[...timings]:[...initialTimings];
  const s=snapshot as EtaSnapshot|null;
  if(s && typeof s.id==='string' && Number.isInteger(s.phase) && s.phase>=0 && s.phase<5 && [s.elapsed,s.spent,s.percent].every(n=>Number.isFinite(n)&&n>=0) && s.percent<100)this.snapshot=s;
 }
 update(job:JobProgress){
  const phase=phaseIndex(job.stage);
  if(phase<0)return null;
  const elapsed=Math.max(0,Number.isFinite(job.elapsed)?job.elapsed:0);
  let s=this.snapshot;
  if(!s || s.id!==job.id){s={id:job.id,phase,elapsed:0,spent:this.timings.slice(0,phase).reduce((a,b)=>a+b,0),percent:0};this.snapshot=s;}
  if(phase!==s.phase){
   // Rendering announces each chunk with two stage names. They are one phase.
   if(phase>s.phase){this.timings[s.phase]=Math.max(1,.6*this.timings[s.phase]+.4*s.elapsed);s.spent+=s.elapsed;}
   s.phase=phase;s.elapsed=0;
  }
  // The server's rendering stage timer resets around chunk boundaries. Keep
  // accumulated wall time using poll deltas, rather than treating a reset as 0.
  const previous=this.last;
  const now=Date.now();
  if(previous && previous.id===job.id && previous.phase===phase){
   s.elapsed+=Math.max(0,(now-previous.time)/1000);
   s.elapsed=Math.max(s.elapsed,elapsed);
  }else s.elapsed=Math.max(s.elapsed,elapsed);
  this.last={id:job.id,phase,time:now};
  const fraction=job.total>0&&job.done>0?Math.min(.999,job.done/job.total):0;
  // Do not extrapolate chunk steps as equal-cost: the final short chunk can
  // be far quicker. Use learned wall time for the render phase instead.
  const liveTotal=fraction>0.02 && phase<2 ? elapsed/fraction : this.timings[phase];
  const currentRemaining=Math.max(5,liveTotal-s.elapsed);
  const future=this.timings.slice(phase+1).reduce((a,b)=>a+b,0);
  const remaining=currentRemaining+future;
  const complete=s.spent+s.elapsed;
  s.percent=Math.max(s.percent,Math.min(99,100*complete/(complete+remaining)));
  return {eta:remaining,percent:s.percent,elapsed:complete};
 }
 private last:{id:string;phase:number;time:number}|null=null;
 clear(){this.snapshot=null;this.last=null;}
}
