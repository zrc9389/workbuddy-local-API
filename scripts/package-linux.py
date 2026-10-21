#!/usr/bin/env python3
"""Package prebuilt static Linux binaries and pinned kernels; no install or network."""
from pathlib import Path
import argparse,hashlib,io,json,struct,tarfile,time
ROOT=Path(__file__).resolve().parent.parent
p=argparse.ArgumentParser();p.add_argument('--arch',choices=['amd64','arm64'],required=True);p.add_argument('--output',type=Path);args=p.parse_args()
arch=args.arch;prefix=f'workbuddy-local-v0.2.0-linux-{arch}';target=args.output or ROOT/'release'/(prefix+'.tar.gz')
if target.exists():raise SystemExit('Refusing overwrite: '+str(target))
meta=json.loads((ROOT/'third_party/meta/manifest.json').read_text());record=meta['mihomo']['platforms']['linux-'+arch]
files={'wb2api':ROOT/f'dist/linux-{arch}/workbuddy-local','wb2api-no-logs':ROOT/f'dist/linux-{arch}/workbuddy-local-no-logs','start.sh':ROOT/'deployment/linux/package-start.sh'}
for name in ['README.md','LICENSE','config.example.json']:files[name]=ROOT/name
for folder in ['deployment/linux','docs']:
 for f in sorted((ROOT/folder).rglob('*')):
  if f.is_file() and f.suffix not in ['.tmp','.pyc'] and '__pycache__' not in f.parts and (f.suffix!='.log' or f.name=='v02-load-evidence.log'):files[f.relative_to(ROOT).as_posix()]=f
for f in sorted((ROOT/'third_party/meta').rglob('*')):
 if not f.is_file() or f.suffix=='.go':continue
 rel=f.relative_to(ROOT).as_posix()
 if '/bin/' in rel and rel!=f'third_party/meta/bin/linux-{arch}/mihomo':continue
 files[rel]=f
for name in ['wb2api','wb2api-no-logs',f'third_party/meta/bin/linux-{arch}/mihomo']:
 f=files[name];b=f.read_bytes();assert b[:7]==b'\x7fELF\x02\x01\x01',name;assert int.from_bytes(b[18:20],'little')=={'amd64':62,'arm64':183}[arch],name
kernel=files[f'third_party/meta/bin/linux-{arch}/mihomo'];assert hashlib.sha256(kernel.read_bytes()).hexdigest()==record['binary_sha256']
def add(z,name,data,mode=0o644):
 info=tarfile.TarInfo(prefix+'/'+name);info.size=len(data);info.mode=mode;info.uid=0;info.gid=0;info.uname=info.gname='root';info.mtime=int(time.time());z.addfile(info,io.BytesIO(data))
target.parent.mkdir(parents=True,exist_ok=True)
manifest=[]
with tarfile.open(target,'x:gz') as z:
 for name,f in sorted(files.items()):
  b=f.read_bytes();mode=0o755 if name in ['wb2api','wb2api-no-logs','start.sh',f'third_party/meta/bin/linux-{arch}/mihomo'] or name.endswith('.sh') else 0o644
  if name.endswith('.sh'):assert b'\r' not in b and not b.startswith(b'\xef\xbb\xbf'),name
  add(z,name,b,mode);manifest.append(hashlib.sha256(b).hexdigest()+'  '+name)
 add(z,'SHA256SUMS.txt',('\n'.join(manifest)+'\n').encode())
with tarfile.open(target) as z:
 names=z.getnames();assert len(names)==len(set(names))
 for m in z:
  assert m.isfile() and not m.name.startswith('/') and '..' not in Path(m.name).parts,m.name
  assert not any(part in ['data','auths','demo-data','.git'] or part.startswith('.qa') for part in Path(m.name).parts),m.name
  assert not m.name.endswith(('/config.json','/password.json','/state.json','/conversations.json')),m.name
  if m.name.endswith('/wb2api') or m.name.endswith('/mihomo') or m.name.endswith('.sh'):assert m.mode==0o755,m.name
print(target.name,target.stat().st_size,hashlib.sha256(target.read_bytes()).hexdigest())
