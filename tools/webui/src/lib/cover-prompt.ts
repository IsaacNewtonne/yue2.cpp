// Lyrics select visual motifs locally. Never send verses to the image model:
// text-capable models can reproduce them as a lyric sheet instead of a scene.
const motifs: [RegExp, string][] = [
	[/\b(friends?|people|together|family|home|neighbou?r)\b/gi, 'a lived-in neighborhood gathering, expressive people, warm windows and amber evening light'],
	[/\b(tired|exhausted|low power|burnout|sleep|lonely|alone)\b/gi, 'a solitary figure in a cluttered late-night room, rain-streaked windows, blue monitor glow and a warm desk lamp'],
	[/\b(dreams?|chill|smoke|haze|float|surreal)\b/gi, 'a contemplative figure surrounded by swirling haze, an intricate dreamlike city and luminous teal shadows'],
	[/\b(free|freedom|chains?|rebel|guru|rise|power)\b/gi, 'a defiant central figure overlooking a weathered city, storm clouds splitting around a golden shaft of light'],
	[/\b(luxury|money|rich|gold|wealth|success)\b/gi, 'a sharply dressed figure in a moody penthouse, scattered personal objects and distant city lights'],
	[/\b(love|heart|kiss|miss|goodbye|lost)\b/gi, 'an intimate human story on a rain-soaked street, reflections, empty space and a distant warm doorway'],
	[/\b(road|drive|ride|car|journey|highway)\b/gi, 'a lone traveler beside a vintage car on an open road, atmospheric distance and a dramatic horizon'],
	[/\b(forest|trees?|mountain|river|ocean|sea|nature)\b/gi, 'a small human figure in an expansive natural landscape, layered mist and detailed organic textures']
];

export function coverPrompt(title: string, style: string, lyrics: string): string {
	const cleanTitle = title.replace(/\s+/g, ' ').trim().slice(0, 200) || 'Untitled track';
	const ranked = motifs.map(([pattern, scene]) => ({ scene,
		score: [...cleanTitle.matchAll(pattern)].length * 5 + Math.min([...lyrics.matchAll(pattern)].length, 3)
	})).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
	const scene = ranked[0]?.scene ?? 'invent a specific visual story inspired by the title: an expressive focal subject in a richly detailed environment, meaningful props and atmospheric depth';
	const mood = style.split(/Song direction:|##|\n/)[0].trim().slice(0, 300);
	return `Create a finished horizontal 16:9 music cover / YouTube thumbnail, 1280 by 720 composition. Premium cinematic illustrated album art with the visual richness of a painted movie poster.
SCENE: ${scene}. Interpret the title visually and adapt the setting to the musical mood${mood ? `: ${mood}` : ''}. Make the subject, environment and storytelling occupy most of the frame. Rich tactile detail, layered foreground and background, dramatic directional lighting, deep shadows, selective saturated accents and film grain. Deliberate composition that reads at thumbnail size.
TITLE: The only lettering in the image is the exact title ${JSON.stringify(cleanTitle)}. Set it large in expressive, professionally designed display typography: stacked condensed vintage lettering, warm retro script or rough brush lettering as suits the mood. Strong contrast, subtle shadow or outline, integrated into open space without obscuring the focal subject. Keep the complete title comfortably inside the frame.
The result must be a vivid scene with a bold title. No lyric sheets, verses, paragraphs, tracklists, captions, extra words, watermarks, logos, player controls or plain text-only backgrounds. Fill the landscape frame edge to edge.`;
}
