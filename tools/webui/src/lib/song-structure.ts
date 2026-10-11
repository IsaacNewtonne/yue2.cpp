export interface LyricSection { label: string; body: string; start: number; end: number; chorus: boolean; }

export function lyricSections(lyrics: string): LyricSection[] {
 const headings = [...lyrics.matchAll(/^[\t ]*(?:#{1,6}[\t ]*)?\[([^\]\r\n]+)\][\t ]*\r?$/gm)];
 return headings.map((m,i) => ({label:m[1],body:lyrics.slice(m.index!+m[0].length,headings[i+1]?.index ?? lyrics.length).trim(),start:m.index!,end:headings[i+1]?.index ?? lyrics.length,chorus:isChorus(m[1])}));
}
export function isChorus(label: string): boolean {
 return /\b(chorus|hook|refrain)\b/i.test(label) && !/\b(pre|post)[ -]?(chorus|hook)\b/i.test(label);
}
export function structureWarnings(lyrics: string): string[] {
 const sections=lyricSections(lyrics), choruses=sections.filter(s=>s.chorus && s.body);
 if(!lyrics.trim())return [];
 if(!sections.length)return ['No labelled sections yet. Add [Verse] and [Chorus] labels to define the song form.'];
 if(!choruses.length)return ['No chorus or hook is written in these lyrics. Arrangement directions alone do not add one.'];
 const warnings:string[]=[];
 if(choruses.length===1)warnings.push('The chorus appears only once. Repeat it to give the song a recognizable return.');
 if(sections.slice(sections.indexOf(choruses.at(-1)!)+1).some(s=>/\b(verse|bridge)\b/i.test(s.label)))warnings.push('The last verse or bridge has no chorus return before the ending.');
 const normalize=(s:string)=>s.toLowerCase().replace(/\s+/g,' ').trim();
 if(choruses.length>1 && new Set(choruses.map(s=>normalize(s.body))).size===choruses.length)warnings.push('Every chorus has different words. Repeat a core refrain to strengthen its identity.');
 return warnings;
}
export function addFinalChorus(lyrics: string): string {
 const sections=lyricSections(lyrics), chorus=sections.find(s=>s.chorus && s.body);
 if(!chorus)return lyrics;
 const lastChorus=sections.map(s=>!!(s.chorus && s.body)).lastIndexOf(true);
 if(lastChorus>=0 && !sections.slice(lastChorus+1).some(s=>/\b(verse|bridge)\b/i.test(s.label)) && sections.filter(s=>s.chorus).length>1)return lyrics;
 const outro=sections.find(s=>s.start>sections[lastChorus].start && /\b(outro|ending)\b/i.test(s.label));
 const insert=outro?.start ?? lyrics.length;
 const voice=/\bVoice\s+\d+\b/i.exec(chorus.label)?.[0];
 return `${lyrics.slice(0,insert).trimEnd()}\n\n[Final Chorus${voice ? ` - ${voice}` : ''}]\n${chorus.body}\n\n${lyrics.slice(insert)}`.trimEnd();
}
export function structureDirection(lyrics:string, singing:number):string {
 const sections=lyricSections(lyrics);
 if(!sections.length)return '';
 const choruses=sections.filter(s=>s.chorus && s.body);
 const map=sections.map((s,i)=>`${i+1}. ${s.label}${s.chorus ? ' (chorus return: repeat the core hook motif)' : /\bverse\b/i.test(s.label) ? ' (verse: restrained accompaniment)' : ''}`).join('\n');
 return `Section performance plan (follow the supplied lyric order; do not omit or merge sections):\n${map}\n${choruses.length ? `Chorus identity: establish a short, recognizable ${singing===0 ? 'rhythmic refrain; keep it rapped, not sung' : 'sung melody with longer held notes and breathing space than the verses'}. On every chorus return, repeat that core ${singing===0 ? 'rhythm' : 'melody'}, phrase lengths and harmonic progression. Change backing layers for the final return, not the core hook. Pull back instruments during verses; bring fuller drums, bass and harmony into choruses. Signal each chorus entrance with a short fill or brief dropout. In the composition score, write distinct verse and chorus sections and actual vocal phrases, rather than extending one accompaniment loop across the whole song.` : 'No chorus is supplied: preserve this form rather than inventing lyric lines.'}\nSection labels and these directions are not performed words.`;
}
