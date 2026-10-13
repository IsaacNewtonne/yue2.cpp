import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanProducer, applyProducer, delivery, estimatedDuration, lyricGuidance, lyricWarnings, castLyrics } from '../src/lib/producer.ts';
import { prepareGeneration } from '../src/lib/generation-request.ts';

const base = {style:'Soul', lyrics:'[Verse]\nWe carry light into the morning\n[Chorus]\nCarry me home', duration:0, abc_sampling:{}, semantic_sampling:{}};
test('three voices receive solo sections in existing markdown lyrics without changing words', () => {
 const lyrics='## [Intro]\nHello\n\n## [Verse 1]\nFirst words\n\n## [Hook]\nHook words\n\n[Instrumental break]\n\n[Verse 2]\nMore words';
 const p=cleanProducer({voices:3});
 const result=applyProducer({...base,lyrics},p);
 assert.match(result.lyrics,/\[Intro - Voice 1\]/);
 assert.match(result.lyrics,/\[Verse 1 - Voice 2\]/);
 assert.match(result.lyrics,/\[Hook - Voice 3\]/);
 assert.match(result.lyrics,/\[Instrumental break\]/);
 assert.match(result.lyrics,/\[Verse 2 - Voice 1\]/);
 assert.equal(result.lyrics.replace(/ - Voice \d+/g,''),lyrics);
 assert.equal(castLyrics(result.lyrics,p),result.lyrics);
 assert.equal(castLyrics(lyrics,cleanProducer({voices:1})),lyrics);
 assert.equal(castLyrics(lyrics,{...p,enabled:false}),lyrics);
});
test('manual casting is preserved and unlabelled lines receive voice assignments',()=>{
 const p=cleanProducer({voices:3});
 assert.match(castLyrics('[Verse - Voice 2]\nWords\n[Hook]\nMore',p),/\[Hook - Voice 3\]/);
 const lyrics='One\nTwo\nThree\nFour\nFive\nSix';
 const result=castLyrics(lyrics,p);
 for(const n of [1,2,3])assert.match(result,new RegExp(`Voice ${n}`));
 assert.deepEqual(result.split('\n').filter(s=>s && !s.startsWith('[')),lyrics.split('\n'));
});
test('instrumental renders omit words without destroying the source lyrics', () => {
 const result = applyProducer(base, cleanProducer({presence:0}));
 assert.equal(result.lyrics, '');
 assert.match(base.lyrics, /carry light/);
 assert.match(result.style, /Instrumental only/);
 assert.doesNotMatch(result.style, /Requested cast/);
 assert.match(lyricWarnings(cleanProducer({presence:0}), base.lyrics)[0], /preserved/);
});
test('delivery endpoints and voice cast reach music and lyric directions', () => {
 assert.match(delivery(cleanProducer({singing:0})), /no melodic singing/);
 assert.match(delivery(cleanProducer({singing:100})), /no rap/);
 const p = cleanProducer({singing:50,voices:2,voiceLocked:true,voiceProfiles:['Warm low lead','Airy upper lead'],bpm:88});
 const result = applyProducer(base,p);
 const prompt = lyricGuidance(p,base.style,150);
 for (const text of [result.style,prompt]) {
  assert.match(text,/2 distinct vocal voices/);
  assert.match(text,/Voice 2: Airy upper lead/);
  assert.match(text,/88 BPM/);
 }
 assert.match(prompt,/150 seconds/);
 assert.match(prompt,/breathing space/);
 const a=prepareGeneration(result,true),b=prepareGeneration(result,true);
 assert.equal(a.style,b.style,'locked profiles remain stable while takes vary');
 assert.notEqual(a.lm_seed,b.lm_seed);
 assert.notEqual(a.seed,b.seed);
 assert.equal(applyProducer(result,p).style,result.style,'reusing a generated prompt does not duplicate direction');
 const emptyStyle=applyProducer({...base,style:''},p);
 assert.equal(applyProducer(emptyStyle,p).style,emptyStyle.style);
 assert.match(applyProducer(base,{...p,singing:55}).style,/55% melodic singing/);
});
test('duration accounts for tempo, delivery and instrumental space but preserves explicit length', () => {
 const lyrics=Array(16).fill('We carry light into the morning').join('\n');
 const p=cleanProducer();
 assert.ok(estimatedDuration({...p,bpm:60},lyrics)>estimatedDuration({...p,bpm:120},lyrics));
 assert.ok(estimatedDuration({...p,presence:40},lyrics)>estimatedDuration({...p,presence:90},lyrics));
 assert.equal(estimatedDuration(p,lyrics),estimatedDuration(p,'[Verse]\n'+lyrics));
 assert.equal(applyProducer({...base,duration:123},p).duration,123);
 assert.equal(applyProducer(base,p).duration,0,'Auto must not become an estimated hard cutoff');
 assert.equal(applyProducer({...base,duration:undefined},p).duration,undefined);
 assert.match(applyProducer(base,p).style,/final notes decay into silence/);
 assert.match(applyProducer(base,p).style,/Complete every supplied lyric section/);
 assert.equal(applyProducer(base,{...p,enabled:false}),base);
});
test('persisted controls are bounded and independent', () => {
 const p=cleanProducer({bpm:NaN,voices:99,takes:100,singing:-2,presence:101});
 assert.equal(p.bpm,100);assert.equal(p.voices,4);assert.equal(p.takes,1);assert.equal(p.singing,0);assert.equal(p.presence,100);
 const a=cleanProducer(),b=cleanProducer();a.voiceProfiles[0]='changed';assert.notEqual(a.voiceProfiles[0],b.voiceProfiles[0]);
});
