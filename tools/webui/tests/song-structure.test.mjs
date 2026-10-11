import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lyricSections,structureWarnings,addFinalChorus,structureDirection} from '../src/lib/song-structure.ts';
import {applyProducer,cleanProducer,castLyrics} from '../src/lib/producer.ts';
const lyrics='## [Intro]\nIntro words\n\n## [Verse 1]\nFirst verse\n\n## [Hook]\nRemember these words\n\n## [Verse 2]\nSecond verse\n\n## [Hook]\nRemember these words\n\n## [Verse 3]\nThird verse\n\n## [Outro]\nGoodbye';
test('actual ENOUGH-like form identifies missing final chorus and repairs without dropping sections',()=>{
 assert.equal(lyricSections(lyrics).length,7);
 assert.match(structureWarnings(lyrics).join(' '),/no chorus return/);
 const repaired=addFinalChorus(lyrics);
 assert.match(repaired,/Third verse\n\n\[Final Chorus\]\nRemember these words\n\n## \[Outro\]/);
 assert.equal(lyricSections(repaired).length,8);
 assert.deepEqual(structureWarnings(repaired),[]);
 assert.equal(addFinalChorus(repaired),repaired);
 assert.equal(repaired.replace('[Final Chorus]\nRemember these words\n\n',''),lyrics);
});
test('pre/post choruses do not count as a main chorus and missing hooks are not invented',()=>{
 const text='[Verse]\nStory\n[Pre-Chorus]\nBuild\n[Post Chorus]\nEcho';
 assert.ok(lyricSections(text).every(s=>!s.chorus));
 assert.match(structureWarnings(text).join(' '),/No chorus/);
 assert.equal(addFinalChorus(text),text);
});
test('repeat chorus retains its singer and musical identity, while manual casts remain untouched',()=>{
 const p=cleanProducer({voices:3});const cast=castLyrics(lyrics,p);
 const hooks=lyricSections(cast).filter(s=>s.chorus);
 assert.equal(hooks[0].label,hooks[1].label);
 assert.match(structureDirection(cast,40),/repeat that core melody/);
 assert.match(structureDirection(cast,0),/keep it rapped, not sung/);
 const manual='[Chorus - Voice 1]\nHook\n[Verse]\nWords\n[Chorus - Voice 2]\nHook';
 assert.match(castLyrics(manual,p),/Chorus - Voice 2/);
 const req={style:'Hip hop',lyrics,duration:0};const result=applyProducer(req,p);
 assert.match(result.style,/Section performance plan/);
 assert.match(result.style,/7\. Outro/);
 assert.equal(applyProducer(result,p).style,result.style);
 assert.equal(req.lyrics,lyrics);
});
