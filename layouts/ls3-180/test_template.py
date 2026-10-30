import os
import sys, time, json
sys.path.insert(0,'.'); sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'fusion-addin'))
import design as D, router as RT, templates as T
IN=2.54
D.FLOOR_Y=10.75; D.GROUND_Z=-14.0
sol=D.solids(); sc=RT.Scene(cell=1.0,sample_len=0.4)
for n,k,p in sol:
    co,ix=D.mesh_of(k,p); sc.add_mesh(co,ix,0.0,n)
sc.build((-50*IN,-20*IN,-24*IN),(14*IN,20*IN,18*IN),2.0)
ports={}
for i in range(4):
    ports[1+2*i]=D.port(i,+1); ports[2+2*i]=D.port(i,-1)
CX,CY,CZ=-21.0,7.7,-6.6
B=T.Bundle180(ports,((CX*IN,CY*IN,CZ*IN),(-1,0,0)),((CX*IN,-CY*IN,CZ*IN),(-1,0,0)),[1,8,7,2,6,5,4,3],1.875,2.82,scene=sc)
t0=time.time(); R=B.layout(); print('%.0f s'%(time.time()-t0))
print('target',round(R['target_in'],2),'ok',R['ok'],'deep side',R['deep_side'],'dips',R['dips'],'groups',R['groups'])
for n in R['notes']: print(' note:',n)
for c,t in sorted(R['tubes'].items()): print(c, round(t['length']/IN,2),'trim',round(t['trim'],2),'scene',t['scene_gap'] and round(t['scene_gap']/IN,2),'overlap',t['bend_overlap'],'bends',t['fab']['bends'])
bad={k:round(v[0]/IN,2) for k,v in R['pairs'].items() if v[0]<0.125*IN}; print('pairs under 1/8 in:',bad)
