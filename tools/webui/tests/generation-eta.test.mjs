import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GenerationEta} from '../src/lib/generation-eta.ts';
test('score ETA includes every remaining phase and progress does not reset',()=>{
 const e=new GenerationEta();
 const score=e.update({id:'a',stage:'Composing score',elapsed:12,done:700,total:4096});
 assert.ok(score.eta>600);assert.ok(score.percent<5);
 const perf=e.update({id:'a',stage:'Composing performance',elapsed:4,done:200,total:9000});
 assert.ok(perf.percent>=score.percent);assert.ok(perf.eta>400);
 const render=e.update({id:'a',stage:'Rendering audio chunks',elapsed:100,done:12,total:64});
 assert.ok(render.percent>=perf.percent);assert.ok(render.eta>=160);
 const encode=e.update({id:'a',stage:'Encoding and mastering',elapsed:15,done:0,total:0});
 assert.ok(encode.eta>0);assert.ok(encode.percent<100);
});
test('unknown stages do not show a fake ETA and a new job resets progress',()=>{
 const e=new GenerationEta();assert.equal(e.update({id:'a',stage:'Queued',elapsed:20,done:0,total:0}),null);
 e.update({id:'a',stage:'Encoding and mastering',elapsed:300,done:0,total:0});
 const fresh=e.update({id:'b',stage:'Composing score',elapsed:0,done:0,total:0});assert.equal(fresh.percent,0);
 assert.equal(e.update({id:'b',stage:'render-video',elapsed:20,done:0,total:0}),null);
});
test('reload restores progress; corrupt storage falls back safely',()=>{
 const e=new GenerationEta();e.update({id:'a',stage:'Rendering audio chunks',elapsed:100,done:10,total:64});
 const f=new GenerationEta(e.timings,e.snapshot);
 assert.ok(f.update({id:'a',stage:'Rendering audio chunks',elapsed:101,done:11,total:64}).percent>=e.snapshot.percent);
 const bad=new GenerationEta([null,-1],{id:'x',phase:99});assert.equal(bad.snapshot,null);assert.equal(bad.timings.length,5);
});
