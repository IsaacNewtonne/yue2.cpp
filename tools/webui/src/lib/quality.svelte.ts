// quality.svelte.ts: studio-wide quality switches for new generations.
//
// These are studio preferences, not part of a saved preset: they apply to
// every new song and remix. The first load after the quality upgrade turns on
// the vocal polish chain and -14 LUFS loudness once; the user can switch
// either off and the choice sticks.

import { readPromptMode, writePromptMode, type PromptMode } from './prompt-clean.ts';
import type { Yue2Request } from './types.js';

export type VocalPolish = 'off' | 'mix' | 'stems';
export interface QualitySettings {
	polish: VocalPolish;
	scoreRetries: number;   // 0-3 score re-draws when vocals or choruses are missing
	chorusLock: boolean;    // later choruses reuse the first chorus melody
	promptMode: PromptMode; // clean tag line or the legacy prose prompt
}

const KEY = 'yue2-quality-v1';
export const QUALITY_DEFAULTS: QualitySettings = { polish: 'mix', scoreRetries: 2, chorusLock: true, promptMode: 'clean' };

export function cleanQuality(value: unknown): QualitySettings {
	const v = (value && typeof value === 'object' ? value : {}) as Partial<QualitySettings>;
	return {
		polish: v.polish === 'off' || v.polish === 'stems' ? v.polish : v.polish === 'mix' ? 'mix' : QUALITY_DEFAULTS.polish,
		scoreRetries: Number.isInteger(v.scoreRetries) ? Math.max(0, Math.min(3, v.scoreRetries as number)) : QUALITY_DEFAULTS.scoreRetries,
		chorusLock: typeof v.chorusLock === 'boolean' ? v.chorusLock : QUALITY_DEFAULTS.chorusLock,
		promptMode: v.promptMode === 'legacy' ? 'legacy' : v.promptMode === 'clean' ? 'clean' : readPromptMode()
	};
}

function load(): { settings: QualitySettings; firstRun: boolean } {
	try {
		const raw = localStorage.getItem(KEY);
		if (raw) return { settings: cleanQuality(JSON.parse(raw)), firstRun: false };
	} catch { /* fall through to defaults */ }
	return { settings: cleanQuality({}), firstRun: true };
}

const loaded = load();
export const quality = $state<QualitySettings>(loaded.settings);
// true once, on the first load after the upgrade: callers turn on loudness
export const qualityFirstRun = loaded.firstRun;

export function saveQuality(): void {
	writePromptMode(quality.promptMode);
	try { localStorage.setItem(KEY, JSON.stringify($state.snapshot(quality))); } catch { /* in-memory only */ }
}
if (loaded.firstRun) saveQuality();

// The quality switches as request fields. Server defaults are omitted.
export function withQuality(request: Yue2Request, settings: QualitySettings = quality): Yue2Request {
	const out: Yue2Request = { ...request };
	if (settings.polish !== 'off') out.vocal_polish = settings.polish; else delete out.vocal_polish;
	if (settings.scoreRetries !== 2) out.score_retries = settings.scoreRetries; else delete out.score_retries;
	if (!settings.chorusLock) out.chorus_lock = false; else delete out.chorus_lock;
	return out;
}
