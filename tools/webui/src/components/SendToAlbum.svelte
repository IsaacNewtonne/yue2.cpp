<script lang="ts">
 import {onMount} from 'svelte';
 import Dialog from './Dialog.svelte';
 import {listAlbums,sendSongToAlbum} from '../lib/album-db.js';
 import {withStudioLock} from '../lib/coordination.js';
 import {toast} from '../lib/state.svelte.js';
 import type {Album} from '../lib/album-types.js';
 import type {Song} from '../lib/types.js';
 let {song,onclose}:{song:Song;onclose:()=>void}=$props();
 let open=$state(true),albums=$state<Album[]>([]),albumId=$state(''),name=$state(''),busy=$state(false),loading=$state(true),error=$state('');
 const contains=(album:Album)=>album.tracks.some(t=>t.songId===song.id||(song.libraryKey&&t.libraryKey===song.libraryKey));
 onMount(()=>{void refreshAlbums();});
 async function refreshAlbums(){try{albums=await listAlbums();albumId=albums.find(a=>!contains(a)&&a.tracks.length<30)?.id??'';}catch(e){error=String(e);}finally{loading=false;}}
 $effect(()=>{if(!open)onclose();});
 async function send(){if(song.id==null||busy)return;busy=true;error='';try{const result=await withStudioLock(async()=>{const album=await sendSongToAlbum(song.id!,albumId,name);toast(`“${song.name}” added to ${album.title}.`,5000,true);open=false;});if(!result.acquired)error='Another Studio operation is running. Try again when it finishes.';}catch(e){error=e instanceof Error?e.message:String(e);}finally{busy=false;}}
</script>
<Dialog bind:open title="Send to album">
 {#snippet body()}
 <p class="song-name">{song.name}</p><p>Choose an album or create one. The song stays in your library.</p>
 <label>Album<select bind:value={albumId} disabled={loading||busy}>
 <option value="">Create a new album…</option>
 {#each albums as album}<option value={album.id} disabled={contains(album)||album.tracks.length>=30}>{album.title}{contains(album)?' — already added':` — ${album.tracks.length} tracks`}</option>{/each}
 </select></label>
 {#if !albumId}<label>New album name<input bind:value={name} maxlength="150" placeholder="Give your album a name" disabled={busy}/></label>{/if}
 {#if loading}<p role="status">Loading albums…</p>{/if}{#if error}<p role="alert">{error}</p>{/if}
 {/snippet}
 {#snippet actions(close)}<button disabled={busy} onclick={close}>Cancel</button><button class="send" disabled={loading||busy||(!albumId&&!name.trim())} aria-busy={busy} onclick={send}>{busy?'Adding song…':albumId?'Add to album':'Create album & add song'}</button>{/snippet}
</Dialog>
<style>
 p{color:var(--fg-dim);line-height:1.5}.song-name{font-weight:700;color:var(--fg)}label{display:grid;gap:.4rem;margin:.8rem 0}input,select,button{font:inherit;color:var(--fg);background:var(--bg-input);border:1px solid var(--border-strong);border-radius:10px;padding:.7rem;max-width:100%}button{cursor:pointer}.send{background:var(--accent);color:var(--bg);font-weight:700}button:disabled{opacity:.55;cursor:default}[role='alert']{color:var(--fg)}
</style>
