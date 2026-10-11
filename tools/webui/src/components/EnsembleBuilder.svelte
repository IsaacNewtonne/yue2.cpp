<script lang="ts">
 import {onMount} from 'svelte';
 import {app,toast} from '../lib/state.svelte.js';
 import {getAllSongs} from '../lib/db.js';
 import {withStudioLock} from '../lib/coordination.js';
 import {loadEnsemble,saveEnsemble,clearEnsemble,runEnsemble,mixEnsemble,saveEnsembleSong,validateOrder,type EnsembleProject} from '../lib/ensemble.ts';
 let {disabled=false}:{disabled?:boolean}=$props();
 let project=$state.raw<EnsembleProject>();let busy=$state(false);let ready=$state(false);let error=$state('');
 let lyrics=$state('');let seconds=$state(20);let title=$state('Voice ensemble');let order=$state('1,2,3,2');
 let controller=$state<AbortController>();let preview=$state('');
 const complete=$derived(!!project?.takes.every(t=>t.vocals&&t.backing));
 onMount(()=>{let mounted=true;loadEnsemble().then(p=>{if(mounted){project=p;if(p)order=p.order.map(i=>i+1).join(',');ready=true;}}).catch(e=>{if(mounted)error=String(e);});return()=>{mounted=false;controller?.abort();};});
 $effect(()=>{const blob=project?.output;if(!blob){preview='';return;}const url=URL.createObjectURL(blob);preview=url;return()=>URL.revokeObjectURL(url);});
 async function locked(work:()=>Promise<void>){
  error='';busy=true;
  try{const result=await withStudioLock(work);if(!result.acquired)throw new Error('Another Studio operation is running. Try again after it finishes.');}
  catch(e){error=e instanceof Error?e.message:String(e);}
  finally{busy=false;controller=undefined;}
 }
 function publish(p:EnsembleProject){project={...p,takes:p.takes.map(t=>({...t}))};}
 async function generate(){await locked(async()=>{
  if(!project){
   if(app.producer.voices<2)throw new Error('Choose at least two voice profiles above.');
   if(!lyrics.trim())throw new Error('Enter a short lyric passage for the ensemble.');
   if(!Number.isFinite(seconds)||seconds<10||seconds>30)throw new Error('Choose a section length between 10 and 30 seconds.');
   const profiles=$state.snapshot(app.producer.voiceProfiles).slice(0,app.producer.voices);
   const newProject:EnsembleProject={id:crypto.randomUUID().replaceAll('-',''),name:title.trim()||'Voice ensemble',lyrics:lyrics.trim(),seconds,bpm:app.producer.bpm,style:app.request.style.replace(/(?:^|\n\n)Song direction:\n[\s\S]*$/,'').trim(),order:validateOrder(order,profiles.length),takes:profiles.map(profile=>({profile,seed:crypto.getRandomValues(new Uint32Array(1))[0],lmSeed:crypto.getRandomValues(new Uint32Array(1))[0]})),stage:'Preparing'};
   await saveEnsemble(newProject);publish(newProject);
  }
  const p=structuredClone(project!);controller=new AbortController();await runEnsemble(p,controller.signal,publish);publish(p);
 });}
 async function mix(){await locked(async()=>{const p=structuredClone(project!);p.order=validateOrder(order,p.takes.length);await mixEnsemble(p);publish(p);});}
 async function save(){await locked(async()=>{const p=structuredClone(project!);await saveEnsembleSong(p);publish(p);app.songs=(await getAllSongs()).reverse();toast('Ensemble saved to Library.',4000,true);});}
 async function startNew(){await locked(async()=>{
  if(project&&!project.saved){
   const response=await fetch('jobs');if(!response.ok)throw new Error('Cannot check active jobs');
   const active=await response.json(),owned=new Set(project.takes.flatMap(t=>[t.job,t.stemJob]));
   if(active.some((j:{id:string})=>owned.has(j.id)))throw new Error('Wait for the current ensemble job to finish before discarding its draft.');
   if(!confirm('Discard this unfinished ensemble draft and its local takes? Saved Library tracks are kept.'))return;
  }
  await clearEnsemble();project=undefined;
 });}
</script>

<details class="ensemble-builder">
 <summary>Separate vocal takes · shared backing</summary>
 <p>Build the tested ensemble: each selected voice performs the same short passage against one score. Voice 1 supplies the backing. Arrange the takes in any order; repeated voices reuse the exact performance.</p>
 <p>This makes a new ensemble track. It does not replace vocals in an existing song or automatically align different verses.</p>
 <fieldset disabled={disabled||busy||!ready}>
  {#if !project}
   <label>Ensemble title<input aria-label="Ensemble title" bind:value={title} maxlength="160"/></label>
   <label>Passage lyrics<textarea aria-label="Ensemble passage lyrics" bind:value={lyrics} maxlength="2000" rows="5" placeholder="[Hook]&#10;Enter 4–8 short lines for all voices to perform."></textarea></label>
   <label>Seconds per take<input aria-label="Ensemble section seconds" type="number" min="10" max="30" step="1" bind:value={seconds}/></label>
   <p>Uses the {app.producer.voices} selected voice profiles and current sound direction. Separate runs take longer than one generation.</p>
  {:else}
   <strong>{project.name}</strong><p>{project.stage}</p>
   <ol>{#each project.takes as take,i}<li>Voice {i+1}: {take.profile}<small>{take.vocals?'Vocals ready':take.mix?'Generated; separation pending':'Generation pending'}</small></li>{/each}</ol>
   <details><summary>Saved passage</summary><pre>{project.lyrics}</pre></details>
  {/if}
  <label>Voice order<input aria-label="Ensemble voice order" bind:value={order} placeholder="1,2,3,2"/></label>
  <p>For example, 1,2,3,2 returns to Voice 2 for the final hook. Each entry plays one full passage.</p>
  <div class="actions">
   {#if !complete}<button type="button" onclick={generate}>{project?'Resume ensemble':'Generate separate vocal takes'}</button>{/if}
   {#if complete}<button type="button" onclick={mix}>Mix shared backing preview</button>{/if}
   {#if project?.output}<button type="button" onclick={save} disabled={project.saved}>{project.saved?'Saved to Library':'Save ensemble to Library'}</button>{/if}
   {#if project}<button type="button" onclick={startNew}>{project.saved?'New ensemble':'Discard ensemble draft'}</button>{/if}
  </div>
 </fieldset>
 {#if busy}<p role="status">{project?.stage||'Preparing ensemble…'}</p><button type="button" onclick={()=>controller?.abort()} disabled={!controller}>Pause after current server job</button><p>Pausing stops this workflow; the active server job can finish. Resume retrieves it without generating it again.</p>{/if}
 {#if error}<p role="alert">{error}</p>{/if}
 {#if preview}<audio controls src={preview} aria-label="Shared backing ensemble preview"></audio><a href={preview} download={`${project?.name||'ensemble'}.wav`}>Download ensemble WAV</a>{/if}
 <p>Progress and completed takes are saved in this browser. Resume after a reload. Listen before saving: a shared score guides musical fit but does not force exact phrasing.</p>
</details>

<style>
 .ensemble-builder{margin-top:1rem;padding:1rem;border:1px solid var(--accent);border-radius:12px;background:var(--bg-input)}
 summary{cursor:pointer;font-weight:650;color:var(--fg)}p,small{font-size:.75rem;line-height:1.5;color:var(--fg-dim)}
 fieldset{border:0;padding:0;display:grid;gap:.7rem;min-width:0}label{font-size:.8rem;color:var(--fg)}input,textarea{display:block;width:100%;box-sizing:border-box;padding:.6rem;margin-top:.3rem;background:var(--bg-card);color:var(--fg);border:1px solid var(--border);border-radius:7px}
 .actions{display:flex;gap:.5rem;flex-wrap:wrap}button{padding:.65rem;border-radius:7px;background:var(--bg-btn);color:var(--fg);border:1px solid var(--border);cursor:pointer}button:disabled{opacity:.5;cursor:default}small{display:block}li{margin-bottom:.5rem;font-size:.8rem}audio{display:block;width:100%;margin:1rem 0}a{color:var(--accent)}pre{white-space:pre-wrap;font-size:.75rem} [role=alert]{color:var(--accent)}
</style>
