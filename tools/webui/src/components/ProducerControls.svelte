<script lang="ts">
 import { arrangementPresets, arrangementGroups } from '../lib/arrangement-presets.js';
 import { lyricSections, structureWarnings, addFinalChorus } from '../lib/song-structure.ts';
 import { app } from '../lib/state.svelte.js';
 import EnsembleBuilder from './EnsembleBuilder.svelte';
 import { delivery, songPlan, lyricWarnings, voiceAssignments } from '../lib/producer.js';
 import { sectionKind, SECTION_KIND_NAMES } from '../lib/prompt-clean.ts';
 import { quality } from '../lib/quality.svelte.ts';
 const voiceOf = (label: string) => Math.min(4, Number(/\bVoice\s+(\d+)/i.exec(label)?.[1] || 1));
 let { disabled = false }: { disabled?: boolean } = $props();
 const arrangementChoice = $derived(app.producer.structure.trim() ? arrangementPresets.find(preset => preset.direction === app.producer.structure)?.id ?? 'custom' : 'auto');
 function chooseArrangement(id: string) {
  if (id === 'auto') app.producer.structure = '';
  else { const preset = arrangementPresets.find(preset => preset.id === id); if (preset) app.producer.structure = preset.direction; }
 }
 const warnings = $derived(lyricWarnings(app.producer, app.request.lyrics || ''));
 const assignments = $derived(voiceAssignments(app.producer, app.request.lyrics || ''));
 const sections = $derived(lyricSections(app.request.lyrics || ''));
 const formWarnings = $derived(app.producer.presence>0 ? structureWarnings(app.request.lyrics || '') : []);
 const canAddChorus = $derived(app.producer.presence>0 && addFinalChorus(app.request.lyrics || '') !== (app.request.lyrics || ''));
 let beforeChorusEdit = $state<string | null>(null);
 let chorusEdit = $state('');
 function repeatChorus() { beforeChorusEdit=app.request.lyrics || ''; chorusEdit=addFinalChorus(beforeChorusEdit); app.request.lyrics=chorusEdit; }
 const voiceChoices = [
  ['Warm lead', 'Warm clear mid-range lead, natural phrasing'],
  ['Bright & airy', 'Bright airy upper voice'],
  ['Low & resonant', 'Low resonant voice'],
  ['Soft & intimate', 'Soft textured voice'],
  ['Deep spoken rap', 'Deep grounded rap voice, clear rhythmic diction and measured delivery'],
  ['Fast & precise rap', 'Agile rap voice, crisp consonants and precise rapid rhythmic delivery'],
  ['Gritty & raspy', 'Gritty raspy mid-range voice, raw expressive delivery'],
  ['Smooth & soulful', 'Smooth soulful voice, fluid melodic phrasing and gentle vibrato'],
  ['Powerful & belting', 'Powerful full voice, strong projection and sustained melodic notes'],
  ['Light falsetto', 'Light floating falsetto, soft clear high notes'],
  ['Breathy & delicate', 'Breathy delicate voice, close intimate delivery'],
  ['Bright pop lead', 'Bright clear pop voice, focused tone and catchy melodic phrasing'],
  ['Rounded baritone', 'Rounded baritone voice, rich lower register and relaxed phrasing'],
  ['Clear alto', 'Clear alto voice, warm low-middle register and controlled phrasing'],
  ['Soaring tenor', 'Soaring tenor voice, bright upper-middle register and expressive phrasing'],
  ['Light soprano', 'Light soprano voice, clear upper register and flowing melodic phrasing']
 ] as const;
</script>

<section class="card producer" aria-label="Song planner and voices">
 <div class="heading"><h3>Song planner &amp; voices</h3><label><input type="checkbox" bind:checked={app.producer.enabled} disabled={disabled} /> Enable</label></div>
 {#if disabled}<p>Loaded performances and remixes keep their original direction. Enable a new composition to use this planner.</p>{/if}
 <fieldset disabled={disabled || !app.producer.enabled}>
  <section class="planner-group"><h4>1. Vocal delivery</h4>
  <label>Amount of singing <output>{app.producer.singing}%</output><input aria-label="Amount of singing" type="range" min="0" max="100" step="5" bind:value={app.producer.singing} /></label>
  <div class="scale"><span>Rap / spoken</span><span>Fully sung</span></div>
  <p>{delivery(app.producer)}</p>
  <label>Vocal presence <output>{app.producer.presence}%</output><input aria-label="Vocal presence" type="range" min="0" max="100" step="5" bind:value={app.producer.presence} /></label>
  <div class="scale"><span>Instrumental</span><span>Vocal-led</span></div>
  </section>
  <section class="planner-group"><h4>2. Voice cast</h4>
  <div class="row">
   <label>Different voices<select aria-label="Different voices" bind:value={app.producer.voices} disabled={app.producer.voiceLocked || app.producer.presence === 0}>{#each [1, 2, 3, 4] as n}<option value={n}>{n === 1 ? '1 · Solo' : `${n} · Ensemble`}</option>{/each}</select></label>
  </div>
  <label class="lock"><input type="checkbox" bind:checked={app.producer.voiceLocked} /> Lock voice profiles across songs</label>
  <p>Reuses these descriptions. YuE2 cannot guarantee the same singer or exact voice count; a seed is not a voice identity.</p>
  <div class="voice-grid">
  {#each app.producer.voiceProfiles.slice(0, app.producer.voices) as profile, i}
   <label class={`voice-${i + 1}`}><span class={`hue-chip voice-${i + 1}`}>Voice {i + 1}</span><select aria-label={`Voice ${i + 1} profile`} bind:value={app.producer.voiceProfiles[i]} disabled={app.producer.voiceLocked || app.producer.presence === 0}>
    {#if !voiceChoices.some(([, description]) => description === profile)}<option value={profile}>Saved custom voice — {profile}</option>{/if}
    {#each voiceChoices as [name, description]}<option value={description}>{name}</option>{/each}
   </select><small class="voice-description">{profile}</small></label>
  {/each}
  </div>
  {#if assignments.length}
   <div class="cast-assignments"><strong>Voice assignments for the next generation</strong><p>{quality.promptMode === 'legacy' ? 'Unassigned vocal sections rotate through the selected voices. Your lyric text stays in the editor; these labels are added to the generation request.' : 'Clean prompt: YuE2 does not follow per-section voice labels reliably, so the request asks for duet or group vocals instead. Switch Prompt format to Legacy to send these labels.'}</p><ul>{#each assignments as assignment}<li class={`voice-${voiceOf(assignment)}`}>{assignment}</li>{/each}</ul></div>
  {/if}
  </section>
  <section class="planner-group"><h4>3. Song structure</h4>
  <div class="row">
   <label>Tempo · BPM<input aria-label="Planner tempo" type="number" min="40" max="220" bind:value={app.producer.bpm} /></label>
   <label>Takes per generation<select aria-label="Takes per generation" bind:value={app.producer.takes}><option value={1}>1 take</option><option value={3}>3 takes · compare new compositions</option></select></label>
  </div>
  <label>Hip-hop arrangement<select aria-label="Hip-hop arrangement" value={arrangementChoice} onchange={(event) => chooseArrangement(event.currentTarget.value)}>
   <option value="auto">Automatic — follow vocal settings</option>
   <option value="custom">Custom — keep my directions</option>
   {#each arrangementGroups as group}<optgroup label={group}>{#each arrangementPresets.filter(preset => preset.group === group) as preset}<option value={preset.id}>{preset.name}</option>{/each}</optgroup>{/each}
  </select></label>
  <p>Choose a preset to fill the directions below, then make it your own. Choosing another preset replaces these directions. Tempo, voices and lyrics keep their current settings; section lengths are suggestions.</p>
  <label>Arrangement direction<textarea aria-label="Arrangement direction" rows="5" maxlength="2000" placeholder={songPlan({...app.producer, structure: ''})} bind:value={app.producer.structure}></textarea></label>
  <p class="plan">{songPlan(app.producer)}</p>
  {#if app.producer.presence > 0}
   <div class="section-plan" aria-label="Lyric section plan">
    <strong>Sections in your lyrics</strong>
    <p>The generation follows this order. Chorus returns request the same core melody and hook, with fuller backing than the verses.</p>
    {#if sections.length}<ol>{#each sections as section}{@const kind = sectionKind(section.label, section.body)}<li class={`sec-${kind}`} class:chorus={section.chorus}>{section.label}<small class="kind">{SECTION_KIND_NAMES[kind]}{section.chorus ? ' · recurring hook' : ''}</small></li>{/each}</ol>{:else}<p>Add section labels in Lyrics to define the form.</p>{/if}
    {#each formWarnings as warning}<p class="warning">{warning}</p>{/each}
    {#if canAddChorus}<button type="button" onclick={repeatChorus}>Repeat existing hook before outro</button>{/if}
    {#if beforeChorusEdit!==null && app.request.lyrics===chorusEdit}<button type="button" onclick={()=>{app.request.lyrics=beforeChorusEdit!;beforeChorusEdit=null;}}>Undo chorus repeat</button>{/if}
   </div>
  {/if}
  <p>Three takes run one at a time and keep the same plan and voice descriptions. Each has fresh composition and audio seeds. Reloading recovers the active take; remaining takes are not submitted.</p>
  {#if app.request.duration === 0}<p>Song length follows this plan: see the lyric-fit meter under Composition.</p>{/if}
  </section>
  {#each warnings as warning}<p class="warning">{warning}</p>{/each}
 </fieldset>
 <EnsembleBuilder {disabled}/>
 <p>These controls guide the model; percentages describe intent, not measured audio coverage.</p>
</section>

<style>
 .producer { padding: 1.2rem; }
 .heading, .row, .scale { display:flex; gap:1rem; justify-content:space-between; }
 h3 { margin:0; font-size:1rem; }
 fieldset { border:0; padding:0; margin-top:1rem; min-width:0; display:grid; gap:.7rem; }
 label { display:block; font-size:.8rem; }
 .row > label { flex:1; min-width:0; }
 input:not([type=checkbox]), select, textarea { display:block; width:100%; box-sizing:border-box; margin-top:.4rem; color:var(--fg); background:var(--bg-input,var(--bg-card)); border:1px solid var(--border); border-radius:8px; padding:.6rem; }
 input[type=range] { padding:0; accent-color:var(--accent); }
 output { float:right; color:var(--accent); }
 p, .scale { font-size:.75rem; color:var(--fg-dim); line-height:1.5; margin:.3rem 0; }
 .plan { padding:.7rem; border-left:2px solid var(--accent); }
 .section-plan {padding:.8rem;border:1px solid var(--border);border-radius:8px;font-size:.8rem;min-width:0}
 .section-plan ol {display:flex;flex-wrap:wrap;gap:.5rem;list-style-position:inside;padding:0}
 .section-plan li {padding:.5rem;border:1px solid var(--border);border-radius:6px;overflow-wrap:anywhere;max-width:100%}
 .section-plan small {display:block;color:color-mix(in srgb,var(--hue,var(--accent)) 60%,var(--fg));margin-top:.3rem;font-size:.75rem}
 .section-plan button {padding:.6rem;margin:.4rem .4rem 0 0;border:1px solid var(--border);border-radius:6px;background:var(--bg-btn);color:var(--fg);cursor:pointer}
 .warning { color:var(--accent); }
 fieldset:disabled { opacity:.55; }
 .lock { display:flex; gap:.5rem; align-items:center; }
 .planner-group { display:grid; gap:.65rem; min-width:0; padding:1rem; border:1px solid var(--border); border-radius:12px; background:color-mix(in srgb,var(--bg-input) 50%,transparent); }
 h4 { font-size:.82rem; color:var(--fg); margin:0 0 .25rem; }
 .voice-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1rem; }
 .voice-description { display:block; margin-top:.4rem; color:var(--fg-dim); font-size:.75rem; line-height:1.5; }
 @media(max-width:600px) { .voice-grid {grid-template-columns:1fr;} .planner-group {padding:.75rem;} }
 @media(max-width:480px) { .row { flex-direction:column; } }
</style>
