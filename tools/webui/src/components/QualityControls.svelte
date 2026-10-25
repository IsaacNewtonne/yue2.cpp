<script lang="ts">
	// Voice and structure quality switches. Studio-wide, saved on change.
	import { quality, saveQuality } from '../lib/quality.svelte.ts';
	import { app } from '../lib/state.svelte.js';
	let { compact = false }: { compact?: boolean } = $props();
	const loud = $derived((app.request.mastering_profile || 'off') !== 'off');
	function setLoud(on: boolean) { app.request.mastering_profile = on ? 'streaming' : 'off'; }
</script>

<div class="quality" class:compact role="group" aria-label="Voice and structure quality">
	<label class="q-row"><span><strong>Vocal polish</strong><small>{quality.polish === 'stems' ? 'Separates the vocal, cleans it, then remixes. Slower; downloads a 640 MB model on first use.' : quality.polish === 'mix' ? 'Gentle EQ, de-ess and compression on the finished mix.' : 'Raw model output.'}</small></span>
		<select aria-label="Vocal polish" bind:value={quality.polish} onchange={saveQuality}>
			<option value="off">Off</option><option value="mix">Mix · EQ, de-ess, glue</option><option value="stems">Vocal stem · cleaner, slower</option>
		</select></label>
	<label class="q-row"><span><strong>Loudness −14 LUFS</strong><small>Streaming level with a −1 dBTP ceiling. The dry take is kept too.</small></span>
		<input type="checkbox" role="switch" aria-label="Loudness −14 LUFS" checked={loud} onchange={(e) => setLoud(e.currentTarget.checked)} /></label>
	<label class="q-row"><span><strong>Chorus lock</strong><small>Later choruses reuse the first chorus melody when their words match.</small></span>
		<input type="checkbox" role="switch" aria-label="Chorus lock" bind:checked={quality.chorusLock} onchange={saveQuality} /></label>
	{#if !compact}
		<label class="q-row"><span><strong>Score check</strong><small>Re-draws a score with no sung melody or missing choruses before rendering.</small></span>
			<select aria-label="Score check retries" bind:value={quality.scoreRetries} onchange={saveQuality}>
				<option value={0}>Off</option><option value={1}>1 retry</option><option value={2}>2 retries</option><option value={3}>3 retries</option>
			</select></label>
		<label class="q-row"><span><strong>Prompt format</strong><small>{quality.promptMode === 'clean' ? 'Short tag line and standard section labels, as YuE2 was trained.' : 'Previous long prompt, kept for A/B comparison.'}</small></span>
			<select aria-label="Prompt format" bind:value={quality.promptMode} onchange={saveQuality}>
				<option value="clean">Clean · recommended</option><option value="legacy">Legacy · A/B test</option>
			</select></label>
	{/if}
</div>

<style>
	.quality { display: grid; gap: 4px; }
	.q-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; min-height: 44px; padding: 6px 0; border-bottom: 1px solid var(--border); }
	.q-row:last-child { border-bottom: 0; }
	.q-row span { display: grid; gap: 2px; min-width: 0; }
	strong { font-size: 13px; font-weight: 600; color: var(--fg); }
	small { font-size: 12px; line-height: 1.45; color: var(--fg-dim); }
	select { flex: 0 0 auto; max-width: 52%; min-height: 40px; }
	input[type=checkbox] { flex: none; width: 22px; height: 22px; accent-color: var(--accent); }
</style>
