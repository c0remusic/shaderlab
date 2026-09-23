import { s2l, niveau, ap, PP_VERS_SRGB, PP_XYZ, motif, oklab } from "./brevet-commun.mjs";
const spow = (v,e)=>Math.sign(v)*Math.pow(Math.abs(v),e);
const dot=(w,v)=>w[0]*v[0]+w[1]*v[1]+w[2]*v[2];
const c={code:(v)=>spow(v,1/1.8),dec:(v)=>spow(v,1.8)};
const w=PP_XYZ[1], mo=motif(60), S=0.6, q=(1-S)/(2*S);
const sw=w[0]+w[1]+w[2], wm=dot(w,mo);
for(const i of [0,8,32,128,255]){
  const x=s2l(i/255); const cible=sw*c.code(x);
  const d=cible/(q*sw+wm), m=q*d; const e=mo.map(p=>m+d*p);
  const ppl=e.map(c.dec); const sr=ap(PP_VERS_SRGB,ppl); const nv=sr.map(niveau);
  console.log("i",i,"e",e.map(v=>v.toFixed(3)),"sr",sr.map(v=>v.toFixed(3)),"niv",nv.map(v=>v.toFixed(1)),"okL(niv/255)",oklab([s2l(nv[0]/255),s2l(nv[1]/255),s2l(nv[2]/255)])[0].toFixed(3));
}
