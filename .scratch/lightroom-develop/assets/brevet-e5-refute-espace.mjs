// REFUTATION E5 — le test canal-par-canal EPINGLE-T-IL l'espace ProPhoto lineaire,
// ou n'importe quel espace separe-t-il aussi bien ? (le next_measure de l'explorateur)
//
// On lit les trois courbes grises et on les reapplique canal par canal dans TROIS
// espaces : ProPhoto lineaire (le sien), sRGB lineaire, et niveaux sRGB (encode brut).
// Si ProPhoto reste seul au plancher, le mecanisme "canal par canal en ProPhoto
// lineaire" est epingle. Si un autre espace tient aussi, E5 seul prouve "canal par
// canal" mais PAS l'espace (que research/4-5 tranche par ailleurs).
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
const ICI=path.dirname(url.fileURLToPath(import.meta.url));
const MESURES=path.resolve(ICI,"../research/mesures");
const charge=(nom)=>JSON.parse(readFileSync(path.join(MESURES,`${nom}.json`),"utf8"));
const s2l=(c)=>(c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4));
const l2s=(l)=>(l<=0.0031308?l*12.92:1.055*Math.pow(l,1/2.4)-0.055);
const niveau=(lin)=>255*l2s(Math.max(0,Math.min(1,lin)));
const linDeNiveau=(n)=>s2l(n/255);
const PP_XYZ=[[0.7976749,0.1351917,0.0313534],[0.2880402,0.7118741,0.0000857],[0,0,0.82521]];
const XYZ50_SRGB=[[3.1338561,-1.6168667,-0.4906146],[-0.9787684,1.9161415,0.033454],[0.0719453,-0.2289914,1.4052427]];
const ap=(m,v)=>[m[0][0]*v[0]+m[0][1]*v[1]+m[0][2]*v[2],m[1][0]*v[0]+m[1][1]*v[1]+m[1][2]*v[2],m[2][0]*v[0]+m[2][1]*v[1]+m[2][2]*v[2]];
function inverse3(m){const[a,b,c]=m[0],[d,e,f]=m[1],[g,h,i]=m[2];const det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);return[[(e*i-f*h)/det,(c*h-b*i)/det,(b*f-c*e)/det],[(f*g-d*i)/det,(a*i-c*g)/det,(c*d-a*f)/det],[(d*h-e*g)/det,(b*g-a*h)/det,(a*e-b*d)/det]];}
const mulM=(A,B)=>A.map((L)=>[0,1,2].map((j)=>L[0]*B[0][j]+L[1]*B[1][j]+L[2]*B[2][j]));
const PP_VERS_SRGB=mulM(XYZ50_SRGB,PP_XYZ);
const SRGB_VERS_PP=inverse3(PP_VERS_SRGB);
const lisible=(rgb)=>rgb.every((v)=>v>0.5&&v<254.5);
function hls2rgb(h,l,s){if(s===0)return[l,l,l];const m2=l<=0.5?l*(1+s):l+s-l*s;const m1=2*l-m2;const v=(hue)=>{hue=((hue%1)+1)%1;if(hue<1/6)return m1+(m2-m1)*6*hue;if(hue<1/2)return m2;if(hue<2/3)return m1+(m2-m1)*(2/3-hue)*6;return m1;};return[v(h+1/3),v(h),v(h-1/3)];}
function interpolateur(xs,ys){const idx=xs.map((_,i)=>i).sort((a,b)=>xs[a]-xs[b]);const X=idx.map((i)=>xs[i]),Y=idx.map((i)=>ys[i]);const xmin=X[0],xmax=X[X.length-1];const f=(x)=>{if(x<=xmin)return Y[0]+(Y[1]-Y[0])*(x-X[0])/(X[1]-X[0]||1);if(x>=xmax){const n=X.length;return Y[n-2]+(Y[n-1]-Y[n-2])*(x-X[n-2])/(X[n-1]-X[n-2]||1);}let lo=0,hi=X.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(X[m]<=x)lo=m;else hi=m;}return Y[lo]+(Y[hi]-Y[lo])*(x-X[lo])/(X[hi]-X[lo]);};return {f,xmin,xmax};}

// Trois espaces : niveaux sRGB [R,G,B] -> coords de l'espace, et retour -> niveaux.
const ESP={
  "ProPhoto lin":{to:(lvl)=>ap(SRGB_VERS_PP,[linDeNiveau(lvl[0]),linDeNiveau(lvl[1]),linDeNiveau(lvl[2])]),from:(c)=>ap(PP_VERS_SRGB,c).map(niveau)},
  "sRGB lin":    {to:(lvl)=>[linDeNiveau(lvl[0]),linDeNiveau(lvl[1]),linDeNiveau(lvl[2])],from:(c)=>c.map(niveau)},
  "sRGB encode": {to:(lvl)=>[lvl[0]/255,lvl[1]/255,lvl[2]/255],from:(c)=>c.map((v)=>255*Math.max(0,Math.min(1,v)))},
};
function courbes(scene,temoin,esp){
  const xs=[],R=[],G=[],B=[];
  for(let i=0;i<256;i++){const oin=temoin.rampe_rgb[i],oout=scene.rampe_rgb[i];if(!lisible(oin)||!lisible(oout))continue;
    const ci=esp.to(oin);const x=(ci[0]+ci[1]+ci[2])/3;const co=esp.to(oout);xs.push(x);R.push(co[0]);G.push(co[1]);B.push(co[2]);}
  return {R:interpolateur(xs,R),G:interpolateur(xs,G),B:interpolateur(xs,B)};
}
function entrees(scene,temoin){const items=[];for(const champ of["balayage","balayage_l25","balayage_l75","balayage_sat50"]){for(let i=0;i<256;i+=4){const ti=temoin[champ][i],si=scene[champ][i];items.push({lvlIn:hls2rgb(ti[1]/360,ti[3],ti[2]).map((v)=>v*255),meas:hls2rgb(si[1]/360,si[3],si[2]).map((v)=>v*255)});}}for(let p=0;p<temoin.patches.length;p++)items.push({lvlIn:temoin.patches[p],meas:scene.patches[p]});return items;}
const err3=(a,m)=>(Math.abs(a[0]-m[0])+Math.abs(a[1]-m[1])+Math.abs(a[2]-m[2]))/3;

const SCENES=["st-h000","st-h220","st-h300","st-ombres-bleu","st-hl-orange","st-duo","cg-glob-h040","grading-moyens-vert"];
const t4=charge("temoin4");
console.log("erreur cbc (canal-par-canal) selon l'ESPACE de lecture/application, niveaux sRGB");
console.log("scene                | ProPhoto lin | sRGB lin | sRGB encode | horsDom(PP/sL/enc)");
const tot={};for(const k of Object.keys(ESP))tot[k]={s:0,n:0};
for(const nom of SCENES){
  const sc=charge(nom);const items=entrees(sc,t4);
  const row={};const hd={};
  for(const[k,esp]of Object.entries(ESP)){
    const cur=courbes(sc,t4,esp);let s=0,n=0,h=0;
    for(const it of items){if(!lisible(it.meas)||!lisible(it.lvlIn))continue;const ci=esp.to(it.lvlIn);
      if(ci[0]<cur.R.xmin||ci[0]>cur.R.xmax||ci[1]<cur.G.xmin||ci[1]>cur.G.xmax||ci[2]<cur.B.xmin||ci[2]>cur.B.xmax)h++;
      const pred=esp.from([cur.R.f(ci[0]),cur.G.f(ci[1]),cur.B.f(ci[2])]);s+=err3(pred,it.meas);n++;}
    row[k]=s/n;hd[k]=h;tot[k].s+=s;tot[k].n+=n;
  }
  console.log("%s | %s | %s | %s | %s",nom.padEnd(20),
    row["ProPhoto lin"].toFixed(3).padStart(12),row["sRGB lin"].toFixed(3).padStart(8),
    row["sRGB encode"].toFixed(3).padStart(11),`${hd["ProPhoto lin"]}/${hd["sRGB lin"]}/${hd["sRGB encode"]}`);
}
console.log("\nMOYENNE globale ponderee par echantillon :");
for(const k of Object.keys(ESP))console.log("  %s : %s",k.padEnd(14),(tot[k].s/tot[k].n).toFixed(3));
