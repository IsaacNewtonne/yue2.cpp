<script lang="ts">
	// The song form at a glance: one chip per lyric section, coloured by kind.
	import { lyricSections } from '../lib/song-structure.ts';
	import { sectionKind, SECTION_KIND_NAMES, type SectionKind } from '../lib/prompt-clean.ts';
	let { lyrics = '' }: { lyrics?: string } = $props();
	const sections = $derived(lyricSections(lyrics).map((s) => ({
		label: s.label,
		kind: sectionKind(s.label, s.body),
		lines: s.body.split('\n').filter((l) => l.trim()).length
	})));
	const kinds = $derived([...new Set(sections.map((s) => s.kind))] as SectionKind[]);
</script>

{#if sections.length}
	<div class="section-map" aria-label="Lyric sections in order">
		<ol>
			{#each sections as section}
				<li class={`hue-chip sec-${section.kind}`} title={`${section.label} · ${section.lines} lines`}>
					{section.label}<small>{section.lines || '—'}</small>
				</li>
			{/each}
		</ol>
		<p class="legend">{#each kinds as kind}<span class={`hue-chip no-dot sec-${kind}`}>{SECTION_KIND_NAMES[kind]}</span>{/each}<span class="legend-note">Numbers are lines per section.</span></p>
	</div>
{/if}

<style>
	.section-map { display: grid; gap: 8px; margin: 10px 0 4px; }
	ol { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
	li small { font-size: 12px; font-weight: 500; opacity: .85; }
	.legend { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 0; }
	.legend .hue-chip { min-height: 22px; padding: 1px 8px; font-weight: 500; }
	.legend-note { font-size: 12px; color: var(--fg-dim); }
</style>
