"""Package generated mixes and extracted stems as a local listening report."""
import array,json,math,subprocess,wave
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]/'build/audio-analysis/yue2-voice-auditions'
names=['warm-baritone','bright-alto','gritty-tenor']
def read(path):
 raw=subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-f','f32le','-ar','44100','-ac','2','-'])
 x=array.array('f');x.frombytes(raw);return x
def save(path,x):
 subprocess.run(['ffmpeg','-v','error','-y','-f','f32le','-ar','44100','-ac','2','-i','-','-c:a','pcm_s16le',str(path)],input=x.tobytes(),check=True)
manifest=[];clips=[];cards=[]
for name in names:
 folder=ROOT/name;vocal=next((folder/'stems').glob('*Vocals*.wav'))
 x=read(vocal);rms=math.sqrt(sum(v*v for v in x)/len(x));peak=max(abs(v) for v in x)
 gain=min(.12/max(rms,1e-8),.94/max(peak,1e-8),3)
 x=array.array('f',(v*gain for v in x));save(folder/'vocals-preview.wav',x)
 manifest.append({'name':name,'duration':len(x)/88200,'vocal_gain_db':20*math.log10(gain),'peak':max(abs(v) for v in x)})
 clips.extend(x)
 if name!=names[-1]:clips.extend([0.0]*88200)
 cards.append(f'<section><h2>{name.replace("-"," ").title()}</h2><p>Original generated mix</p><audio controls src="{name}/mix.wav"></audio><p>Extracted vocals (level adjusted for comparison)</p><audio controls src="{name}/vocals-preview.wav"></audio></section>')
save(ROOT/'native-voices-comparison.wav',array.array('f',clips))
(ROOT/'validation.json').write_text(json.dumps(manifest,indent=2))
(ROOT/'listen.html').write_text('<!doctype html><meta charset="utf-8"><title>Native YuE2 voice auditions</title><style>body{font:17px system-ui;background:#171329;color:#eee;max-width:850px;margin:40px auto;padding:20px}section{padding:20px;background:#29213e;margin:18px 0;border-radius:12px}audio{width:100%}p{line-height:1.6}</style><h1>Native YuE2 voice auditions</h1><p>Three independent performances of the same hook: warm baritone, bright alto, gritty tenor. No voice conversion. These are requested voice qualities; listen to confirm actual identity and naturalness. The different takes are not yet aligned to a shared backing.</p><h2>Extracted vocals, in order</h2><audio controls src="native-voices-comparison.wav"></audio>'+''.join(cards),encoding='utf-8')
print(json.dumps(manifest,indent=2))
