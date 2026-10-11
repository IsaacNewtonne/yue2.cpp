"""Build an A/B/C listening test from isolated original/converted vocals.
All inputs are local files; the source song and library are never overwritten.
"""
import argparse, array, json, math, subprocess
from pathlib import Path

def decode(path, seconds):
    raw = subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-t',str(seconds),'-f','f32le','-ar','44100','-ac','2','-'])
    data=array.array('f');data.frombytes(raw)
    return data

def rms(data):
    return math.sqrt(sum(x*x for x in data)/max(1,len(data)))

def write(path,data):
    subprocess.run(['ffmpeg','-v','error','-y','-f','f32le','-ar','44100','-ac','2','-i','-','-c:a','pcm_s16le',str(path)],input=data.tobytes(),check=True)

def main():
    p=argparse.ArgumentParser();p.add_argument('--original',required=True);p.add_argument('--backing',required=True);p.add_argument('--converted',nargs=2,required=True);p.add_argument('--output',required=True);p.add_argument('--seconds',type=float,default=8)
    a=p.parse_args();out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
    backing=decode(a.backing,a.seconds);voices=[decode(f,a.seconds) for f in [a.original,*a.converted]]
    expected=int(a.seconds*44100)*2
    if any(abs(len(v)-expected)>4410 for v in voices):raise ValueError('Converted duration differs by more than 50ms; alignment must be reviewed.')
    voices=[array.array('f',v[:expected])+array.array('f',[0]*max(0,expected-len(v))) for v in voices]
    target=rms(voices[0]);gains=[min(4,target/max(1e-8,rms(v))) for v in voices]
    adjusted=[array.array('f',(x*g for x in v)) for v,g in zip(voices,gains)]
    mixed=[array.array('f',(backing[i]+(v[i] if i<len(v) else 0) for i in range(min(expected,len(backing))))) for v in adjusted]
    peak=max(abs(x) for v in mixed+adjusted for x in v);scale=min(1,.95/max(peak,1e-8))
    joined=array.array('f');solo=array.array('f');timeline=[]
    for i,(name,mix,voc) in enumerate(zip(['original','david-reference','zira-reference'],mixed,adjusted)):
        mix=array.array('f',(x*scale for x in mix));voc=array.array('f',(x*scale for x in voc))
        write(out/f'{name}-mix.wav',mix);write(out/f'{name}-vocals.wav',voc)
        timeline.append({'voice':name,'start':len(joined)/88200,'end':len(joined)/88200+len(mix)/88200,'vocal_gain_db':round(20*math.log10(gains[i]),2)})
        joined.extend(mix);solo.extend(voc)
        if i<2:joined.extend([0]*52920);solo.extend([0]*52920)
    write(out/'three-voice-comparison.wav',joined);write(out/'three-voice-vocals-only.wav',solo)
    (out/'comparison.json').write_text(json.dumps({'timeline':timeline,'common_gain':scale,'note':'Same phrase repeated over the same extracted backing. Synthetic speech references; singing pitch preservation not verified.'},indent=2))
    cards=''.join(f'<section><h2>{i+1}. {name}</h2><audio controls src="{slug}-mix.wav"></audio><p>Vocal only</p><audio controls src="{slug}-vocals.wav"></audio></section>' for i,(name,slug) in enumerate([('Original YuE2 voice','original'),('David reference conversion','david-reference'),('Zira reference conversion','zira-reference')]))
    (out/'listen.html').write_text('<!doctype html><meta charset="utf-8"><title>YuE2 voice comparison</title><style>body{font:17px system-ui;background:#171329;color:#eee;max-width:850px;margin:40px auto;padding:20px}section{padding:20px;background:#29213e;margin:18px 0;border-radius:12px}audio{width:100%}p{line-height:1.6}</style><h1>Three-voice comparison</h1><p>The same eight-second rap phrase and backing, repeated with three vocal versions. Listen for a distinct identity, clear words, timing, and artifacts. These are prototype conversions using generic Windows speech voices, not the final singer profiles.</p><h2>All three, in order</h2><audio controls src="three-voice-comparison.wav"></audio>'+cards,encoding='utf-8')
    print(json.dumps(timeline,indent=2))
if __name__=='__main__':main()
