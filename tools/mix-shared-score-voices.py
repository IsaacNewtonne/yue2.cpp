"""Assemble a shared-backing audition; never overwrite the source song."""
import array,json,math,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]/'build/audio-analysis'
OUT=ROOT/'shared-score-voices';RATE=44100
def read(p):
 b=subprocess.check_output(['ffmpeg','-v','error','-i',str(p),'-f','f32le','-ac','2','-ar',str(RATE),'-'])
 a=array.array('f');a.frombytes(b);return a
def save(p,a):
 subprocess.run(['ffmpeg','-v','error','-y','-f','f32le','-ac','2','-ar',str(RATE),'-i','-','-c:a','pcm_s16le',str(p)],input=a.tobytes(),check=True)
def rms(a):return math.sqrt(sum(x*x for x in a)/len(a))
folders=[ROOT/'yue2-voice-auditions/warm-baritone',OUT/'bright-alto',OUT/'gritty-tenor']
back=read(next((folders[0]/'stems').glob('*Instrumental*.wav')))
vocals=[read(next((f/'stems').glob('*Vocals*.wav'))) for f in folders]
n=len(back)
if any(abs(len(v)-n)>RATE*.1 for v in vocals):raise ValueError('Duration mismatch: review alignment before mixing')
target=rms(vocals[0]);gains=[min(3,target/max(rms(v),1e-8)) for v in vocals]
mixes=[array.array('f',(back[i]+(v[i]*g if i<len(v) else 0) for i in range(n))) for v,g in zip(vocals,gains)]
peak=max(abs(x) for mix in mixes for x in mix);gain=min(1,.94/max(peak,1e-8))
# Keep all singers in the same stereo position and apply one common output
# gain. Short boundary fades suppress clicks without shifting musical timing.
fade=int(.035*RATE)*2
for mix in mixes:
 for i in range(n):mix[i]*=gain*min(1,i/fade,(n-1-i)/fade)
names=['warm-baritone','bright-alto','gritty-tenor']
for name,mix in zip(names,mixes):save(OUT/f'{name}-shared-backing.wav',mix)
order=[0,1,2,1];joined=array.array('f');timeline=[]
for index in order:
 start=len(joined)/(2*RATE);joined.extend(mixes[index]);timeline.append({'voice':names[index],'start':start,'end':len(joined)/(2*RATE)})
save(OUT/'shared-backing-preview.wav',joined)
manifest={'timeline':timeline,'vocal_gains_db':[20*math.log10(g) for g in gains],'output_gain':gain,'peak':max(abs(x) for x in joined),'seconds':len(joined)/(2*RATE),'method':'Warm-baritone backing repeated unchanged; new alto and tenor use its exact ABC score. Alto audio repeats exactly for the final hook. No pitch shift or time stretch. Actual phrasing alignment remains a listening check.'}
(OUT/'mix-manifest.json').write_text(json.dumps(manifest,indent=2))
cards=''.join(f'<section><h2>{name.replace("-"," ").title()}</h2><audio controls src="{name}-shared-backing.wav"></audio></section>' for name in names)
(OUT/'listen.html').write_text('<!doctype html><meta charset="utf-8"><title>Shared backing voice test</title><style>body{font:17px system-ui;background:#171329;color:#eee;max-width:850px;margin:40px auto;padding:20px}section{padding:20px;background:#29213e;margin:18px 0;border-radius:12px}audio{width:100%}p{line-height:1.6}</style><h1>Three voices, one backing</h1><p>Warm baritone → bright alto → gritty tenor → same alto hook returns. About 20 seconds each. All sing the same audition lyrics; this is a musical compatibility test, not the finished song.</p><audio controls src="shared-backing-preview.wav"></audio><p>The original baritone backing repeats for every section. The other voices were generated using its score, without voice conversion or pitch shifting. Listen for naturalness, melody fit, and timing.</p>'+cards,encoding='utf-8')
print(json.dumps(manifest,indent=2))
