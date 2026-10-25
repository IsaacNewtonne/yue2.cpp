<script lang="ts">
	// Lyric-fit meter: how long the lyrics need against where the song stops.
	import { clock, type LyricFit } from '../lib/lyric-fit.ts';
	let { fit, auto, duration }: { fit: LyricFit; auto: boolean; duration?: number } = $props();
	const MAX = 600;
	const stop = $derived(auto ? fit.ceiling : duration || 0);
	const pct = (s: number) => `${Math.max(0, Math.min(100, (s / MAX) * 100))}%`;
	const badge = $derived(fit.estimate === 0 ? 'No lyrics' : fit.level === 'good' ? 'Fits' : fit.level === 'warn' ? 'Long' : 'Too long');
</script>

<div class={`fit-meter fit-${fit.level}`} role="group" aria-label="Lyric fit">
	<div class="fit-head">
		<span class={`hue-chip fit-${fit.level}`}>{badge}</span>
		<strong>{fit.summary}</strong>
	</div>
	<div class="fit-track" aria-hidden="true">
		{#if fit.estimate}<span class="fit-fill" style:width={pct(fit.estimate)}></span>{/if}
		{#if stop}<span class="fit-stop" style:left={pct(stop)} title={`Stops by ${clock(stop)}`}></span>{/if}
	</div>
	<div class="fit-scale" aria-hidden="true"><span>0:00</span><span>5:00</span><span>10:00</span></div>
	<p class="fit-advice">{fit.advice}</p>
	{#if fit.estimate}<p class="fit-counts">{fit.words} words · {fit.lines} lines · {fit.choruses} {fit.choruses === 1 ? 'chorus' : 'choruses'}</p>{/if}
</div>

<style>
	.fit-meter { --hue: var(--fit-good); display: grid; gap: 6px; padding: 10px 12px; border-radius: 10px; border: 1px solid color-mix(in srgb, var(--hue) 45%, var(--border)); background: color-mix(in srgb, var(--hue) 7%, transparent); }
	.fit-warn { --hue: var(--fit-warn); }
	.fit-bad { --hue: var(--fit-bad); }
	.fit-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
	.fit-head strong { font-size: 13px; font-weight: 600; color: var(--fg); font-variant-numeric: tabular-nums; }
	.fit-track { position: relative; height: 8px; border-radius: 999px; background: color-mix(in srgb, var(--fg) 12%, transparent); }
	.fit-fill { position: absolute; inset: 0 auto 0 0; border-radius: inherit; background: var(--hue); }
	.fit-stop { position: absolute; top: -4px; width: 3px; height: 16px; margin-left: -1px; border-radius: 2px; background: var(--fg); }
	.fit-scale { display: flex; justify-content: space-between; font-size: 12px; color: var(--fg-dim); font-variant-numeric: tabular-nums; }
	p { margin: 0; font-size: 12px; line-height: 1.5; color: var(--fg-dim); }
	.fit-counts { margin: 0; font-size: 12px; color: var(--fg); font-variant-numeric: tabular-nums; }
	.fit-advice { margin: 0; }
</style>
