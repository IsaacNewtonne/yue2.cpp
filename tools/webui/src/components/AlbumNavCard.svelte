<script lang="ts">
 import {Disc3,ChevronRight} from '@lucide/svelte';
 import {albumSongs} from '../lib/album-db.js';
 import {app} from '../lib/state.svelte.js';
 import type {Album} from '../lib/album-types.js';
 let {album,active=false,onselect}:{album:Album;active?:boolean;onselect:()=>void}=$props();
 let cover=$derived(album.cover??albumSongs(album,app.songs).find(s=>s.artwork)?.artwork),url=$state('');
 $effect(()=>{if(!cover){url='';return;}const next=URL.createObjectURL(cover);url=next;return()=>URL.revokeObjectURL(next);});
</script>
<button class="album-card" class:active aria-current={active?'page':undefined} aria-label={`Open album ${album.title}`} onclick={onselect}>
 <span class="cover">{#if url}<img src={url} alt=""/>{:else}<Disc3 size={26}/>{/if}</span>
 <span class="copy"><strong>{album.title}</strong><small>{album.tracks.length} track{album.tracks.length===1?'':'s'}{album.status==='running'?' · In progress':''}</small></span><ChevronRight size={14}/>
</button>
<style>
 .album-card{display:flex;align-items:center;gap:.6rem;width:100%;padding:.65rem;margin:.45rem 0;border:1px solid #ffffff20;border-radius:15px;background:#ffffff08;color:inherit;text-align:left;cursor:pointer;transition:background .18s,border-color .18s,transform .18s}.album-card:hover{background:#ffffff16;border-color:var(--accent);transform:translateX(2px)}.album-card.active{background:color-mix(in srgb,var(--accent) 20%,transparent);border-color:var(--accent)}.album-card:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.cover{width:48px;height:48px;display:grid;place-items:center;flex-shrink:0;border-radius:10px;overflow:hidden;background:linear-gradient(140deg,var(--accent),#7052ac);color:white}img{width:100%;height:100%;object-fit:cover}.copy{min-width:0;flex:1}strong{display:block;font-size:.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}small{display:block;font-size:.75rem;opacity:.75;margin-top:.2rem}@media(prefers-reduced-motion:reduce){.album-card{transition:none}.album-card:hover{transform:none}}
</style>
