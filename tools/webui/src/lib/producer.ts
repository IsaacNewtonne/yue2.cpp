import type { Yue2Request } from './types.js';
import { isChorus, structureDirection } from './song-structure.ts';

export interface ProducerSettings {
 enabled: boolean;
 singing: number;
 presence: number;
 voices: number;
 voiceProfiles: string[];
 voiceLocked: boolean;
 bpm: number;
 structure: string;
 takes: number;
}
export const defaultProducer: ProducerSettings = {
 enabled: true, singing: 75, presence: 75, voices: 1,
 voiceProfiles: ['Warm clear mid-range lead, natural phrasing', 'Bright airy upper voice', 'Low resonant voice', 'Soft textured voice'],
 voiceLocked: false, bpm: 100, structure: '', takes: 1
};
export function cleanProducer(value: Partial<ProducerSettings> = {}): ProducerSettings {
 const number = (v: unknown, fallback: number, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.max(min, Math.min(max, v))) : fallback;
 return {
  enabled: value.enabled !== false,
  singing: number(value.singing, 75, 0, 100), presence: number(value.presence, 75, 0, 100),
  voices: number(value.voices, 1, 1, 4), bpm: number(value.bpm, 100, 40, 220), takes: value.takes === 3 ? 3 : 1,
  voiceLocked: value.voiceLocked === true,
  voiceProfiles: defaultProducer.voiceProfiles.map((fallback, i) => typeof value.voiceProfiles?.[i] === 'string' ? value.voiceProfiles[i].slice(0, 240) : fallback),
  structure: typeof value.structure === 'string' ? value.structure.slice(0, 2000) : ''
 };
}
export function delivery(p: ProducerSettings): string {
 if (p.presence === 0) return 'Instrumental only; no singing, speech, humming or vocal samples.';
 if (p.singing === 0) return 'Rhythmic rap or spoken delivery throughout; no melodic singing.';
 if (p.singing === 100) return 'Fully melodic singing throughout vocal sections; no rap or spoken delivery.';
 return p.singing < 35 ? 'Mostly rhythmic rap verses, with a short melodic sung hook.' : p.singing < 70
  ? 'Rap or rhythmic spoken verses contrasting with clearly sung melodic choruses.'
  : 'Mostly melodic singing, with occasional rhythmic spoken phrases in verses; fully sung choruses.';
}
export function songPlan(p: ProducerSettings): string {
 if (p.structure.trim()) return p.structure.trim();
 if (p.presence === 0) return 'Instrumental intro → main theme → contrasting theme → breakdown → developed main theme → resolved outro';
 const verse = p.singing < 70 ? 'rhythmic verse' : 'restrained sung verse';
 const chorus = p.singing === 0 ? 'rhythmic hook' : 'memorable sung chorus';
 const breakSection = p.presence < 50 ? 'extended instrumental break' : 'short instrumental turnaround';
 return `4-bar instrumental intro → 16-bar ${verse} → 8-bar ${chorus} → ${breakSection} → 16-bar contrasting second verse → repeat the same 8-bar ${chorus} → 8-bar sparse bridge → final 8-bar ${chorus} with the same core hook and fuller backing → 4-bar resolved outro`;
}
export function producerDirection(p: ProducerSettings): string {
 const parts = [`Tempo: approximately ${p.bpm} BPM.`, delivery(p), `Arrangement: ${songPlan(p)}.`];
 parts.push('Let the song length follow the supplied lyrics, tempo, phrasing and instrumental sections. Complete every supplied lyric section in order. After the final lyric, resolve the harmony with a short musical outro and let the final notes decay into silence. End there; do not restart the groove or extend with unrelated sounds. These are arrangement directions, not performed words.');
 if (p.presence > 0) {
  parts.push(`Singing balance: approximately ${p.singing}% melodic singing and ${100 - p.singing}% rap or spoken phrasing within vocal passages.`);
  parts.push(`Vocal presence: approximately ${p.presence}% of the arrangement, leaving ${100 - p.presence}% for instrumental space and breaths.`);
  parts.push(`Requested cast: ${p.voices} distinct vocal ${p.voices === 1 ? 'voice; solo lead' : 'voices; alternate lead sections and join on the final hook'}.`);
  parts.push(...p.voiceProfiles.slice(0, p.voices).map((voice, i) => `Voice ${i + 1}: ${voice.trim() || defaultProducer.voiceProfiles[i]}.`));
  parts.push('Keep each assigned voice consistent with its own profile. Voice labels mark different singers, not delivery changes by one singer. Follow the section assignments; do not sing the labels. Clear diction, natural breaths, dynamic contrast between sections.');
 }
 return parts.join('\n');
}
// Assign existing vocal sections without changing performed words or the editor.
// These remain text directions, not model-level speaker identities.
export function castLyrics(lyrics: string, settings: ProducerSettings): string {
 const p = cleanProducer(settings);
 if (!p.enabled || p.presence === 0 || p.voices < 2 || !lyrics.trim()) return lyrics;
 const heading = /^(\s*(?:#{1,6}\s*)?)\[([^\]\n]+)\]([^\S\n]*)$/gm;
 const matches = [...lyrics.matchAll(heading)];
 let next = 0;
 let chorusVoice: number | undefined;
 if (!matches.length) {
  // Unlabelled lyrics: use stanzas, or divide lines into balanced solo passages.
  let blocks = lyrics.split(/\n\s*\n/);
  if (blocks.length < p.voices) {
   const lines = lyrics.split('\n');
   const size = Math.max(1, Math.ceil(lines.length / p.voices));
   blocks = [];
   for (let i = 0; i < lines.length; i += size) blocks.push(lines.slice(i, i + size).join('\n'));
  }
  return blocks.map((block, i) => `[Vocal section ${i + 1} - Voice ${i % p.voices + 1}]\n${block}`).join('\n\n');
 }
 return lyrics.replace(heading, (full, prefix: string, label: string, suffix: string, offset: number) => {
  const index = matches.findIndex(m => m.index === offset);
  const body = lyrics.slice(offset + full.length, matches[index + 1]?.index ?? lyrics.length);
  if (!body.trim() || /\b(instrumental|interlude|breakdown|(?:guitar|piano|drum|bass|sax) solo)\b/i.test(label)) return full;
  const assigned = /\bVoice\s+(\d+)\b/i.exec(label);
  if (assigned) { next = Number(assigned[1]) % p.voices; if(isChorus(label) && chorusVoice===undefined)chorusVoice=Number(assigned[1]); return full; }
  if (/\b(all voices|ensemble|duet|choir)\b/i.test(label)) return full;
  const voice=isChorus(label) && chorusVoice!==undefined ? chorusVoice : next++ % p.voices + 1;
  if(isChorus(label))chorusVoice=voice;
  return `${prefix}[${label} - Voice ${voice}]${suffix}`;
 });
}

export function voiceAssignments(p: ProducerSettings, lyrics: string): string[] {
 if (!p.enabled || p.presence === 0 || p.voices < 2) return [];
 return [...castLyrics(lyrics, p).matchAll(/^\s*(?:#{1,6}\s*)?\[([^\]\n]*\bVoice\s+\d+[^\]\n]*)\]/gmi)].map(m => m[1]);
}
export function lyricGuidance(p: ProducerSettings, style: string, duration?: number): string {
 return `Musical direction: ${style}\n${producerDirection(p)}\nTarget duration: ${duration && duration > 0 ? `${duration} seconds` : 'choose a natural length for the plan'}.\nFit lyric density to tempo and delivery. Use natural word stress, singable vowels and breathing space. Sung lines should be less dense than rap lines. Write a distinct chorus with a short memorable refrain. Repeat its core words verbatim at each chorus return; write every return out in full, never use repeat shorthand. Include a final chorus after the last verse or bridge when the arrangement calls for one. Develop the verses with new content and keep the chorus less word-dense. Use bracketed section labels; keep production instructions out of performed lines. For multiple voices, identify the voice in section labels. Instrumental sections contain no words. The arrangement and delivery instructions take priority over conflicting lyric-style density rules. Return only the final lyrics.`;
}
export function estimatedDuration(p: ProducerSettings, lyrics: string): number {
 // Approximate 4/4 phrase budget, not audio alignment. Labels never count as words.
 const lines = lyrics.replace(/\[[^\]]*\]/g, '').split(/\n/).map(s => s.trim()).filter(Boolean);
 if (!lines.length || p.presence === 0) return 180;
 const wordsPerBar = 9 - p.singing / 100 * 5;
 const bars = lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.split(/\s+/).length / wordsPerBar)), 0);
 return Math.min(600, Math.max(30, Math.ceil(bars * 240 / p.bpm / Math.max(.15, p.presence / 100) + 8 * 240 / p.bpm)));
}
export function applyProducer(request: Yue2Request, settings: ProducerSettings): Yue2Request {
 const p = cleanProducer(settings);
 if (!p.enabled) return request;
 const style = request.style.replace(/(?:^|\n\n)Song direction:\n[\s\S]*$/, '').trim();
 const lyrics=p.presence===0 ? '' : castLyrics(request.lyrics || '',p);
 return { ...request, style: `${style}\n\nSong direction:\n${producerDirection(p)}\n${structureDirection(lyrics,p.singing)}`.trim(),
  lyrics };
}
export function lyricWarnings(p: ProducerSettings, lyrics: string): string[] {
 if (!p.enabled) return [];
 if (p.presence === 0) return lyrics.trim() ? ['Instrumental mode omits lyrics from this render; your editor text is preserved.'] : [];
 if (!lyrics.trim()) return ['Add lyrics for the requested vocal performance.'];
 const lines = lyrics.replace(/\[[^\]]*\]/g, '').split(/\n/).filter(s => s.trim());
 const dense = lines.filter(s => s.trim().split(/\s+/).length > (p.singing >= 70 ? 14 : 24)).length;
 const assigned = new Set(voiceAssignments(p, lyrics).flatMap(label => [...label.matchAll(/\bVoice\s+(\d+)/gi)].map(m => Number(m[1]))));
 const missing = Array.from({length:p.voices}, (_,i)=>i+1).filter(n=>!assigned.has(n));
 return [! /\[(verse|chorus|hook)/i.test(lyrics) ? 'Section labels would help connect these lyrics to the arrangement.' : '',
  p.voices > 1 && missing.length ? `No solo section is assigned to Voice ${missing.join(', Voice ')}. Add vocal sections or label existing sections with these voices.` : '',
  [...assigned].some(n=>n<1 || n>p.voices) ? 'A lyric section names a voice outside the selected cast. Update its voice label or increase the cast size.' : '',
  dense ? `${dense} long lyric line${dense > 1 ? 's' : ''}: review phrasing and breathing space.` : ''].filter(Boolean);
}
