import json, sys, numpy as np
from collections import defaultdict
d=json.load(open(sys.argv[1])); rows=d['rows']
top=defaultdict(lambda:-1e9)
for r in rows: top[(r['key'],r['rpm'])]=max(top[(r['key'],r['rpm'])],r['lvl'])
for key in ['baffle','pass3']:
  R=[r for r in rows if r['key']==key and r['lvl']>top[(key,r['rpm'])]-20]
  edges=[40,80,160,320,640,1280]
  print(key,'orders',len(R))
  for a,b in zip(edges[:-1],edges[1:]):
    S=[r for r in R if a<=r['f']<b]
    if len(S)<2: continue
    m=lambda k: np.median([r[k] for r in S])
    print('  %4d-%4d Hz n=%2d  median IL: wave %6.1f  TM const-velocity %6.1f  TM anechoic %6.1f   |wave-best| %4.1f'%(a,b,len(S),m('wave'),m('tmVel'),m('tmAn'),min(abs(m('wave')-m('tmVel')),abs(m('wave')-m('tmAn')))))
