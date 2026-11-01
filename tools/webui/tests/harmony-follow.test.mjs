import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectionLabel, sectionLabels, withStructure, cleanStructure, STRUCTURE_DEFAULTS } from '../src/lib/harmony.ts';

test('lyric tags map to the planner section names', () => {
	assert.deepEqual(sectionLabels('[Intro]\n[Verse 1]\nwalking down\n[Hook]\nall the lights\n[Outro]'), ['intro', 'verse', 'chorus', 'outro']);
	assert.equal(sectionLabel('Pre_Chorus 2:'), 'pre-chorus');
	assert.equal(sectionLabel('Post Chorus'), 'post-chorus');
	assert.equal(sectionLabel('Refrain'), 'chorus');
	assert.equal(sectionLabel('Breakdown'), 'verse');
	assert.equal(sectionLabel('Bridge #1'), 'bridge');
	assert.deepEqual(sectionLabels('la la la\n[Chorus]\nhey'), ['verse', 'chorus']);
	assert.deepEqual(sectionLabels('no tags at all'), ['verse']);
	assert.deepEqual(sectionLabels(''), []);
});

test('settings at rest add no request fields', () => {
	const req = { lyrics: '[Verse]\na\n[Chorus]\nb', cot: 'full' };
	assert.deepEqual(withStructure(req, STRUCTURE_DEFAULTS), req);
	assert.deepEqual(cleanStructure(undefined), STRUCTURE_DEFAULTS);
	assert.deepEqual(cleanStructure({ chordVariety: 99, solver: 'x', followSections: 1 }), { ...STRUCTURE_DEFAULTS, chordVariety: 16 });
});

test('follow, harmony, lyric timing and solver become request fields', () => {
	const s = { followSections: true, chordVariety: 6, sectionVariety: 0, outsideKey: 2, lyricTiming: true, solver: 'ab2' };
	const out = withStructure({ lyrics: '[Verse 1]\na\n[Chorus]\nb\n[Verse 2]\nc', cot: 'full' }, s);
	assert.deepEqual(out.harmony, { strength: 6, outside_bonus: 2, follow: ['verse', 'chorus', 'verse'] });
	assert.equal(out.lyric_schedule, 'auto');
	assert.equal(out.solver, 'ab2');
	// no planner (cot off) or a supplied score: no harmony, no schedule
	const off = withStructure({ lyrics: '[Verse]\na', cot: 'off' }, s);
	assert.equal(off.harmony, undefined);
	assert.equal(off.lyric_schedule, undefined);
	assert.equal(withStructure({ lyrics: '[Verse]\na', abc: 'X:1' }, s).harmony, undefined);
	// guidance other than 1 cannot schedule lyrics
	assert.equal(withStructure({ lyrics: '[Verse]\na', cfg_scale: 1.5 }, s).lyric_schedule, undefined);
	assert.equal(withStructure({ lyrics: '[Verse]\na', cfg_scale: -1 }, s).lyric_schedule, 'auto');
	// stale fields from a loaded preset are cleared when off
	assert.deepEqual(withStructure({ lyrics: 'x', solver: 'ab2', harmony: { strength: 1 } }, STRUCTURE_DEFAULTS), { lyrics: 'x' });
});
