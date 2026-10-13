<script lang="ts">
	import { onMount } from 'svelte';
	import { getPlaybackAnalyser, subscribePlayback } from '../lib/audio.js';
	let { compact = false }: { compact?: boolean } = $props();
	let cabinet: HTMLDivElement;
	onMount(() => {
		const motion = matchMedia('(prefers-reduced-motion: reduce)');
		let frame = 0, playing = false, bass = 0, high = 0;
		let analyser: AnalyserNode | undefined;
		let bins = new Float32Array(1024);
		let last = 0;
		function paint() {
			cabinet.style.setProperty('--excursion', String(bass));
			cabinet.style.setProperty('--presence', String(high));
		}
		function tick(now: number) {
			frame = 0;
			const dt = Math.min((now - last) / 1000 || 0.016, 0.05); last = now;
			let lowTarget = 0, highTarget = 0;
			if (playing && analyser) {
				analyser.getFloatFrequencyData(bins);
				const hz = analyser.context.sampleRate / analyser.fftSize;
				let lowPower = 0, highPower = 0;
				for (let i = 1; i < bins.length; i++) {
					const power = 10 ** (bins[i] / 10);
					if (i * hz >= 30 && i * hz <= 240) lowPower += power;
					if (i * hz >= 2000 && i * hz <= 12000) highPower += power;
				}
				// Compress the visual dynamic range so quiet monitoring still shows bass.
				// Silence stays still; no synthetic beat or cabinet shaking.
				lowTarget = Math.pow(Math.max(0, Math.min(1, (10 * Math.log10(lowPower + 1e-12) + 85) / 55)), .7);
				highTarget = Math.pow(Math.max(0, Math.min(1, (10 * Math.log10(highPower + 1e-12) + 80) / 55)), .8);
			}
			bass += (lowTarget - bass) * (1 - Math.exp(-dt / (lowTarget > bass ? 0.012 : 0.12)));
			high += (highTarget - high) * (1 - Math.exp(-dt / 0.035));
			if (!playing && bass < 0.001 && high < 0.001) { bass = high = 0; paint(); return; }
			paint(); frame = requestAnimationFrame(tick);
		}
		function update() {
			cancelAnimationFrame(frame); frame = 0;
			if (document.hidden || motion.matches) { bass = high = 0; paint(); return; }
			if (playing || bass || high) { last = performance.now(); frame = requestAnimationFrame(tick); }
		}
		const unsubscribe = subscribePlayback(active => {
			playing = active;
			if (active && !analyser) { analyser = getPlaybackAnalyser(); bins = new Float32Array(analyser.frequencyBinCount); }
			update();
		});
		document.addEventListener('visibilitychange', update);
		motion.addEventListener('change', update);
		return () => { unsubscribe(); cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', update); motion.removeEventListener('change', update); };
	});
</script>

<div bind:this={cabinet} class="speaker-cabinet" class:compact aria-hidden="true">
	<span class="screw tl"></span><span class="screw tr"></span><span class="screw bl"></span><span class="screw br"></span>
	<div class="tweeter"><div class="tweeter-dome"></div></div>
	<div class="woofer"><div class="surround"><div class="cone"><div class="dust-cap"></div></div></div></div>
	<div class="speaker-foot"><span class="power-led"></span><span class="bass-port"></span><span class="speaker-mark">Y / 2</span></div>
</div>

<style>
	.speaker-cabinet { --excursion:0; --presence:0; position:relative; flex:none; width:100px; height:140px; padding:10px 8px 9px; box-sizing:border-box; display:flex; flex-direction:column; align-items:center; justify-content:space-between; border:1px solid #55585d; border-radius:9px; background:repeating-linear-gradient(92deg,#ffffff03 0 1px,transparent 1px 3px),linear-gradient(120deg,#36383d,#151619 45%,#222428); box-shadow:inset 2px 2px 3px #ffffff20,inset -3px -3px 4px #000b,3px 6px 9px #0007; }
	.tweeter { width:29px; height:29px; display:grid; place-items:center; border-radius:50%; background:radial-gradient(circle,#101114 30%,#303238 40%,#08090b 57%,#4b4d51 61%,#111216 66%); box-shadow:0 1px 2px #ffffff19; }
	.tweeter-dome { width:13px; height:13px; border-radius:50%; background:radial-gradient(circle at 38% 28%,#b8bec5,#646b74 24%,#242a31 52%,#08090c 78%); transform:scale(calc(1 + var(--presence) * .18)); }
	.woofer { width:78px; height:78px; display:grid; place-items:center; border-radius:50%; background:conic-gradient(from 35deg,#75797e,#202226,#111215,#5d6167,#151619,#75797e); box-shadow:0 3px 4px #000c,inset 0 0 0 1px #ffffff18; }
	.surround { transform:scale(calc(1 + var(--excursion) * .035)); width:70px; height:70px; display:grid; place-items:center; border-radius:50%; background:radial-gradient(circle,#131518 50%,#45484d 57%,#1e2024 65%,#070809 71%); }
	.cone { width:57px; height:57px; display:grid; place-items:center; border-radius:50%; background:repeating-radial-gradient(circle,#ffffff07 0 .6px,transparent .8px 2px),conic-gradient(from 20deg,#555b62,#272c32,#14171c,#464c53,#697079,#30353c,#555b62); box-shadow:inset 0 0 6px 3px #000b,0 1px 2px #000; transform:scale(calc(1 + var(--excursion) * .28)); filter:brightness(calc(1 + var(--excursion) * .75)); will-change:transform; }
	.dust-cap { transform:scale(calc(1 + var(--excursion) * .12)); width:27px; height:27px; border-radius:50%; background:radial-gradient(ellipse at 36% 22%,#737b86,#343a43 28%,#15181d 59%,#08090c 83%); box-shadow:0 2px 4px #000c,inset 0 1px 1px #aab5c044; }
	.speaker-foot { width:100%; display:flex; align-items:center; justify-content:space-between; height:9px; }
	.power-led { width:3px; height:3px; border-radius:50%; background:#99e8ca; box-shadow:0 0 4px #65dbae88; }
	.bass-port { width:32px; height:5px; border-radius:3px; background:#030405; box-shadow:0 1px 0 #ffffff20,inset 0 1px 2px #000; }
	.speaker-mark { color:#a5a9ae; font:5px monospace; letter-spacing:1px; }
	.screw { position:absolute; width:3px; height:3px; border-radius:50%; background:linear-gradient(135deg,#777 40%,#111 42% 60%,#555 62%); }
	.tl {top:5px;left:5px}.tr {top:5px;right:5px}.bl {bottom:5px;left:5px}.br {bottom:5px;right:5px}
	.compact { width:36px; height:48px; padding:3px; border-radius:4px; box-shadow:inset 1px 1px 2px #ffffff20,2px 3px 4px #0006; }
	.compact .tweeter {width:10px;height:10px}.compact .tweeter-dome {width:5px;height:5px}
	.compact .woofer {width:27px;height:27px}.compact .surround {width:24px;height:24px}.compact .cone {width:20px;height:20px}.compact .dust-cap {width:10px;height:10px}
	.compact .speaker-foot {height:3px}.compact .bass-port {width:13px;height:2px}.compact .speaker-mark,.compact .screw {display:none}.compact .power-led {width:2px;height:2px}
	@media (prefers-reduced-motion:reduce) { .cone {will-change:auto} }
</style>
