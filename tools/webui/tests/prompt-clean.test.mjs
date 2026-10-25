import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compactStyle, cleanLyrics, standardLabel, modelRequest, lyricLanguage, STYLE_LIMIT } from '../src/lib/prompt-clean.ts';
import { lyricFit, autoCeiling, serverEstimate } from '../src/lib/lyric-fit.ts';
import { musicPrompt, freeformMusicPrompt } from '../src/lib/style-mix.ts';
import { applyProducer, cleanProducer } from '../src/lib/producer.ts';

const boomBap = readFileSync(new URL('../../../music_styles/001_boom_bap.md', import.meta.url), 'utf8');
const producer = cleanProducer({ enabled: true, singing: 30, presence: 80, voices: 1, bpm: 92, voiceProfiles: ['Deep grounded rap voice, clear rhythmic diction'] });
const lyrics = `NO SAFE DISTANCE\n\n[Intro]\n\n[Verse 1 - Voice 1]\nMarcus: New city, new key\nMarcus: Nobody knows the old nickname\n\n[Hook: Marcus & Dana]\nNo safe distance\n(Voice 2)\nNo safe distance\n\n[Post-Chorus]\nOh oh\n\n[Verse 2]\nDana: Then an old number lit the screen\n\n[Chorus]\nNo safe distance\n\n[Outro]`;

test('style becomes one short tag line with genre, delivery, voice and tempo', () => {
	const blend = musicPrompt(['boom_bap'], { boom_bap: 100 }, { boom_bap: boomBap }, [['boom_bap', 'Boom Bap']]);
	const legacy = applyProducer({ style: blend, lyrics, abc_sampling: {}, semantic_sampling: {} }, producer).style;
	assert.ok(legacy.length > 1000, 'the legacy prompt is the long markdown sheet');
	for (const input of [blend, legacy]) {
		const style = compactStyle(input, producer, lyrics);
		assert.ok(style.length <= STYLE_LIMIT, `${style.length} chars`);
		assert.match(style, /^Boom Bap, /);
		assert.match(style, /rap verses, sung hook/);
		assert.match(style, /deep grounded English rap vocal/);
		assert.match(style, /92 BPM$/);
		assert.doesNotMatch(style, /##|\*\*|Song direction|strength|Voice 1/);
	}
});

test('freeform direction: short text is kept, long markdown is condensed', () => {
	assert.equal(compactStyle('Dreamy synth-pop, airy female vocal, 110 BPM'), 'Dreamy synth-pop, airy female vocal, 110 BPM');
	const wrapped = freeformMusicPrompt('Dreamy synth-pop, airy female vocal, 110 BPM', 70);
	assert.equal(compactStyle(wrapped), 'Dreamy synth-pop, airy female vocal, 110 BPM');
	const long = '# My sound\n' + Array.from({ length: 40 }, (_, i) => `- texture number ${i}`).join('\n');
	const style = compactStyle(long, null, '');
	assert.ok(style.length <= STYLE_LIMIT);
	assert.match(style, /^My sound, texture number 0/);
});

test('lyrics: standard labels, no title, voice or character names, words unchanged', () => {
	const clean = cleanLyrics(lyrics);
	assert.equal(clean, `[Intro]\n\n[Verse]\nNew city, new key\nNobody knows the old nickname\n\n[Chorus]\nNo safe distance\nNo safe distance\n\n[Bridge]\nOh oh\n\n[Verse]\nThen an old number lit the screen\n\n[Chorus]\nNo safe distance\n\n[Outro]`);
	assert.equal(standardLabel('Pre-Hook (Voice 2)'), 'Pre-Chorus');
	assert.equal(standardLabel('Refrain x2'), 'Chorus');
	assert.equal(standardLabel('Breakdown'), 'Bridge');
	assert.equal(standardLabel('Instrumental break', true), 'Interlude');
	assert.equal(standardLabel('Ending'), 'Outro');
	assert.equal(standardLabel('Rap 2: Dana'), 'Verse');
	assert.equal(cleanLyrics('one line\ntwo line\n\nthree line'), '[Verse]\none line\ntwo line\n\n[Verse]\nthree line');
	assert.equal(lyricLanguage('我们一起走'), 'Mandarin');
	assert.equal(lyricLanguage('hello there'), 'English');
});

test('model request: clean by default, legacy reproduces the old prompt, editor untouched', () => {
	const request = { style: 'Boom bap, 90 BPM', lyrics, abc_sampling: {}, semantic_sampling: {} };
	const clean = modelRequest(request, { mode: 'clean', planning: true, producer, rawStyle: request.style });
	assert.equal(clean.lyrics, cleanLyrics(lyrics));
	assert.match(clean.style, /^Boom bap, 90 BPM, rap verses, sung hook, deep grounded English rap vocal$/);
	assert.equal(request.lyrics, lyrics, 'the editor request is not mutated');
	const legacy = modelRequest(request, { mode: 'legacy', planning: true, producer, rawStyle: request.style });
	assert.deepEqual(legacy, applyProducer(request, producer));
	const instrumental = modelRequest(request, { mode: 'clean', planning: true, producer: { ...producer, presence: 0 }, rawStyle: request.style });
	assert.equal(instrumental.lyrics, '');
	assert.match(instrumental.style, /instrumental/);
});

test('lyric fit meter: estimate, ceiling and colour level', () => {
	assert.equal(autoCeiling(90), 123);
	assert.equal(autoCeiling(0), 600);
	assert.equal(autoCeiling(550), 600);
	const short = Array.from({ length: 20 }, () => 'we ride the night away').join('\n');
	assert.equal(serverEstimate(`[Verse]\n${short}`), 73);
	const auto = lyricFit(`[Verse]\n${short}\n[Chorus]\nhey`, null, 0);
	assert.equal(auto.level, 'good');
	assert.equal(auto.choruses, 1);
	assert.equal(auto.ceiling, autoCeiling(auto.estimate));
	assert.equal(lyricFit(`[Verse]\n${short}`, null, 30).level, 'bad', 'manual length cuts the lyrics');
	assert.equal(lyricFit(`[Verse]\n${short}`, null, 400).level, 'warn', 'long instrumental tail');
	const long = Array.from({ length: 130 }, () => 'we ride the night away').join('\n');
	assert.equal(lyricFit(long, null, 0).level, 'bad');
	assert.equal(lyricFit(Array.from({ length: 80 }, () => 'we ride the night away').join('\n'), null, 0).level, 'warn');
	assert.equal(lyricFit('', null, 0).estimate, 0);
});
