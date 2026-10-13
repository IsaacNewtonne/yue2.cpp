<script lang="ts">
	import { onMount, tick as svelteTick } from 'svelte';
	import { decodeAudio } from '../lib/audio-cache.js';
	import { untrack } from 'svelte';
	import { WAVEFORM_HEIGHT, WAVEFORM_BINS } from '../lib/config.js';
	import { app } from '../lib/state.svelte.js';
	import { updateSong } from '../lib/db.js';
	import type { Song } from '../lib/types.js';
	import { selectTrack, seek, toggleTrack } from '../lib/player.svelte.js';

	let {
		song,
		audio,
		playing = false,
		time = 0,
		dur = $bindable(0),
		selectable = false,
		rangeStart = $bindable(0),
		rangeEnd = $bindable(0)
	}: {
		song: Song;
		audio?: Blob;
		playing: boolean;
		time: number;
		dur: number;
		selectable?: boolean;
		rangeStart?: number;
		rangeEnd?: number;
	} = $props();

	let canvas: HTMLCanvasElement;
	let peaks: Float32Array = new Float32Array();
	let cw = 0;
	let ch = 0;

	let audioReady = $state(false);
	let visible = $state(false);
	let decodeError = $state('');
	let loading = $state(false);
	let retry = $state(0);

	// pointer state
	let dragging = false;
	let dragEdge: 'lo' | 'hi' | 'new' = 'new';
	let anchor = -1;

	onMount(() => {
		cw = WAVEFORM_BINS;
		ch = WAVEFORM_HEIGHT;
		canvas.width = cw;
		canvas.height = ch;


		if (song.peaks) {
			peaks = song.peaks;
			dur = song.duration;
			draw();
		}
		audioReady = true;
		const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; }, {rootMargin:'100px'});
		observer.observe(canvas);

		canvas.addEventListener('touchstart', preventTouch, { passive: false });
		canvas.addEventListener('touchmove', preventTouch, { passive: false });

		return () => {
			observer.disconnect();
			canvas.removeEventListener('touchstart', preventTouch);
			canvas.removeEventListener('touchmove', preventTouch);
		};
	});

	$effect(() => {
		const selectedAudio = audio ?? song.audio;
		retry;
		if (!audioReady) return;
		let cancelled = false;
		const isMasteredAudio = selectedAudio === song.audio;
		const revision=song.mediaRevision??0;
		peaks = isMasteredAudio && song.peaks ? song.peaks : new Float32Array();
		if (isMasteredAudio && song.peaks) dur = song.duration;
		// Drawing reads the moving playhead. Do not make decoding depend on it:
		// cached (mastered) waveforms would otherwise restart on every frame.
		untrack(draw);
		loading = false;
		if (!visible || (peaks.length && retry === 0)) return;
		loading = true; decodeError = '';
		decodeAudio(selectedAudio)
			.then((buf) => {
				if (cancelled) return;
				loading = false;
				dur = buf.duration;
				if (isMasteredAudio && !song.peaks) {
					song.peaks = computePeaks(buf, WAVEFORM_BINS);
					song.duration = buf.duration;
					if (song.id != null) void updateSong(song.id, {peaks:song.peaks,duration:song.duration},revision).catch(() => { /* Cache is optional; playback remains usable. */ });
				}
				peaks = isMasteredAudio ? (song.peaks ?? computePeaks(buf, WAVEFORM_BINS)) : computePeaks(buf, WAVEFORM_BINS);
				draw();
			})
			.catch(() => { if (!cancelled) { loading = false; decodeError = 'Audio cannot be decoded. Retry or remove this track from its menu.'; } });
		return () => {
			cancelled = true;
		};
	});

	function preventTouch(e: TouchEvent) {
		e.preventDefault();
	}

	// redraw when theme or selectable state changes
	$effect(() => {
		app.dark;
		selectable;
		svelteTick().then(() => {
			if (peaks.length > 0) draw();
		});
	});

	// redraw when range changes from external source (field input)
	$effect(() => {
		rangeStart;
		rangeEnd;
		if (peaks.length > 0) draw();
	});

	$effect(() => { time; if (audioReady) untrack(draw); });

	function computePeaks(buf: AudioBuffer, numBins: number): Float32Array {
		const raw = buf.getChannelData(0);
		const binSize = Math.floor(raw.length / numBins);
		const out = new Float32Array(numBins);
		for (let i = 0; i < numBins; i++) {
			let max = 0;
			const start = i * binSize;
			const end = Math.min(start + binSize, raw.length);
			for (let j = start; j < end; j++) {
				const v = raw[j] < 0 ? -raw[j] : raw[j];
				if (v > max) max = v;
			}
			out[i] = max;
		}
		return out;
	}

	function currentTime(): number { return time; }

	// draw: red (range) > green (played) > gray
	// cursors: red at range edges, green at playhead (on top)
	function draw() {
		if (!canvas || peaks.length === 0) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const style = getComputedStyle(canvas);
		const colorDim = style.getPropertyValue('--waveform-dim').trim() || '#555';
		const colorPlay = style.getPropertyValue('--waveform-play').trim() || '#2ed573';
		const colorRange = style.getPropertyValue('--waveform-range').trim() || '#ff6b6b';

		const progress = dur > 0 ? currentTime() / dur : 0;
		const mid = ch / 2;
		const barW = cw / peaks.length;
		const hasRange = rangeEnd > rangeStart && dur > 0;
		const rA = hasRange ? Math.max(0, rangeStart / dur) : 0;
		const rB = hasRange ? Math.min(1, rangeEnd / dur) : 0;

		ctx.clearRect(0, 0, cw, ch);

		for (let i = 0; i < peaks.length; i++) {
			const frac = i / peaks.length;
			const x = i * barW;
			const barH = peaks[i] * mid * 0.9;
			if (hasRange && frac >= rA && frac < rB) {
				ctx.fillStyle = colorRange;
			} else if (frac <= progress) {
				ctx.fillStyle = colorPlay;
			} else {
				ctx.fillStyle = colorDim;
			}
			ctx.fillRect(x, mid - barH, Math.max(1, barW - 0.5), barH * 2);
		}

		if (hasRange) {
			ctx.fillStyle = colorRange;
			ctx.fillRect(rA * cw - 2, 0, 4, ch);
			ctx.fillRect(rB * cw - 2, 0, 4, ch);
		}

		if (progress > 0 && progress < 1) {
			ctx.fillStyle = colorPlay;
			ctx.fillRect(progress * cw - 2, 0, 4, ch);
		}
	}

	function xToNorm(clientX: number): number {
		if (!canvas) return 0;
		const rect = canvas.getBoundingClientRect();
		return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
	}

	function seekTo(norm: number) {
		if (dur <= 0) return;
		selectTrack(song, audio ?? song.audio);
		seek(Math.max(0, Math.min(1, norm)) * dur);
		draw();
	}

	function onPointerDown(e: PointerEvent) {
		dragging = true;
		canvas.setPointerCapture(e.pointerId);
		if (selectable) {
			const pos = xToNorm(e.clientX);
			const cur = pos * dur;
			// snap closest edge to mouse, or start new range
			if (rangeEnd > rangeStart && dur > 0) {
				const dLo = Math.abs(pos - rangeStart / dur);
				const dHi = Math.abs(pos - rangeEnd / dur);
				if (dLo <= dHi) {
					dragEdge = 'lo';
					rangeStart = cur;
				} else {
					dragEdge = 'hi';
					rangeEnd = cur;
				}
			} else {
				dragEdge = 'new';
				anchor = pos;
				rangeStart = cur;
				rangeEnd = cur;
			}
			draw();
		} else {
			seekTo(xToNorm(e.clientX));
		}
	}

	function onPointerMove(e: PointerEvent) {
		if (!dragging) return;
		if (selectable) {
			const cur = xToNorm(e.clientX) * dur;
			if (dragEdge === 'lo') {
				rangeStart = cur;
			} else if (dragEdge === 'hi') {
				rangeEnd = cur;
			} else {
				rangeStart = Math.min(anchor * dur, cur);
				rangeEnd = Math.max(anchor * dur, cur);
			}
			// swap edges when crossing
			if (rangeStart > rangeEnd) {
				const tmp = rangeStart;
				rangeStart = rangeEnd;
				rangeEnd = tmp;
				dragEdge = dragEdge === 'lo' ? 'hi' : 'lo';
			}
			draw();
		} else {
			seekTo(xToNorm(e.clientX));
		}
	}

	function onPointerUp() {
		dragging = false;
	}
	function onKeyDown(event: KeyboardEvent) {
		if (selectable || event.isComposing) return;
		if (event.key === ' ') { event.preventDefault(); toggleTrack(song, audio ?? song.audio); return; }
		if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || dur <= 0) return;
		event.preventDefault();
		const delta = ['ArrowRight', 'ArrowUp'].includes(event.key) ? 5 : -5;
		seekTo(event.key === 'Home' ? 0 : event.key === 'End' ? 1 : (time + delta) / dur);
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
{#if decodeError}<p role="alert">{decodeError} <button onclick={() => retry++}>Retry audio</button></p>{:else if loading}<p role="status">Loading audio…</p>{/if}
<canvas
	bind:this={canvas}
	class="waveform"
	role={selectable ? 'img' : 'slider'}
	tabindex={selectable ? undefined : 0}
	aria-label={selectable ? `${song.name} range selection; use the range fields for precise editing` : `Seek in ${song.name}`}
	aria-valuemin={selectable ? undefined : 0}
	aria-valuemax={selectable ? undefined : dur}
	aria-valuenow={selectable ? undefined : Math.floor(time)}
	aria-valuetext={selectable ? undefined : `${Math.floor(time)} of ${Math.floor(dur)} seconds`}
	onkeydown={onKeyDown}
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	onlostpointercapture={onPointerUp}
></canvas>

<style>
	.waveform {
		width: 100%;
		height: var(--waveform-h, 64px);
		cursor: pointer;
		border-radius: 2px;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
	}
</style>
