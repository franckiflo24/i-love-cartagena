# Derive every icon-dependent file from the verified FINAL app icon. Run from frontend/: python3 ../scripts/derive-icons.py
import os
from PIL import Image
import numpy as np
FINAL=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'store-assets', 'icon', 'app-icon-1024.png')
ic=Image.open(FINAL); icc=ic.info.get('icc_profile'); ic=ic.convert('RGB')
assert ic.size==(1024,1024)
out={}
ic.save('assets/images/icon.png', icc_profile=icc, optimize=True); out['assets/images/icon.png']=ic.size
for s,name in [(192,'public/splash/amo-icon-192.png'),(512,'public/splash/amo-icon-512.png'),(180,'public/splash/amo-icon-180.png')]:
    ic.resize((s,s),Image.LANCZOS).save(name, icc_profile=icc, optimize=True); out[name]=(s,s)
# Android adaptive foreground: transparent, emblem inside the central 66% safe zone
a=np.asarray(ic).astype(np.float32)/255; alpha=a.max(axis=2); safe=np.where(alpha>1e-4,alpha,1)[...,None]
rgba=np.dstack([np.clip(a/safe,0,1),alpha[...,None]]); rgba[alpha<0.03]=0
fg=Image.fromarray((rgba*255+.5).astype(np.uint8),'RGBA')
bb=fg.getchannel('A').point(lambda v:255 if v>40 else 0).getbbox(); em=fg.crop(bb)
k=min(676/em.width, 676/em.height); em=em.resize((round(em.width*k),round(em.height*k)),Image.LANCZOS)
can=Image.new('RGBA',(1024,1024),(0,0,0,0)); can.paste(em,((1024-em.width)//2,(1024-em.height)//2),em)
can.save('assets/images/adaptive-icon.png', optimize=True); out['assets/images/adaptive-icon.png']=can.size
for k,v in out.items(): print(k, v, Image.open(k).mode, round(os.path.getsize(k)/1024),'KB')
