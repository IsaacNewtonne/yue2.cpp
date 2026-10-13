<script lang="ts">
 import { onMount } from 'svelte';
 import { getPlaybackAnalyser, subscribePlayback } from '../lib/audio.js';
 let { mode }: { mode: 'spectrum' | 'oscilloscope' } = $props();
 let canvas: HTMLCanvasElement;
 onMount(() => {
  const context = canvas.getContext('2d');
  if (!context) return;
  const analyser = getPlaybackAnalyser(), frequency = new Uint8Array(analyser.frequencyBinCount), wave = new Uint8Array(analyser.fftSize);
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0, active = false, visible = true, width = 0, height = 0, accent = '', faint = '';
  const levels = new Float32Array(40);
  function colors() { const style = getComputedStyle(canvas); accent = style.getPropertyValue('--accent').trim() || '#ff8a36'; faint = style.getPropertyValue('--fg-faint').trim() || '#555'; }
  function draw() {
   if (!context) return;
   context.clearRect(0, 0, width, height);
   const live = active && !motion.matches;
   context.lineWidth = 1.5; context.strokeStyle = live ? accent : faint; context.fillStyle = live ? accent : faint;
   if (mode === 'spectrum') {
    if (live) analyser.getByteFrequencyData(frequency);
    const step = width / levels.length;
    for (let i = 0; i < levels.length; i++) {
     const lo = Math.floor(Math.pow(frequency.length, i / levels.length)), hi = Math.max(lo + 1, Math.floor(Math.pow(frequency.length, (i + 1) / levels.length)));
     let peak = 0;
     if (live) for (let bin = lo; bin < hi; bin++) peak = Math.max(peak, frequency[bin] / 255);
     levels[i] += (peak - levels[i]) * .25;
     if (!live) levels[i] = 0;
     const bar = Math.max(2, levels[i] * (height - 4));
     context.fillRect(i * step, height - bar, Math.max(1, step - 2), bar);
    }
   } else {
    if (live) analyser.getByteTimeDomainData(wave);
    context.beginPath();
    for (let i = 0; i < wave.length; i++) {
     const x = i / (wave.length - 1) * width, y = live ? height / 2 + (wave[i] - 128) / 128 * height * .46 : height / 2;
     if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.stroke();
   }
  }
  function tick() { draw(); frame = requestAnimationFrame(tick); }
  function update() { cancelAnimationFrame(frame); draw(); if (active && visible && !document.hidden && !motion.matches) frame = requestAnimationFrame(tick); }
  function resize() { width = canvas.clientWidth; height = canvas.clientHeight; const dpr = Math.min(devicePixelRatio || 1, 2); canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); context!.setTransform(dpr, 0, 0, dpr, 0, 0); colors(); update(); }
  const size = new ResizeObserver(resize); size.observe(canvas);
  const intersection = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; update(); }); intersection.observe(canvas);
  const theme = new MutationObserver(() => { colors(); update(); }); theme.observe(document.documentElement, {attributes:true, attributeFilter:['data-theme']});
  colors();
  const unsubscribe = subscribePlayback(playing => { active = playing; update(); });
  document.addEventListener('visibilitychange', update); motion.addEventListener('change', update);
  return () => { unsubscribe(); cancelAnimationFrame(frame); size.disconnect(); intersection.disconnect(); theme.disconnect(); document.removeEventListener('visibilitychange', update); motion.removeEventListener('change', update); };
 });
</script>

<div role="img" aria-label={mode === 'spectrum' ? 'Live audio spectrum' : 'Live audio oscilloscope'}><canvas bind:this={canvas} aria-hidden="true"></canvas></div>

<style>div{width:100%;height:100%}canvas{display:block;width:100%;height:100%;border-radius:3px}</style>
