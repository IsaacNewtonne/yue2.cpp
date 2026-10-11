"""Generate short, separate YuE2 voice auditions, preserving requests/results.
No voice conversion, library writes, or source-track replacement.
"""
import json, time, uuid, subprocess, sys
from pathlib import Path
from email.parser import BytesParser
from email import policy
import requests

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'build/audio-analysis/shared-score-voices'
OUT.mkdir(parents=True,exist_ok=True)
BASE='http://localhost:8087'
VOICES=[('warm-baritone','One solo male vocalist. Warm low baritone, relaxed chest voice, intimate natural delivery, clear words.'),
        ('bright-alto','One solo female vocalist. Bright clear alto, soulful natural delivery, expressive upper-middle register, clear words.'),
        ('gritty-tenor','One solo male vocalist. Gritty raspy tenor, higher placement, energetic rhythmic delivery, audible natural breath texture, clear words.')]
LYRICS='[Hook]\nJust enough for the rent and the food,\nJust enough not to choose what to lose.\nI do not need the whole world in my hands,\nJust enough to stand.'

def run():
 for index,(name,voice) in enumerate(VOICES):
  if index == 0: continue
  folder=OUT/name;folder.mkdir(exist_ok=True)
  if (folder/'mix.wav').exists():continue
  request={'style':f'Boom bap hip-hop, 88 BPM, D minor. Short 20-second vocal audition. Start vocals immediately. Sparse quiet drums and soft piano under a prominent dry natural human lead. No intro, no vocal effects, no vocoder, no choir or doubled lead. {voice} Sing the four-line hook with a simple memorable melody, ending on the last line.',
   'abc':(OUT/'shared-score.abc').read_text(),'lyrics':LYRICS,'duration':20,'lm_seed':573901+index*379,'seed':719823+index*557,'steps':32,'lm_batch_size':1,'synth_batch_size':1,'output_format':'wav16','mastering_profile':'off'}
  (folder/'request.json').write_text(json.dumps(request,indent=2))
  jobfile=folder/'job.json'
  if jobfile.exists():job=json.loads(jobfile.read_text())['id']
  else:
   if requests.get(BASE+'/jobs',timeout=10).json():raise RuntimeError('Server busy; rerun when the current job finishes.')
   job=uuid.uuid4().hex;jobfile.write_text(json.dumps({'id':job}))
   r=requests.post(BASE+'/synth',json=request,headers={'X-Yue2-Job-Id':job},timeout=30);r.raise_for_status()
  print(f'{name}: job {job}',flush=True);last=''
  while True:
   r=requests.get(BASE+'/job',params={'id':job},timeout=15);r.raise_for_status();state=r.json()['status']
   if state=='done':break
   if state in ('failed','cancelled','interrupted'):raise RuntimeError(f'{name}: {state}')
   jobs=requests.get(BASE+'/jobs',timeout=15).json();current=next((j for j in jobs if j['id']==job),{})
   stage=current.get('stage',state)
   if stage!=last:print(f'{name}: {stage}',flush=True);last=stage
   time.sleep(5)
  r=requests.get(BASE+'/job',params={'id':job,'result':1},timeout=60);r.raise_for_status()
  (folder/'result.multipart').write_bytes(r.content)
  msg=BytesParser(policy=policy.default).parsebytes(('MIME-Version: 1.0\r\nContent-Type: '+r.headers['Content-Type']+'\r\n\r\n').encode()+r.content)
  for part in msg.iter_parts():
   data=part.get_payload(decode=True)
   if part.get_content_type()=='application/json':(folder/'result.json').write_bytes(data)
   elif part.get_content_type().startswith('audio/'):(folder/'mix.wav').write_bytes(data)
  if not (folder/'mix.wav').exists():raise RuntimeError('No audio in result')
  print(f'{name}: saved mix',flush=True)
 print('All three native YuE2 takes saved.',flush=True)

if __name__=='__main__':run()
