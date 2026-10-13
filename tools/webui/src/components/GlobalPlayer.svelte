<script lang="ts">
 import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX } from '@lucide/svelte';
 import CassetteCarousel from './CassetteCarousel.svelte';
 import ReactiveSpeaker from './ReactiveSpeaker.svelte';
 import { app } from '../lib/state.svelte.js';
 import { player, resume, pause, seek, toggleTrack, selectTrack, setVolume } from '../lib/player.svelte.js';
 let lastVolume = .5;
 $effect(() => { setVolume(app.volume); });
 function mute() { if (app.volume > 0) { lastVolume = app.volume; app.volume = 0; } else app.volume = lastVolume; }
 function play() { if (player.playing || player.loading) pause(); else if (player.song) void resume(); else if (app.songs[0]) toggleTrack(app.songs[0]); }
 function skip(direction: number) {
  if (!app.songs.length) return;
  const index = app.songs.findIndex(song => song.id === player.song?.id);
  selectTrack(app.songs[(index + direction + app.songs.length) % app.songs.length]); seek(0); void resume();
 }
 function format(value: number) { const seconds = Math.floor(value || 0); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,'0')}`; }
</script>

<section class="global-player" aria-label="Global music player">
 <div class="speaker-side"><ReactiveSpeaker compact /><input class="vertical-volume" type="range" min="0" max="1" step="0.01" bind:value={app.volume} aria-label="Playback volume left" title="Master volume" /></div>
 <div class="transport">
  <CassetteCarousel />
   <span class="now-playing" role="status" title={player.error || player.song?.name || ''}>{player.error || (player.loading ? 'Loading…' : player.song?.name || 'Choose a track')}</span>
  <div class="transport-top">
   <div class="transport-buttons">
    <button onclick={() => skip(-1)} disabled={!app.songs.length} aria-label="Previous track"><SkipBack size={14}/></button>
    <button class="main-play" onclick={play} disabled={!player.song && !app.songs.length} aria-label={player.playing || player.loading ? 'Pause playback' : 'Play playback'}>{#if player.playing || player.loading}<Pause size={15}/>{:else}<Play size={15}/>{/if}</button>
    <button onclick={() => skip(1)} disabled={!app.songs.length} aria-label="Next track"><SkipForward size={14}/></button>
   </div>
   <button onclick={mute} aria-label={app.volume ? 'Mute playback' : 'Unmute playback'}>{#if app.volume}<Volume2 size={14}/>{:else}<VolumeX size={14}/>{/if}</button>
  </div>
  <div class="seek-row"><span>{format(player.time)}</span><input type="range" min="0" max={player.duration || 1} step="0.1" value={player.time} oninput={event => seek(Number(event.currentTarget.value))} disabled={!player.duration} aria-label="Playback position"/><span>{format(player.duration)}</span></div>
 </div>
 <div class="speaker-side"><input class="vertical-volume" type="range" min="0" max="1" step="0.01" bind:value={app.volume} aria-label="Playback volume right" title="Master volume"/><ReactiveSpeaker compact /></div>
</section>

<style>
 .global-player{display:flex;align-items:center;gap:10px;flex:0 1 540px;min-width:300px;color:var(--fg)}
 .speaker-side :global(.speaker-cabinet.compact){width:46px;height:80px;padding:6px 4px}
 .speaker-side :global(.compact .woofer){transform:scale(1.3)}
 .speaker-side :global(.compact .tweeter){transform:scale(1.3)}
 .speaker-side{display:flex;align-items:center;gap:5px;flex:none}
 .vertical-volume{writing-mode:vertical-lr;direction:rtl;width:12px;height:66px;min-width:0;accent-color:var(--accent);padding:0;margin:0;cursor:pointer}
 .transport{flex:1;min-width:0;display:grid;gap:3px}
 .transport-top{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;min-width:0}.transport-top > button{justify-self:end}
 .transport-buttons{grid-column:2;display:flex;align-items:center;gap:6px}
 button{display:grid;place-items:center;width:24px;height:24px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--fg);cursor:pointer;flex:none;transition:background-color 180ms ease,color 180ms ease}
 button:hover{background:var(--bg-btn-hover)}button:disabled{opacity:.35;cursor:default}
 .main-play{background:var(--accent);color:var(--bg);width:28px;height:28px}
 .now-playing{display:block;text-align:center;line-height:14px;width:100%;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
 .seek-row{width:100%;max-width:340px;justify-self:center;display:flex;align-items:center;gap:6px;font:9px ui-monospace,monospace;color:var(--fg-dim)}
 .seek-row input{flex:1;width:0;min-width:0;height:10px;accent-color:var(--accent);margin:0;cursor:pointer}
 @media(max-width:680px){.global-player{min-width:0;width:100%;flex:1;gap:8px}.now-playing{font-size:10px}}
</style>
