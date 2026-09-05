"""CPU pose contact sheets; install numpy/matplotlib to regenerate."""
import json, sys
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection
root=Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/deadlight-poses')
poses=json.loads((root/'manifest.json').read_text())
idx=np.fromfile(root/'indices.bin',dtype=np.uint32).reshape(-1,3)
# Fixed three-quarter orthographic view for a fair before/after comparison.
yaw=-.65
R=np.array([[np.cos(yaw),0,np.sin(yaw)],[0,1,0],[-np.sin(yaw),0,np.cos(yaw)]])
light=np.array([-.4,.7,1.]);light/=np.linalg.norm(light)
for label, subset, cols in [('comparison',poses[:26],6),('crawler',poses[26:],5)]:
 rows=(len(subset)+cols-1)//cols
 fig,axes=plt.subplots(rows,cols,figsize=(cols*2.8,rows*3.2),facecolor='#10191f')
 for ax,item in zip(axes.flat,subset):
  pts=np.fromfile(root/item['file'],dtype=np.float32).reshape(-1,3)@R.T
  tri=pts[idx];normal=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]);normal/=np.maximum(np.linalg.norm(normal,axis=1)[:,None],1e-8)
  shade=.35+.65*np.maximum(0,normal@light)
  base=np.array([.72,.78,.75]) if item['version']=='Original' else np.array([.38,.79,.77])
  colors=np.c_[np.clip(shade[:,None]*base,0,1),np.ones(len(shade))]
  order=np.argsort(tri[:,:,2].mean(axis=1))
  ax.add_collection(PolyCollection(tri[order,:,:2],facecolors=colors[order],edgecolors='none',rasterized=True))
  ax.axhline(0,color='#677580',lw=.7);ax.set_xlim(-1.2,1.2);ax.set_ylim(-.3,2.2);ax.set_aspect('equal');ax.set_facecolor('#10191f');ax.axis('off')
  ax.set_title(f"{item['name']} · {item['phase']:.0%}\n{item['version']}",color='#dce9ed',fontsize=10)
 for ax in list(axes.flat)[len(subset):]:ax.axis('off')
 fig.suptitle('DEADLIGHT / skeleton pose audit',color='white',fontsize=18)
 fig.tight_layout(rect=(0,0,1,.95));fig.savefig(root/f'{label}.png',dpi=140,facecolor=fig.get_facecolor());plt.close(fig)
print(root/'comparison.png');print(root/'crawler.png')
