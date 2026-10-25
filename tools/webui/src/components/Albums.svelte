<script lang="ts">
 import {albumControl} from '../lib/album-control.svelte.js';
 import {onMount} from 'svelte';
 import {app,toast} from '../lib/state.svelte.js';
 import {listAlbums,saveAlbum,albumSongs,sendSongToAlbum} from '../lib/album-db.js';
 import {trackFromLyrics} from '../lib/album-plan.js';
 import {runAlbum} from '../lib/album-runner.js';
 import {withStudioLock} from '../lib/coordination.js';
 import {modelRequest, readPromptMode} from '../lib/prompt-clean.ts';
 import {buildSparse} from '../lib/fields.js';
 // The album keeps the Create page's sound and voice plan in the prompt mode
 // chosen there (clean tag line by default, legacy for A/B comparison).
 function albumBase(){const request=buildSparse($state.snapshot(app.request));const producer=$state.snapshot(app.producer);return modelRequest(request,{mode:readPromptMode(),planning:producer.enabled,producer,rawStyle:request.style});}
 import {getAllSongs,updateSong} from '../lib/db.js';
 import {createZip,exportLibrary} from '../lib/backup.js';
 import SongList from './SongList.svelte';
 import type {Album} from '../lib/album-types.js';
 let {selectedId=$bindable('')}:{selectedId?:string}=$props();
 let albums=$state<Album[]>([]),title=$state(''),step=$state(0),query=$state(''),lyricTitle=$state(''),lyrics=$state('');
 let editingId=$state(''),working=$state(false),files=$state<HTMLInputElement>();
 let album=$derived(albums.find(a=>a.id===selectedId));
 let busy=$derived(!!albumControl.active||working);
 let steps=['Create album','Add saved songs','Add lyrics','Arrange','Generate'];
 let library=$derived(app.songs.filter(s=>s.name.toLowerCase().includes(query.toLowerCase())));
 let savedSongs=$derived(album?albumSongs(album,app.songs):[]);
 $effect(()=>{selectedId;step=0;editingId='';lyrics='';lyricTitle='';});
 async function refresh(){albums=await listAlbums();}
 onMount(()=>{const changed=()=>{void refresh().catch(e=>toast(String(e)));};changed();window.addEventListener('yue2-albums-changed',changed);return()=>window.removeEventListener('yue2-albums-changed',changed);});
 async function operation(work:()=>Promise<void>){if(busy)return;working=true;try{const result=await withStudioLock(work);if(!result.acquired)toast('Another Studio operation is running. Please try again when it finishes.');await refresh();return result.acquired;}catch(e){toast(String(e));return false;}finally{working=false;}}
 async function change(update:(a:Album)=>void){const id=selectedId;return await operation(async()=>{const a=(await listAlbums()).find(a=>a.id===id);if(!a)throw new Error('Album is unavailable.');update(a);await saveAlbum(a);});}
 async function create(){await operation(async()=>{const name=title.trim();if(!name)throw new Error('Give your album a name.');if((await listAlbums()).some(a=>a.title.toLowerCase()===name.toLowerCase()))throw new Error('That album name already exists.');
 const a:Album={id:crypto.randomUUID(),version:1,title:name,created:Date.now(),updated:Date.now(),request:albumBase(),visualStyle:'Cinematic urban illustration, warm neon, rich texture',artwork:true,video:true,seed:crypto.getRandomValues(new Uint32Array(1))[0]%2147483647,tracks:[],status:'draft',stage:'Ready to arrange'};
 await saveAlbum(a);selectedId=a.id;title='';});}
 async function addSong(id:number){await operation(async()=>{await sendSongToAlbum(id,selectedId,'');});}
 async function addLyrics(){const name=lyricTitle.trim(),text=lyrics.trim();if(!name||!text){toast('Enter a track title and lyrics.');return;}
 const id=editingId;
 const saved=await change(a=>{if(id){const t=a.tracks.find(t=>t.id===id);if(!t||t.songId||t.jobId)throw new Error('This track has already started generation.');t.title=name;t.lyrics=text;}else{if(a.tracks.length>=30)throw new Error('Albums support up to 30 tracks.');a.tracks.push({...trackFromLyrics('track.txt',text),title:name});}a.status='draft';a.stage='Ready to generate';});
 if(saved){editingId='';lyricTitle='';lyrics='';toast(id?'Lyrics updated.':'Lyric track added.');}
 }
 async function importLyrics(event:Event){const input=event.currentTarget as HTMLInputElement;const chosen=[...(input.files??[])];input.value='';if(!chosen.length)return;
 try{if(chosen.length>30)throw new Error('Choose up to 30 lyric files.');const tracks=await Promise.all(chosen.map(async f=>trackFromLyrics(f.name,await f.text())));await change(a=>{if(a.tracks.length+tracks.length>30)throw new Error('Albums support up to 30 tracks.');a.tracks.push(...tracks);a.status='draft';a.stage='Ready to generate';});}catch(e){toast(String(e));}}
 async function move(id:string,offset:number){await change(a=>{const i=a.tracks.findIndex(t=>t.id===id),j=i+offset;if(i<0||j<0||j>=a.tracks.length)return;[a.tracks[i],a.tracks[j]]=[a.tracks[j],a.tracks[i]];});}
 function textValue(e:Event){return (e.currentTarget as HTMLInputElement).value;}
 async function start(album:Album){if(busy)return;albumControl.active=album.id;albumControl.pause=false;try{const result=await withStudioLock(async()=>{const latest=(await listAlbums()).find(a=>a.id===album.id);if(!latest||!latest.tracks.length)throw new Error('Add a song or lyric track first.');await runAlbum(latest,()=>albumControl.pause,()=>{void refresh();});});if(!result.acquired)toast('Another Studio operation is running.');app.songs=(await getAllSongs()).reverse();}catch(e){toast(String(e));}finally{albumControl.active='';try{app.songs=(await getAllSongs()).reverse();await refresh();}catch(e){toast(String(e));}}}
 async function retry(album:Album,index:number,stage:'audio'|'artwork'|'video'){if(busy)return;const id=album.tracks[index].id;const saved=await operation(async()=>{const copy=(await listAlbums()).find(a=>a.id===album.id);if(!copy)throw new Error('Album is unavailable.');const track=copy.tracks.find(t=>t.id===id);if(!track)throw new Error('Track is unavailable.');if(stage==='audio'&&!track.songId)track.jobId=undefined;if(stage==='artwork'){track.artJobId=undefined;track.artDone=false;track.videoDone=false;if(track.songId)await updateSong(track.songId,{artworkJobId:undefined});if(!copy.cover)copy.coverJobId=undefined;}if(stage==='video'){track.videoJobId=undefined;track.videoDone=false;}await saveAlbum(copy);});if(saved)await start(album);}
 async function download(album:Album){try{const songs=albumSongs(album,await getAllSongs());const snapshot=$state.snapshot(album);const {cover,...plan}=snapshot;const entries=[{name:'album.json',blob:new Blob([JSON.stringify(plan,null,2)],{type:'application/json'})},{name:'library-backup.zip',blob:await exportLibrary(songs,[$state.snapshot(album)])}];if(cover)entries.push({name:'master-cover.png',blob:cover});for(const [index,song] of songs.entries()){const stem=String(index+1).padStart(2,'0')+'-'+song.name.replace(/[\\/:*?"<>|]/g,'');entries.push({name:stem+'.'+(song.audio.type.includes('mpeg')?'mp3':'wav'),blob:song.audio});if(song.video)entries.push({name:stem+'.mp4',blob:song.video});}
  const url=URL.createObjectURL(await createZip(entries)),a=document.createElement('a');a.href=url;a.download=album.title.replace(/[\\/:*?"<>|]/g,'')+'.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
 }catch(e){toast(String(e));}}

</script>
<section id="albums" class="albums">
 <header class="album-heading"><div><p class="eyebrow">YOUR ALBUM STUDIO</p><h1>{album?.title??'Albums'}</h1><p>Bring saved songs and new ideas together into one release.</p></div>{#if selectedId}<button onclick={()=>selectedId=''}>All albums</button>{/if}</header>
 {#if !album}
 <section class="panel"><h2>Create an album</h2><p>Give it a name, choose saved songs or add lyrics, then arrange and generate.</p><label>Album name<input bind:value={title} maxlength="150" placeholder="Name your next release" disabled={busy}/></label><button class="primary" disabled={busy||!title.trim()} onclick={create}>Create album</button></section>
 <div class="album-grid">{#each albums as item (item.id)}<button class="album-tile" onclick={()=>selectedId=item.id}><span class="disc">◎</span><strong>{item.title}</strong><span>{item.tracks.length} tracks · {item.status}</span></button>{/each}</div>
 {:else}
 <nav class="steps" aria-label="Album creation steps">{#each steps as label,i}<button class:active={step===i} aria-current={step===i?'step':undefined} onclick={()=>step=i}><span>{i+1}</span>{label}</button>{/each}</nav>
 <section class="panel">
 <div class="section-heading"><h2>{step+1}. {steps[step]}</h2><span class="badge">{album.tracks.length} / 30 tracks</span></div>
 {#if step===0}
 <p>Your album is saved on this device. Changes to the fields below save when you leave each field.</p>
 <label>Album name<input value={album.title} maxlength="150" disabled={busy} onchange={e=>{const v=textValue(e).trim();if(v)void change(a=>{a.title=v;});else{e.currentTarget.value=album!.title;toast('Album name cannot be empty.');}}}/></label>
 <label>Shared artwork direction<textarea rows="3" value={album.visualStyle} disabled={busy} onchange={e=>{const v=textValue(e);void change(a=>{a.visualStyle=v;});}}></textarea></label>
 <p>Start with saved songs, new lyrics, or a mixture of both.</p>
 {:else if step===1}
 <p>Add songs from your Library to the album playlist. Saved audio and artwork stay intact.</p>
 <label>Find a saved song<input type="search" bind:value={query} placeholder="Search your Library"/></label>
 <div class="song-picker">{#each library as song (song.id)}
 {@const added=album.tracks.some(t=>t.songId===song.id||!!song.libraryKey&&t.libraryKey===song.libraryKey)}
 <div class="track-row"><div><strong>{song.name}</strong><small>{added?'Already in this album':'Saved Library track'}</small></div><button disabled={busy||added||album.tracks.length>=30} onclick={()=>addSong(song.id!)}>{added?'Added ✓':'Add to album'}</button></div>
 {:else}<p>{query?'No songs match your search.':'Your Library is empty. Add new lyric tracks in the next step.'}</p>{/each}</div>
 {:else if step===2}
 <p>Add one lyric sheet per new track. Use section labels such as [Verse] and [Chorus].</p>
 <div class="actions"><button disabled={busy} onclick={()=>files?.click()}>Import lyric files (.txt / .md)</button><button onclick={()=>{editingId='';lyricTitle='';lyrics='';}}>New lyric track</button></div>
 <input hidden type="file" accept=".txt,.md" multiple bind:this={files} onchange={importLyrics}/>
 <label>Track title<input bind:value={lyricTitle} maxlength="150" placeholder="New track title" disabled={busy}/></label>
 <label>Lyrics<textarea rows="10" bind:value={lyrics} maxlength="100000" placeholder="[Verse 1]" disabled={busy}></textarea></label>
 <button class="primary" disabled={busy||!lyricTitle.trim()||!lyrics.trim()} onclick={addLyrics}>{editingId?'Save lyric changes':'Add lyric track'}</button>
 {#each album.tracks.filter(t=>!t.linked) as track (track.id)}<div class="track-row"><div><strong>{track.title}</strong><small>{track.songId||track.jobId?'Generation started · lyrics locked':'Lyrics ready'}</small></div><button disabled={busy||!!track.songId||!!track.jobId} onclick={()=>{editingId=track.id;lyricTitle=track.title;lyrics=track.lyrics;}}>Edit lyrics</button></div>{/each}
 {:else if step===3}
 <p>Set the running order and sound direction for new tracks. Removing a track here keeps its saved song in Library.</p>
 <label>Sound and voice direction<textarea rows="6" value={album.request.style} disabled={busy} onchange={e=>{const v=textValue(e);void change(a=>{a.request.style=v;});}}></textarea></label>
 <button disabled={busy} onclick={()=>change(a=>{a.request=albumBase();})}>Use current Create sound &amp; voice plan</button>
 <ol class="track-order">{#each album.tracks as track,i (track.id)}<li><div class="track-row"><div><strong>{i+1}. {track.title}</strong><small>{track.linked?'From Library':track.songId?'Audio saved':'Generate from lyrics'}</small></div><div class="actions"><button aria-label={'Move '+track.title+' up'} disabled={busy||i===0} onclick={()=>move(track.id,-1)}>↑</button><button aria-label={'Move '+track.title+' down'} disabled={busy||i===album!.tracks.length-1} onclick={()=>move(track.id,1)}>↓</button><button disabled={busy} onclick={()=>change(a=>{a.tracks=a.tracks.filter(t=>t.id!==track.id);})}>Remove</button></div></div></li>{:else}<p>Add saved songs or lyrics to build the running order.</p>{/each}</ol>
 {:else}
 <p>{album.tracks.filter(t=>t.linked).length} saved songs · {album.tracks.filter(t=>!t.linked&&!t.songId).length} new tracks to generate. New audio is saved as MP3.</p>
 <label class="check"><input type="checkbox" checked={album.artwork} disabled={busy} onchange={e=>{const v=e.currentTarget.checked;void change(a=>{a.artwork=v;});}}/>Generate a shared cover and artwork for new tracks</label>
 <label class="check"><input type="checkbox" checked={album.video} disabled={busy} onchange={e=>{const v=e.currentTarget.checked;void change(a=>{a.video=v;});}}/>Export new tracks as MP4 (includes artwork)</label>
 <p class="status" role="status">{album.stage} · {album.tracks.filter(t=>t.songId).length} / {album.tracks.length} audio tracks saved</p>
 {#if album.error}<p role="alert">{album.error}</p>{/if}
 <div class="actions"><button class="primary" disabled={busy||!album.tracks.length} onclick={()=>start(album!)}>{album.status==='paused'?'Resume album':'Generate album'}</button><button disabled={busy||!savedSongs.length} onclick={()=>download(album!)}>Export album ZIP</button></div>
 {#if albumControl.active===album.id}<button disabled={albumControl.pause} onclick={()=>{albumControl.pause=true;toast('Album will pause after the current stage is safely saved.');}}>Pause after current stage</button>{/if}
 {#each album.tracks as track,index (track.id)}<div class="track-row"><div><strong>{index+1}. {track.title}</strong><small>{track.linked?'From Library':track.songId?'Audio saved':'Audio pending'}{!track.linked&&(album.artwork||album.video)?' · Artwork '+(track.artDone?'saved':'pending'):''}{!track.linked&&album.video?' · Video '+(track.videoDone?'saved':'pending'):''}</small></div>
 {#if album.error&&!track.linked}<div class="actions"><button disabled={busy||!!track.songId} onclick={()=>retry(album!,index,'audio')}>Retry audio</button><button disabled={busy} onclick={()=>retry(album!,index,'artwork')}>Retry artwork</button><button disabled={busy} onclick={()=>retry(album!,index,'video')}>Retry video</button></div>{/if}</div>{/each}
 {/if}
 <footer><button disabled={step===0} onclick={()=>step--}>Back</button><span>Step {step+1} of 5</span>{#if step<4}<button class="primary" onclick={()=>step++}>Next: {steps[step+1]}</button>{/if}</footer>
 </section>
 {#if step===4&&savedSongs.length}<SongList showLog={false} songIds={savedSongs.map(s=>s.id!)}/>{/if}
 {/if}
</section>
<style>
 .albums{display:grid;gap:1.2rem;color:var(--fg);padding-bottom:2rem}
 .album-heading,.panel{padding:1.4rem;border:1px solid var(--border-strong);border-radius:22px;background:var(--bg-card);box-shadow:var(--shadow)}
 .album-heading,.section-heading,.track-row,footer{display:flex;align-items:center;justify-content:space-between;gap:1rem}
 .album-heading{background:linear-gradient(120deg,color-mix(in srgb,var(--accent) 12%,var(--bg-card)),var(--bg-card))}
 h1,h2,strong,label{color:var(--fg)}h1{font-size:1.9rem}h2{font-size:1.2rem}.eyebrow{font-size:.75rem;letter-spacing:.15em;margin-bottom:.5rem}
 p,small,footer>span,.album-tile>span{color:var(--fg-dim);line-height:1.6}p{margin:.35rem 0}.panel{display:grid;gap:1rem}
 label{display:grid;gap:.45rem;font-weight:600;font-size:.9rem}
 input,textarea,button{font:inherit;color:var(--fg);background:var(--bg-input);border:1px solid var(--border-strong);border-radius:12px;padding:.75rem}
 input,textarea{width:100%}textarea{resize:vertical;line-height:1.6}
 button{cursor:pointer;transition:background .18s,transform .18s,border-color .18s}button:hover:not(:disabled){background:var(--bg-btn-hover);border-color:var(--accent);transform:translateY(-1px)}button:disabled{opacity:.5;cursor:default}
 button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid var(--focus);outline-offset:3px}
 .primary{background:var(--accent);color:var(--bg);font-weight:700}
 .steps{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:.5rem}.steps button{display:grid;justify-items:center;gap:.5rem;font-size:.8rem;background:var(--bg-card)}
 .steps button>span{display:grid;place-items:center;width:2rem;height:2rem;border-radius:50%;background:var(--bg-btn);font-weight:800}
 .steps button.active{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 15%,var(--bg-card));box-shadow:0 3px 14px color-mix(in srgb,var(--accent) 15%,transparent)}
 .steps button.active>span{background:var(--accent);color:var(--bg)}.actions{display:flex;gap:.5rem;flex-wrap:wrap}
 .track-row{padding:.9rem;border:1px solid var(--border);border-radius:14px;background:var(--bg-card-2)}small{display:block;font-size:.75rem}strong{overflow-wrap:anywhere}
 .song-picker,.track-order{display:grid;gap:.6rem;max-height:460px;overflow:auto;padding:0;list-style:none}
 .badge{font-size:.75rem;white-space:nowrap;color:var(--fg-dim)}.check{display:flex;align-items:center;gap:.7rem}.check input{width:1.1rem;height:1.1rem;accent-color:var(--accent);flex-shrink:0}
 footer{border-top:1px solid var(--border);padding-top:1rem;margin-top:.5rem;font-size:.8rem}.status{padding:.8rem;border-left:3px solid var(--accent);background:var(--bg-card-2)}
 .album-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:1rem}.album-tile{display:grid;text-align:left;gap:.4rem;padding:1.2rem;background:var(--bg-card)}.disc{font-size:2rem;color:var(--accent)!important}
 :global(html[data-theme='studio']) .albums{--fg:#17213f;--fg-dim:#526384}
 @media(max-width:700px){.steps{grid-template-columns:repeat(3,minmax(0,1fr))}.album-heading,.track-row{align-items:flex-start;flex-wrap:wrap}.panel{padding:1rem}footer{flex-wrap:wrap}}
 @media(prefers-reduced-motion:reduce){button{transition:none}button:hover:not(:disabled){transform:none}}
</style>
