// prompt-clean.ts: what reaches the model, in the shape it was trained on.
//
// The official YuE2 prompts are one short tag line (genre, instruments,
// mood, vocal, BPM; about 250 characters) and lyrics with plain section
// labels. Long markdown style sheets, prose song directions, character names
// and "- Voice N" labels are out of distribution: the score degenerates into
// a vocal-free loop and the chorus goes missing. This module derives the
// model-facing request from the editor state. The editor text itself never
// changes. Legacy mode keeps the previous prompt for A/B comparison.

import type { Yue2Request } from './types.js';
import { applyProducer, cleanProducer, type ProducerSettings } from './producer.ts';

export const STYLE_LIMIT = 300;
export type PromptMode = 'clean' | 'legacy';
const MODE_KEY = 'yue2-prompt-mode';

export function readPromptMode(): PromptMode {
	try { return localStorage.getItem(MODE_KEY) === 'legacy' ? 'legacy' : 'clean'; } catch { return 'clean'; }
}
export function writePromptMode(mode: PromptMode): void {
	try { localStorage.setItem(MODE_KEY, mode); } catch { /* the in-memory choice still applies */ }
}

// ------------------------------------------------------------------ style --

const LEGACY_DIRECTION = /(?:^|\n\n)Song direction:\n[\s\S]*$/;
const FREEFORM_PREAMBLE = /^Music generation brief\.[^\n]*\n/;
const BLEND_PREAMBLE = /^Use the primary style as the foundation\.[^\n]*\n?/;
const BLEND_ENTRY = /(Primary style|Secondary influence)\s*\S\s*(.+?)\s*\((\d+)\/100 strength\):\s*/g;

interface StyleEntry { primary: boolean; name: string; weight: number; body: string; }

function profileSection(body: string, heading: string): string {
	const match = new RegExp(`^##\\s*${heading}[^\\n]*\\n+([^#]+)`, 'mi').exec(body);
	return match ? match[1].replace(/\s+/g, ' ').trim() : '';
}

// "West Coast hip-hop with elastic bass, bright leads, and grooves." ->
// ["West Coast hip-hop", "elastic bass", "bright leads", "grooves"]
export function tagTerms(text: string): string[] {
	return text
		.replace(/\*\*|__|`/g, '')
		.replace(/\.$/, '')
		.split(/\s+(?:with|built around|featuring|driven by)\s+|[,;]|\.\s+|\s+and\s+|\n/i)
		.map((term) => term.replace(/^(and|or|a|an|the)\s+/i, '').replace(/[.:]+$/, '').trim())
		.filter((term) => term.length > 1 && term.length <= 60);
}

function blendEntries(style: string): StyleEntry[] {
	const matches = [...style.matchAll(BLEND_ENTRY)];
	return matches.map((m, i) => ({
		primary: m[1].startsWith('Primary'),
		name: m[2].trim(),
		weight: Number(m[3]),
		body: style.slice(m.index! + m[0].length, matches[i + 1]?.index ?? style.length)
	}));
}

function tempoFromProfile(body: string): number | undefined {
	const m = /Typical tempo:\**\s*(\d{2,3})(?:\D+(\d{2,3}))?\s*BPM/i.exec(body);
	if (!m) return undefined;
	return m[2] ? Math.round((Number(m[1]) + Number(m[2])) / 2) : Number(m[1]);
}

export function lyricLanguage(lyrics: string): string {
	const text = lyrics.replace(/\[[^\]\n]*\]/g, '');
	const kana = (text.match(/[\u3040-\u30ff]/g) || []).length;
	const hangul = (text.match(/[\uac00-\ud7af]/g) || []).length;
	const han = (text.match(/[\u3400-\u9fff]/g) || []).length;
	const latin = (text.match(/[A-Za-z]/g) || []).length;
	if (kana + hangul + han === 0 && latin === 0) return '';
	if (kana > 0 && kana + han > latin / 3) return 'Japanese';
	if (hangul > latin / 3) return 'Korean';
	if (han > latin / 3) return 'Mandarin';
	return 'English';
}

function voiceDescriptor(profile: string): string {
	return (profile.split(',')[0] || '')
		.replace(/\b(voice|vocals?|lead)\b/gi, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

export function deliveryTag(p: ProducerSettings): string {
	if (p.presence === 0) return 'instrumental';
	if (p.singing === 0) return 'rap vocals';
	if (p.singing < 35) return 'rap verses, sung hook';
	if (p.singing < 70) return 'rap verses, sung chorus';
	return 'sung vocals';
}

function voiceTag(p: ProducerSettings, language: string): string {
	if (p.presence === 0) return '';
	const words = voiceDescriptor(p.voiceProfiles[0] || '').split(' ').filter(Boolean);
	// "deep grounded rap" + English -> "deep grounded English rap vocal"
	const kind = /^(rap|spoken|sung)$/.test(words.at(-1) || '') ? words.pop()! : '';
	const parts = [...words, language, kind].filter(Boolean).join(' ');
	if (p.voices === 1) return `${parts} vocal`.trim();
	return `${[language, kind].filter(Boolean).join(' ')} ${p.voices === 2 ? 'duet' : 'group'} vocals${words.length ? `, ${words.join(' ')} lead` : ''}`.trim();
}

function dedupe(terms: string[]): string[] {
	const seen = new Set<string>();
	return terms.filter((term) => {
		const key = term.toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, '');
		if (!key || seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

// Required terms always stay; optional ones join in priority order while the
// tag line fits the limit. Output keeps the canonical official order.
function assemble(slots: { term: string; order: number; required: boolean; priority: number }[]): string {
	const unique = new Map<string, (typeof slots)[number]>();
	for (const slot of slots) {
		const key = slot.term.toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, '');
		if (!key) continue;
		const had = unique.get(key);
		if (!had || (slot.required && !had.required)) unique.set(key, slot);
	}
	const all = [...unique.values()];
	const chosen = all.filter((slot) => slot.required);
	const length = (list: typeof chosen) => list.map((s) => s.term).join(', ').length;
	// Too many required names: drop the lowest-priority ones, keep the most important.
	chosen.sort((a, b) => a.priority - b.priority);
	while (length(chosen) > STYLE_LIMIT && chosen.length > 1) chosen.pop();
	for (const slot of all.filter((s) => !s.required).sort((a, b) => a.priority - b.priority)) {
		if (length([...chosen, slot]) <= STYLE_LIMIT) chosen.push(slot);
	}
	return chosen.sort((a, b) => a.order - b.order || a.priority - b.priority).map((s) => s.term).join(', ').slice(0, STYLE_LIMIT);
}

// The style tag line of the model request: 300 characters or less.
export function compactStyle(style: string, producer?: ProducerSettings | null, lyrics = ''): string {
	const raw = style.replace(LEGACY_DIRECTION, '').replace(FREEFORM_PREAMBLE, '').trim();
	const p = producer && producer.enabled ? cleanProducer(producer) : null;
	const language = lyrics.trim() ? lyricLanguage(lyrics) : '';
	const slots: { term: string; order: number; required: boolean; priority: number }[] = [];
	let tempo: number | undefined;
	const entries = blendEntries(raw.replace(BLEND_PREAMBLE, ''));
	if (entries.length) {
		entries.forEach((entry, index) => {
			const primary = index === 0;
			if (primary) tempo = tempoFromProfile(entry.body);
			slots.push({ term: entry.name, order: primary ? 0 : 1, required: true, priority: primary ? 0 : 10 + index });
			const identity = tagTerms(profileSection(entry.body, 'Core Identity'));
			const terms = [
				...identity,
				...tagTerms(profileSection(entry.body, 'Rhythm & Drums')).slice(0, 2),
				...tagTerms(profileSection(entry.body, 'Bass & Low End')).slice(0, 1),
				...tagTerms(profileSection(entry.body, 'Harmony, Melody & Sound Palette')).slice(0, 2)
			];
			terms.forEach((term, i) => slots.push({ term: i === 0 ? term : term.toLowerCase(), order: primary ? 0 : 1, required: false,
				priority: primary ? 20 + i : (entry.weight >= 50 ? 60 : 80) + index * 5 + i }));
			tagTerms(profileSection(entry.body, 'Mood & Energy')).slice(0, primary ? 3 : 1)
				.forEach((term, i) => slots.push({ term: term.toLowerCase(), order: 2, required: false, priority: (primary ? 23 : 90) + i * 2 }));
		});
	} else if (raw) {
		const plain = raw.replace(/^#+\s*/gm, '').replace(/^\s*[-*]\s+/gm, '').replace(/\*\*|__|`/g, '');
		if (plain.length <= STYLE_LIMIT && !/\n/.test(plain.trim())) {
			slots.push({ term: plain.trim(), order: 0, required: true, priority: 0 });
		} else {
			const terms = dedupe(plain.split(/[\n,;]|\.\s+/).map((t) => t.replace(/^[A-Za-z /&]+:\s*/, '').replace(/[.:]+$/, '').trim()).filter((t) => t.length > 1 && t.length <= 80));
			terms.forEach((term, i) => slots.push({ term: i === 0 ? term : term.toLowerCase(), order: 0, required: i === 0, priority: i }));
		}
		tempo = /\b(\d{2,3})\s*BPM\b/i.exec(raw) ? undefined : tempo;
	}
	if (p) {
		slots.push({ term: deliveryTag(p), order: 3, required: true, priority: 1 });
		const voice = voiceTag(p, language);
		if (voice) slots.push({ term: voice, order: 4, required: true, priority: 2 });
		if (!/\b\d{2,3}\s*BPM\b/i.test(slots.map((s) => s.term).join(' '))) slots.push({ term: `${p.bpm} BPM`, order: 5, required: true, priority: 3 });
	} else {
		if (language && !slots.some((s) => /vocal/i.test(s.term))) slots.push({ term: `${language} vocal`, order: 4, required: true, priority: 2 });
		if (tempo && !/\bBPM\b/i.test(slots.map((s) => s.term).join(' '))) slots.push({ term: `${tempo} BPM`, order: 5, required: true, priority: 3 });
	}
	return assemble(slots);
}

// ----------------------------------------------------------------- lyrics --

const LABEL_LINE = /^[\t ]*(?:#{1,6}[\t ]*)?\[([^\]\r\n]+)\][\t ]*$/;
export const STANDARD_LABELS = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Interlude', 'Outro'] as const;
export type StandardLabel = (typeof STANDARD_LABELS)[number];

// Maps any section label to one of the labels the model was trained on.
// Voice assignments and character names after a dash, colon or bracket go.
export function standardLabel(label: string, empty = false): StandardLabel {
	const l = label.toLowerCase().replace(/[–—]/g, '-');
	if (/\bpre[\s-]?(chorus|hook)\b|\bbuild[\s-]?up\b|\blift\b|\bramp\b/.test(l)) return 'Pre-Chorus';
	if (/\bpost[\s-]?(chorus|hook)\b/.test(l)) return 'Bridge';
	if (/\b(chorus|hook|refrain)\b/.test(l)) return 'Chorus';
	if (/\b(bridge|breakdown|middle[\s-]?(8|eight))\b/.test(l)) return 'Bridge';
	if (/\bintro\b/.test(l)) return empty ? 'Intro' : 'Intro';
	if (/\b(outro|ending|coda|fade)\b/.test(l)) return 'Outro';
	if (/\b(instrumental|interlude|solo|break|beat|drop)\b/.test(l)) return empty ? 'Interlude' : 'Verse';
	return empty ? 'Interlude' : 'Verse';
}

const TITLE_LINE = /^(?:title|song|track|name)\s*[:\-–—]|^#{1,6}\s+\S|^\*\*[^*]+\*\*$|^by\s+\S/i;
const VOICE_TAG = /^\s*[([]?\s*(?:voice|singer|vocalist|lead|mc)\s*\d*\s*[)\]]?\s*:\s+/i;
const VOICE_LINE = /^\s*[([]\s*(?:voice\s*\d+|all voices|both|together|ensemble|duet|choir)[^)\]]*[)\]]\s*$/i;
const NAME_TAG = /^\s*([A-Z][\w'.-]{1,20}(?:\s[A-Z][\w'.-]{1,20})?)\s*:\s+/;

// The model-facing lyrics: standard labels, no title or credits line, no
// character or voice names. Words that are sung are never changed.
export function cleanLyrics(lyrics: string): string {
	const lines = lyrics.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '').split('\n');
	const firstLabel = lines.findIndex((line) => LABEL_LINE.test(line));
	// Recurring "Name:" prefixes are speaker tags; a single one may be a word.
	const prefixCounts = new Map<string, number>();
	for (const line of lines) {
		const m = NAME_TAG.exec(line);
		if (m) prefixCounts.set(m[1], (prefixCounts.get(m[1]) ?? 0) + 1);
	}
	// A sheet that tags speakers on several lines tags them everywhere.
	const speakerTags = [...prefixCounts.values()].some((count) => count >= 2);
	const labelText = lines.filter((line) => LABEL_LINE.test(line)).join(' ').toLowerCase();
	const sections: { label: string; body: string[] }[] = [];
	let current: { label: string; body: string[] } | null = null;
	lines.forEach((raw, index) => {
		const label = LABEL_LINE.exec(raw);
		if (label) {
			current = { label: label[1], body: [] };
			sections.push(current);
			return;
		}
		let line = raw.replace(/\*\*|__/g, '').trim();
		if (!line) { current?.body.push(''); return; }
		if (!current) {
			// Text before the first label: a title or credit when labels follow.
			const preamble = lines.slice(0, firstLabel).filter((l) => l.trim());
			if (firstLabel > 0 && (TITLE_LINE.test(line) || preamble.length <= 2)) return;
			current = { label: 'Verse', body: [] };
			sections.push(current);
		}
		if (VOICE_LINE.test(line)) return;
		line = line.replace(VOICE_TAG, '');
		const name = NAME_TAG.exec(line);
		if (name && (speakerTags || (prefixCounts.get(name[1]) ?? 0) >= 2 || labelText.includes(name[1].toLowerCase()))) line = line.slice(name[0].length);
		(current as { body: string[] }).body.push(line);
	});
	if (firstLabel < 0 && sections.length === 1) {
		// Unlabelled lyrics: stanzas become verses, in their original order.
		const stanzas = sections[0].body.join('\n').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
		return stanzas.map((stanza) => `[Verse]\n${stanza}`).join('\n\n');
	}
	return sections
		.map((section) => {
			const body = section.body.join('\n').replace(/\n{2,}/g, '\n').trim();
			return `[${standardLabel(section.label, !body)}]${body ? `\n${body}` : ''}`;
		})
		.join('\n\n')
		.trim();
}

// ---------------------------------------------------------------- request --

export interface PromptOptions {
	mode: PromptMode;
	planning: boolean;              // a fresh composition with the song planner
	producer: ProducerSettings;
	rawStyle: string;               // editor style text or the blended profile prompt
}

// The request the model receives. Clean mode: tag-line style and standard
// lyrics. Legacy mode: the previous prose direction and voice labels.
export function modelRequest(request: Yue2Request, options: PromptOptions): Yue2Request {
	const producer = cleanProducer(options.producer);
	if (options.mode === 'legacy') return options.planning ? applyProducer(request, producer) : request;
	const instrumental = options.planning && producer.enabled && producer.presence === 0;
	const lyrics = instrumental ? '' : cleanLyrics(request.lyrics || '');
	return {
		...request,
		style: compactStyle(options.rawStyle, options.planning ? producer : null, lyrics),
		lyrics
	};
}

// --------------------------------------------------------------- colours --

// One colour family per section kind, shared by every lyric and arrangement view.
export type SectionKind = 'verse' | 'chorus' | 'prechorus' | 'bridge' | 'intro' | 'outro' | 'inst';
export function sectionKind(label: string, body = 'x'): SectionKind {
	const standard = standardLabel(label, !body.trim());
	return ({ Verse: 'verse', Chorus: 'chorus', 'Pre-Chorus': 'prechorus', Bridge: 'bridge', Intro: 'intro', Outro: 'outro', Interlude: 'inst' } as const)[standard];
}
export const SECTION_KIND_NAMES: Record<SectionKind, string> = {
	verse: 'Verse', chorus: 'Chorus', prechorus: 'Pre-Chorus', bridge: 'Bridge', intro: 'Intro', outro: 'Outro', inst: 'Instrumental'
};
