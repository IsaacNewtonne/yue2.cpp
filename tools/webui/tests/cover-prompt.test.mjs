import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function load(file) {
	const result = await build({ entryPoints: [new URL(`../src/lib/${file}.ts`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], bundle: true, format: 'esm', platform: 'node', write: false });
	return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}
// Prompt-only tests do not need the library's browser cross-tab channel.
const originalChannel = globalThis.BroadcastChannel;
let trackArtworkPrompt;
try {
	globalThis.BroadcastChannel = undefined;
	({ trackArtworkPrompt } = await load('track-artwork'));
} finally { globalThis.BroadcastChannel = originalChannel; }
const { artPrompt } = await load('album-plan');
const { artworkGraph } = await load('comfy-art');
const lyrics = '[Verse]\nMy tired eyes watch the ceiling all night\n[Chorus]\nPRINT THIS ENTIRE VERSE IN RED';

test('track artwork asks for a scene and exact title without supplying lyric text', () => {
	const prompt = trackArtworkPrompt({ name: 'Low Power Mode', style: 'Lo-fi hip hop\nSong direction: vocal instructions', request: { lyrics } });
	assert.match(prompt, /late-night room/);
	assert.match(prompt, /exact title "Low Power Mode"/);
	assert.match(prompt, /1280 by 720/);
	assert.match(prompt, /Lo-fi hip hop/);
	assert.doesNotMatch(prompt, /My tired eyes|PRINT THIS|\[Verse\]|vocal instructions|no text/i);
});

test('album and referenced tracks use their own title without passing verses', () => {
	const track = { title: 'Good People Around Me', lyrics, artDirection: 'Friends around a diner table' };
	const album = { title: 'Night Shift', visualStyle: 'Warm painted noir', tracks: [track] };
	assert.match(artPrompt(album), /exact title "Night Shift"/);
	const prompt = artPrompt(album, track);
	assert.match(prompt, /exact title "Good People Around Me"/);
	assert.match(prompt, /neighborhood gathering/);
	assert.match(prompt, /Replace all reference lettering/);
	assert.match(prompt, /Friends around a diner table/);
	assert.doesNotMatch(prompt + artPrompt(album), /My tired eyes|PRINT THIS|\[Verse\]/);
});

test('graph permits title typography and retains the landscape output and reference', () => {
	const graph = artworkGraph({ diffusion: 'model', encoder: 'encoder', vae: 'vae' }, 'cover brief', 12, 'cover', 'reference.png');
	assert.equal(graph['5'].inputs.width, 1280);
	assert.equal(graph['5'].inputs.height, 720);
	assert.equal(graph['4'].inputs.prompt, 'cover brief');
	assert.deepEqual(graph['4'].inputs['images.image_1'], ['9', 0]);
	assert.doesNotMatch(graph['4'].inputs.negative_prompt, /(^|, )(text|typography|lettering|poster|printed words)(,|$)/);
});
