// lyric-fit.ts: does the song length fit the lyrics?
//
// Auto duration renders until the song ends, with a ceiling of about 1.2x
// the lyric estimate plus 15 s (the server applies the same rule). The meter
// turns amber or red when the lyrics are far longer than the songs YuE2 was
// trained on (about 200 words) or a manual duration would cut them off.

import { estimatedDuration, type ProducerSettings } from './producer.ts';
import { lyricSections } from './song-structure.ts';

export type FitLevel = 'good' | 'warn' | 'bad';
export interface LyricFit {
	words: number;
	lines: number;
	choruses: number;
	estimate: number;    // seconds the lyrics need, 0 without lyrics
	ceiling: number;     // the auto-duration stop, seconds
	level: FitLevel;
	summary: string;     // short meter text
	advice: string;      // one sentence on what to do
}

export const WORDS_COMFORT = 350;
export const WORDS_LIMIT = 600;

export function lyricWords(lyrics: string): { words: number; lines: number } {
	const lines = lyrics.replace(/\[[^\]\n]*\]/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
	let words = 0;
	for (const line of lines) {
		const cjk = (line.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g) || []).length;
		words += line.replace(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g, ' ').split(/\s+/).filter(Boolean).length + cjk * 0.6;
	}
	return { words: Math.round(words), lines: lines.length };
}

// Same rule as score_estimate_seconds in src/score-check.h
export function serverEstimate(lyrics: string): number {
	const { words } = lyricWords(lyrics);
	if (!words) return 0;
	return Math.min(600, Math.max(30, Math.round((words / 140) * 60 + 30)));
}

// Same rule as song_auto_ceiling in src/song-ending.h
export function autoCeiling(estimate: number): number {
	if (!(estimate > 0)) return 600;
	return Math.min(600, Math.ceil(estimate * 1.2 + 15 - 1e-4));
}

export function clock(seconds: number): string {
	const s = Math.max(0, Math.round(seconds));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// duration: 0 or undefined = auto, otherwise the manual length in seconds
export function lyricFit(lyrics: string, producer: ProducerSettings | null, duration: number | undefined): LyricFit {
	const { words, lines } = lyricWords(lyrics);
	const choruses = lyricSections(lyrics).filter((s) => s.chorus).length;
	const instrumental = !words || (producer?.enabled && producer.presence === 0);
	const estimate = instrumental ? 0 : producer?.enabled ? estimatedDuration(producer, lyrics) : serverEstimate(lyrics);
	const ceiling = autoCeiling(estimate);
	const auto = !duration;
	const fit: LyricFit = { words, lines, choruses, estimate, ceiling, level: 'good', summary: '', advice: '' };
	if (instrumental) {
		fit.summary = auto ? 'Instrumental · ends naturally, up to 10:00' : `Instrumental · ${clock(duration!)}`;
		fit.advice = 'No lyrics to fit.';
		return fit;
	}
	fit.summary = auto ? `≈ ${clock(estimate)} from ${words} words · stops by ${clock(ceiling)}` : `${clock(duration!)} set · lyrics need ≈ ${clock(estimate)}`;
	if (words > WORDS_LIMIT || estimate >= 600) {
		fit.level = 'bad';
		fit.advice = `${words} words is far beyond what YuE2 can sing in one song (it learned from songs of about 200 words). Trim to under ${WORDS_COMFORT} words or split it across tracks; long sheets lose the vocals and the chorus.`;
	} else if (!auto && duration! < estimate * 0.9) {
		fit.level = 'bad';
		fit.advice = `The set length is shorter than the lyrics need, so later sections will be cut. Use Auto or at least ${Math.ceil(estimate)} s.`;
	} else if (words > WORDS_COMFORT) {
		fit.level = 'warn';
		fit.advice = `${words} words is long for YuE2 (best under ${WORDS_COMFORT}). Expect weaker vocals near the end.`;
	} else if (!auto && duration! > estimate * 1.6 + 30) {
		fit.level = 'warn';
		fit.advice = 'The set length is much longer than the lyrics; expect a long instrumental tail. Auto stops closer to the words.';
	} else {
		fit.advice = auto ? 'Length follows the lyrics.' : 'The set length fits the lyrics.';
	}
	return fit;
}
