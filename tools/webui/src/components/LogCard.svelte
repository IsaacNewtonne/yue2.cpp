<script lang="ts">
	import { activity, logTone } from '../lib/activity.svelte.js';
	import { GenerationEta } from '../lib/generation-eta.ts';
	import { SSE_RECONNECT_MS, LOG_MAX_LINES } from '../lib/config.js';
	import { ChevronDown, Disc3, Terminal, Check, CircleAlert } from '@lucide/svelte';
	let logsExpanded = $state(false);
	let outcome = $state('');
	let connected = $state(false);
	const grooves = [32, 40, 48, 56, 64, 72, 80, 88];
	const finished = $derived(outcome === 'done' && !activity.running);
	const progress = $derived(finished ? 100 : Math.max(0, Math.min(99, activity.percent ?? 0)));
	const spinning = $derived(activity.running && connected);
	const indeterminate = $derived(spinning && activity.percent === null);
	const displayStage = $derived(!connected ? 'Reconnecting' : activity.running ? activity.stage : finished ? 'Track complete' : outcome === 'failed' ? 'Generation failed' : outcome === 'cancelled' ? 'Generation cancelled' : 'Ready when you are');

	let lines = $state<string[]>([]);
    let overall = $state(false);
    const etaKey = 'yue2-generation-eta-v1';
    function readEta() { try { return JSON.parse(localStorage.getItem(etaKey) || '{}'); } catch { return {}; } }
    const savedEta = readEta();
    const estimator = new GenerationEta(savedEta.timings, savedEta.snapshot);
    function persistEta() { try { localStorage.setItem(etaKey, JSON.stringify({timings:estimator.timings,snapshot:estimator.snapshot})); } catch { /* optional estimate cache */ } }
    function clock(seconds:number) { const n=Math.ceil(seconds);return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`; }

	$effect(() => {
		let es: EventSource | null = null;
		let timer = 0;

		function connect() {
			es = new EventSource('logs');
			es.onopen = () => { connected = true; };
			es.onmessage = (e: MessageEvent) => {
				lines.push(e.data);

				if (lines.length > LOG_MAX_LINES) lines.splice(0, lines.length - LOG_MAX_LINES);
			};
			es.onerror = () => {
				connected = false;
				es?.close();
				es = null;
				lines.push('[Client] Server unavailable');
				if (lines.length > LOG_MAX_LINES) lines.splice(0, lines.length - LOG_MAX_LINES);
				timer = setTimeout(connect, SSE_RECONNECT_MS) as unknown as number;
			};
		}

		connect();
        let stopped=false, hadServerJob=false, lastJob='', pollingNow=false;
        const poll=async()=>{if(pollingNow)return;pollingNow=true;try {const response=await fetch('jobs',{signal:AbortSignal.timeout(5000)});if(!response.ok)return;const jobs=await response.json();if(stopped)return;
            if(jobs.length){
                hadServerJob=true;const job=jobs[0];lastJob=job.id;outcome='';activity.running=true;
                const estimate=estimator.update(job);overall=estimate!==null;
                activity.stage=job.stage;
                activity.percent=estimate?.percent ?? null;
                activity.eta=estimate?.eta ?? null;
                const stagePercent=job.total>0?Math.min(100,100*job.done/job.total):null;
                activity.detail=`Job ${job.id.slice(0,8)} | ${jobs.length-1} waiting | ${estimate ? clock(estimate.elapsed)+' elapsed (approx.)' : job.elapsed+'s in stage'}`;
                if(stagePercent!==null)activity.detail+=` | Stage ${Math.floor(stagePercent)}% (${job.done}/${job.total} ${job.stage.startsWith('Composing')?'token budget':'steps'})`;
                persistEta();
            }
            else if(!activity.running || (hadServerJob && !['Creating artwork','Rendering MP4'].includes(activity.stage))){
                if(hadServerJob && lastJob){
                    const terminal=await fetch(`job?id=${encodeURIComponent(lastJob)}`,{signal:AbortSignal.timeout(5000)});
                    if(!terminal.ok)return;
                    const result=await terminal.json();if(stopped)return;
                    if(!['done','failed','cancelled'].includes(result.status))return;
                    outcome=result.status;
                }
                hadServerJob=false;overall=false;estimator.clear();persistEta();activity.running=false;activity.stage='Ready';activity.detail='No server jobs queued';activity.percent=null;activity.eta=null;
            }

        }catch{/* logs show the connection state */}finally{pollingNow=false}};
        void poll();const polling=setInterval(poll,1500);
        return () => {
			stopped=true;clearInterval(polling);
			clearTimeout(timer);
			es?.close();
		};
	});
</script>

<div class="card vinyl-activity">
 <div class="card-header">
  <Disc3 size={15} /> <span class="card-label">Studio activity</span>
  <span class="connection" class:offline={!connected}><i></i>{connected ? 'Live' : 'Connecting'}</span>
 </div>
 <div class="record-panel" class:finished class:spinning>
  <div class="record-heading" aria-live="polite">
   <span class="eyebrow">{finished ? 'READY TO PLAY' : spinning ? 'ON THE TURNTABLE' : 'YOUR NEXT RECORD'}</span>
   <h3>{displayStage}</h3>
  </div>
  <div class="record-wrap" role="progressbar" aria-label="Track progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={indeterminate || !connected ? undefined : progress} aria-valuetext={indeterminate ? 'Working, estimating progress' : finished ? 'Track complete' : activity.running ? `${Math.floor(progress)} percent estimated` : displayStage}>
   <svg class="record" viewBox="0 0 216 216" aria-hidden="true">
    <circle class="finish-halo" cx="108" cy="108" r="98" />
    <circle class="finish-ring" cx="108" cy="108" r="94" />
    <g class="record-spin">
     <circle class="record-base" cx="108" cy="108" r="90" />
     <circle class="record-fill" cx="108" cy="108" r={24 + progress * .66} />
     {#each grooves as radius, index}
      <circle class="groove" cx="108" cy="108" r={radius} />
      <circle class="groove-progress" class:complete={finished} cx="108" cy="108" r={radius} pathLength="100" stroke-dasharray={`${Math.max(0, Math.min(100, progress * grooves.length - index * 100))} 100`} transform="rotate(-90 108 108)" style={`--ring-index:${index}`} />
     {/each}
     <path class="record-sheen" d="M108 108 L56 35 A90 90 0 0 1 103 18 Z M108 108 L160 181 A90 90 0 0 1 113 198 Z" />
     <circle class="record-label" cx="108" cy="108" r="24" />
     <text class="label-type" x="108" y="101" text-anchor="middle">YUE</text>
     <text class="label-side" x="108" y="121" text-anchor="middle">SIDE A</text>
     <circle class="spindle" cx="108" cy="108" r="3" />
    </g>
    {#if indeterminate}<circle class="seeking" cx="108" cy="108" r="94" pathLength="100" stroke-dasharray="12 88" />{/if}
   </svg>
   <span class="finish-label">{finished ? 'FINISHED' : 'FINISH LINE'}</span>
  </div>
  <div class="readout">
   <span class="percent">{#if finished}<Check size={19} /> 100<span class="percent-unit">%</span>{:else if spinning && activity.percent !== null}{Math.floor(progress)}<span class="percent-unit">%</span>{:else if activity.running}<span class="waiting">Finding the groove<span class="working-dots">?</span></span>{:else if outcome === 'failed'}<CircleAlert size={19} /><span class="waiting">Check the logs below</span>{:else}<span class="waiting">{outcome === 'cancelled' ? 'Stopped' : 'The needle is waiting'}</span>{/if}</span>
   <span class="estimate">{finished ? 'Your audio is ready' : spinning && activity.eta !== null ? `About ${clock(activity.eta)} remaining` : activity.running ? 'Estimating time remaining' : 'Start a track to bring it to life'}</span>
  </div>
  <div class="record-caption"><span class="caption-line"></span><span>{finished ? 'Every groove, complete' : 'Fills from the center to the white ring'}</span><span class="caption-line"></span></div>
  {#if overall && activity.running}<p class="eta-note">Estimated through audio export. Artwork and video follow separately.</p>{/if}
 </div>
 <button class="logs-toggle" aria-expanded={logsExpanded} onclick={() => logsExpanded = !logsExpanded}>
  <Terminal size={14} /><span>Detailed logs</span><span class="line-count">{lines.length} lines</span><ChevronDown size={15} class={logsExpanded ? 'chevron open' : 'chevron'} />
 </button>
 {#if logsExpanded}
  {#if activity.running}<p class="job-detail">{activity.detail}</p>{/if}
  <div class="log-legend"><span class="compose">Compose</span><span class="render">Render</span><span class="audio">Audio</span><span class="success">Complete</span><span class="error">Error</span></div>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable logs need keyboard access.) -->
  <div class="log-body" role="region" aria-label="Server activity log" tabindex="0">{#each lines as line}<div class={`log-line ${logTone(line)}`}>{line}</div>{/each}</div>
 {/if}
</div>

<style>
 .card{display:flex;flex-direction:column;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-card);box-shadow:var(--shadow);overflow:hidden;min-width:0}
 .card-header{display:flex;align-items:center;gap:.5rem;padding:.85rem 1rem;color:var(--fg-dim);font-size:.68rem;font-weight:700;letter-spacing:.09em;text-transform:uppercase;border-bottom:1px solid var(--border)}
 .connection{margin-left:auto;display:flex;align-items:center;gap:.4rem;font-size:.58rem;font-weight:500;letter-spacing:.04em;color:var(--fg-dim)}
 .connection i{width:6px;height:6px;border-radius:50%;background:#6de2cc;box-shadow:0 0 10px #6de2cc66}.connection.offline i{background:#9e98b3;box-shadow:none}
 .record-panel{padding:1.2rem 1rem 1rem;text-align:center;background:radial-gradient(ellipse at 50% 47%,#7d66af1c,transparent 69%),linear-gradient(160deg,#12111a,#181321);color:#f2edf9}
 .record-heading{min-height:42px}.eyebrow{font-size:.53rem;letter-spacing:.21em;color:#b0a4c1;font-weight:600}h3{font-size:.95rem;font-weight:550;letter-spacing:-.025em;margin:.35rem 0 0;line-height:1.35}
 .record-wrap{width:min(100%,232px);margin:.45rem auto .8rem;position:relative}.record{display:block;width:100%;overflow:visible;filter:drop-shadow(0 12px 16px #0005)}
 .finish-halo{fill:none;stroke:#fff;stroke-opacity:.04;stroke-width:7}.finish-ring{fill:none;stroke:#fff;stroke-opacity:.85;stroke-width:1.25}
 .record-spin{transform-origin:108px 108px;animation:record-turn 9s linear infinite;animation-play-state:paused}.spinning .record-spin{animation-play-state:running}
 .record-base{fill:#0b0c11;stroke:#36323f;stroke-width:1}.record-fill{fill:#211c2d;transition:r 1.5s ease}
 .groove{fill:none;stroke:#fff;stroke-opacity:.09;stroke-width:1}.groove-progress{fill:none;stroke:#ab98d5;stroke-width:2.5;stroke-linecap:butt;transition:stroke-dasharray 1.5s ease;opacity:calc(.5 + var(--ring-index) * .065)}.groove-progress.complete{stroke:#80d9c7}
 .record-sheen{fill:#ffffff07;pointer-events:none}.record-label{fill:#b6a0da;stroke:#d2c0f1;stroke-width:1}.label-type{fill:#221830;font-size:8px;font-weight:800;letter-spacing:2px}.label-side{fill:#473556;font-size:4px;font-weight:700;letter-spacing:1px}.spindle{fill:#0b0c11;stroke:#f0e4ff;stroke-width:1}
 .seeking{fill:none;stroke:#b59af4;stroke-width:3;transform-origin:108px 108px;animation:record-turn 3s linear infinite}
 .finish-label{position:absolute;bottom:0;left:50%;transform:translate(-50%,50%);white-space:nowrap;background:#171320;padding:3px 9px;color:#c3baca;font-size:.47rem;letter-spacing:.18em}.finished .finish-label{color:#a4e5d5}
 .readout{display:flex;flex-direction:column;align-items:center;gap:.3rem;min-height:49px}.percent{display:flex;align-items:center;gap:.3rem;font-size:1.55rem;line-height:1.25;font-weight:550;letter-spacing:-.06em;font-variant-numeric:tabular-nums}.percent-unit{font-size:.75rem;color:#b4a6c8;letter-spacing:0;align-self:center}.finished .percent{color:#a5ead8}.waiting{font-size:.8rem;letter-spacing:0;font-weight:500}.estimate{font-size:.64rem;color:#aea2bf;font-variant-numeric:tabular-nums}
 .record-caption{display:flex;align-items:center;gap:.55rem;justify-content:center;margin-top:1rem;color:#958aa5;font-size:.54rem}.caption-line{height:1px;background:#ffffff16;flex:1;max-width:30px}.eta-note{color:#958aa5;font-size:.54rem;line-height:1.5;margin:.7rem 0 0}
 .logs-toggle{display:flex;align-items:center;gap:.5rem;background:var(--bg-card);color:var(--fg-dim);padding:.75rem 1rem;border:0;border-top:1px solid var(--border);width:100%;text-align:left;cursor:pointer;font-size:.66rem}.logs-toggle:hover{background:var(--bg-card-2);color:var(--fg)}.logs-toggle:focus-visible{outline:2px solid var(--accent);outline-offset:-3px}.line-count{margin-left:auto;font-size:.57rem;color:var(--fg-faint)}:global(.chevron){transition:transform .2s}:global(.chevron.open){transform:rotate(180deg)}
 .job-detail{padding:.6rem .8rem;margin:0;font-size:.62rem;line-height:1.6;color:var(--fg-dim)}.log-legend{display:flex;flex-wrap:wrap;gap:.7rem;padding:.45rem .8rem;background:#101522;font-size:.62rem}.log-body{padding:.6rem .8rem;max-height:12rem;overflow:auto;font-family:ui-monospace,'Cascadia Mono',monospace;font-size:.7rem;line-height:1.5;background:#0a101b;white-space:pre-wrap;overflow-wrap:anywhere}.log-line{padding:.2rem .4rem;border-left:2px solid currentColor;margin:.15rem 0;background:#ffffff03}.info{color:#a9c7e8}.compose{color:#c3a5ff}.render{color:#71cfff}.audio{color:#ffd18a}.success{color:#64dfad}.warning{color:#ffbb6c}.error{color:#ff8f9d}
 @keyframes record-turn{to{transform:rotate(360deg)}}
 @media(prefers-reduced-motion:reduce){.record-spin,.seeking{animation:none}.record-fill,.groove-progress{transition:none}:global(.chevron){transition:none}}
 @media(max-width:400px){.record-wrap{max-width:195px}.record-panel{padding:1rem .75rem}.card-header{padding:.75rem}.record-caption{font-size:.5rem}}
</style>
