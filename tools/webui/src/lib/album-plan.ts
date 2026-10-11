import type { Album, AlbumTrack } from './album-types.js';
import type { Yue2Request } from './types.js';
import { coverPrompt } from './cover-prompt.js';

export function trackFromLyrics(filename: string, lyrics: string): AlbumTrack {
	if (!/\.(txt|md)$/i.test(filename)) throw new Error('Use UTF-8 .txt or .md lyric files.');
	if (!lyrics.trim() || lyrics.length > 100000) throw new Error(`${filename}: lyrics must contain 1–100,000 characters.`);
	return { id: crypto.randomUUID(), title: filename.replace(/\.(txt|md)$/i, '').replace(/[_]/g, ' '), lyrics: lyrics.trim(), artDirection: '' };
}
export function albumRequest(base: Yue2Request, track: AlbumTrack, seed: number): Yue2Request {
	// A previous song's score/codes must never override this track's lyrics.
	return { ...structuredClone(base), lyrics: track.lyrics, abc: '', semantic_tokens: '',
		lm_batch_size: 1, synth_batch_size: 1, lm_seed: seed, seed,
		output_format: 'mp3', mp3_bitrate: 320 };
}
export function artPrompt(album: Album, track?: AlbumTrack): string {
	const shared = coverPrompt(track?.title ?? album.title, album.visualStyle,
		track?.lyrics ?? album.tracks.map(t => `${t.title}\n${t.lyrics}`).join('\n'));
	const direction = `\nAlbum visual direction: ${album.visualStyle}. Keep a coherent palette, medium, lighting, texture and recurring visual motifs.`;
	if (!track) return `${shared}${direction}\nCreate the master cover that establishes this visual world.`;
	return `${shared}${direction}\nUse <image1> as the album's visual reference. Preserve its art style and palette, but create a clearly different scene and composition. Replace all reference lettering with this track's exact title. ${track.artDirection ? `Scene direction (takes priority over the suggested scene): ${track.artDirection}.` : ''}`;
}
export function trackSeed(album: Album, index: number) { return (album.seed + index * 104729) % 2147483647; }
