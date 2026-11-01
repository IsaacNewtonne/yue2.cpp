// harmony.ts: the opt-in engine fields from the studio-ports port, built from
// the studio's quality settings and the lyrics being sent.
//
// harmony: chord variety and section order of the planned score (engine
// src/harmony.h, timoncool/yue2.cpp 1e21e63). "Follow sections" sends the
// lyrics' section tags, in order, as the names the planner writes after "%".
// The label mapping follows timoncool/YuE2-Studio score/phrasing.rs label_of
// and section_labels (MIT, see THIRD_PARTY_NOTICES.md).
// lyric_schedule "auto": the engine times each lyric section on the score
// clock (src/lyric-schedule.h). solver: midpoint or ab2 (src/flow-solver.h).

import type { Yue2Request } from './types.js';

export type Solver = 'midpoint' | 'ab2';

export interface StructureSettings {
	followSections: boolean; // the plan names exactly the lyrics' sections, in order
	chordVariety: number; // harmony.strength, 0 off
	sectionVariety: number; // harmony.section_strength, 0 off
	outsideKey: number; // harmony.outside_bonus, 0 off
	lyricTiming: boolean; // lyric_schedule "auto"
	solver: Solver;
}

export const STRUCTURE_DEFAULTS: StructureSettings = {
	followSections: false,
	chordVariety: 0,
	sectionVariety: 0,
	outsideKey: 0,
	lyricTiming: false,
	solver: 'midpoint'
};

const clamp = (value: unknown, low: number, high: number): number =>
	typeof value === 'number' && Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : 0;

export function cleanStructure(value: unknown): StructureSettings {
	const v = (value && typeof value === 'object' ? value : {}) as Partial<StructureSettings>;
	return {
		followSections: v.followSections === true,
		chordVariety: clamp(v.chordVariety, 0, 16),
		sectionVariety: clamp(v.sectionVariety, 0, 16),
		outsideKey: clamp(v.outsideKey, 0, 8),
		lyricTiming: v.lyricTiming === true,
		solver: v.solver === 'ab2' ? 'ab2' : 'midpoint'
	};
}

// SheetSage2's section labels, the names the planner writes after "%"
const LABELS = new Set([
	'intro', 'verse', 'pre-chorus', 'chorus', 'post-chorus', 'bridge', 'outro', 'rap', 'interlude',
	'instrumental', 'solo', 'fade-out', 'pre-outro', 'loop', 'intro and verse', 'pre-chorus and chorus',
	'verse and pre-chorus', 'theme', 'development', 'variation', 'irregular', 'preshot', 'silence'
]);
const ALIASES: Record<string, string> = {
	prechorus: 'pre-chorus',
	'pre chorus': 'pre-chorus',
	'post chorus': 'post-chorus',
	hook: 'chorus',
	refrain: 'chorus'
};

// A lyric tag as a score section name: "Verse 2" -> verse, "Hook" -> chorus,
// anything the planner does not name -> verse
export function sectionLabel(tag: string): string {
	let clean = tag.toLowerCase().replace(/_/g, ' ').split(/\s+/).filter(Boolean).join(' ');
	clean = clean.replace(/[\s\d:.#-]+$/u, '');
	clean = ALIASES[clean] ?? clean;
	return LABELS.has(clean) ? clean : 'verse';
}

// The section names a score of these lyrics writes, in order: each tag's
// label, words before any tag a verse; a tag with no words still counts
export function sectionLabels(lyrics: string): string[] {
	const found: string[] = [];
	for (const raw of (lyrics || '').split(/\r\n|[\n\r\v\f\u001c-\u001e\u0085\u2028\u2029]/)) {
		const line = raw.trim();
		if (!line) continue;
		const tag = /^\[\s*([^\]]*?)\s*\]$/.exec(line);
		if (tag) {
			found.push(sectionLabel(tag[1]));
			continue;
		}
		if (!/[\p{L}\p{N}]/u.test(line)) continue;
		if (!found.length) found.push('verse');
	}
	return found;
}

// guidance the engine will use: lyric timing needs exactly 1
function guidanceOf(request: Yue2Request): number {
	const cfg = request.cfg_scale;
	if (cfg == null || cfg < 0) return (request.cot ?? 'full') === 'off' ? 1.01 : 1;
	return cfg;
}

// The structure settings as request fields; settings at rest add nothing.
export function withStructure(request: Yue2Request, settings: StructureSettings): Yue2Request {
	const out: Yue2Request = { ...request };
	delete out.harmony;
	delete out.lyric_schedule;
	delete out.solver;
	const scored = (out.cot ?? 'full') !== 'off';
	const harmony: NonNullable<Yue2Request['harmony']> = {};
	if (settings.chordVariety > 0) harmony.strength = settings.chordVariety;
	if (settings.sectionVariety > 0) harmony.section_strength = settings.sectionVariety;
	if (settings.outsideKey > 0) harmony.outside_bonus = settings.outsideKey;
	if (settings.followSections) {
		const follow = sectionLabels(out.lyrics ?? '').slice(0, 64);
		if (follow.length) harmony.follow = follow;
	}
	// harmony steers the planner only: a supplied score makes it moot
	if (scored && !out.abc && Object.keys(harmony).length) out.harmony = harmony;
	if (settings.lyricTiming && scored && guidanceOf(out) === 1) out.lyric_schedule = 'auto';
	if (settings.solver === 'ab2') out.solver = 'ab2';
	return out;
}
