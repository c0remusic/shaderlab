// REFUTATION E5 (suite) — le "lineaire" de "ProPhoto lineaire" est-il TESTE par le
// test canal-par-canal, ou seulement les PRIMAIRES ProPhoto ? Un transfert par canal
// (gamma) est ABSORBE dans la courbe lue+reappliquee par canal, donc ProPhoto gamma 1,8
// devrait tomber au MEME plancher que ProPhoto lineaire. Si oui : E5 epingle les
// PRIMAIRES ProPhoto (matrice, adaptation D50), pas la courbe de transfert.
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
const PPvS=mulM(XYZ50_SRGB,PP_XYZ),SvPP=inverse3(PPvS);
const lisible=(rgb)=>rgb.every((v)=>v>0.5&&v<254.5);
function hls2rgb(h,l,s){if(s===0)return[l,l,l];const m2=l<=0.5?l*(1+s):l+s-l*s;const m1=2*l-m2;const v=(hue)=>{hue=((hue%1)+1)%1;if(hue<1/6)return m1+(m2-m1)*6*hue;if(hue<1/2)return m2;if(hue<2/3)return m1+(m2-m1)*(2/3-hue)*6;return m1;};return[v(h+1/3),v(h),v(h-1/3)];}
function interp(xs,ys){const idx=xs.map((_,i)=>i).sort((a,b)=>xs[a]-xs[b]);const X=idx.map((i)=>xs[i]),Y=idx.map((i)=>ys[i]);const a=X[0],b=X[X.length-1];return{f:(x)=>{if(x<=a)return Y[0]+(Y[1]-Y[0])*(x-X[0])/(X[1]-X[0]||1);if(x>=b){const n=X.length;return Y[n-2]+(Y[n-1]-Y[n-2])*(x-X[n-2])/(X[n-1]-X[n-2]||1);}let lo=0,hi=X.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(X[m]<=x)lo=m;else hi=m;}return Y[lo]+(Y[hi]-Y[lo])*(x-X[lo])/(X[hi]-X[lo]);},xmin:a,xmax:b};}
const g18=(v)=>Math.sign(v)*Math.pow(Math.abs(v),1/1.8), g18i=(v)=>Math.sign(v)*Math.pow(Math.abs(v),1.8);
const to=(lvl)=>ap(SvPP,[linDeNiveau(lvl[0]),linDeNiveau(lvl[1]),linDeNiveau(lvl[2])]).map(g18);
const from=(c)=>ap(PPvS,c.map(g18i)).map(niveau);
function courbes(sc,t){const xs=[],R=[],G=[],B=[];for(let i=0;i<256;i++){const oin=t.rampe_rgb[i],oo=sc.rampe_rgb[i];if(!lisible(oin)||!lisible(oo))continue;const ci=to(oin);xs.push((ci[0]+ci[1]+ci[2])/3);const co=to(oo);R.push(co[0]);G.push(co[1]);B.push(co[2]);}return{R:interp(xs,R),G:interp(xs,G),B:interp(xs,B)};}
function ent(sc,t){const it=[];for(const c of["balayage","balayage_l25","balayage_l75","balayage_sat50"])for(let i=0;i<256;i+=4){const ti=t[c][i],si=sc[c][i];it.push({lvlIn:hls2rgb(ti[1]/360,ti[3],ti[2]).map((v)=>v*255),meas:hls2rgb(si[1]/360,si[3],si[2]).map((v)=>v*255)});}for(let p=0;p<t.patches.length;p++)it.push({lvlIn:t.patches[p],meas:sc.patches[p]});return it;}
const err3=(a,m)=>(Math.abs(a[0]-m[0])+Math.abs(a[1]-m[1])+Math.abs(a[2]-m[2]))/3;
const t4=charge("temoin4");let S=0,N=0;
console.log("cbc en ProPhoto GAMMA 1.8 (memes primaires, transfert par canal 1/1.8) :");
for(const nom of["st-h000","st-h220","st-h300","st-ombres-bleu","st-hl-orange","st-duo","cg-glob-h040","grading-moyens-vert"]){
  const sc=charge(nom);const cur=courbes(sc,t4);const items=ent(sc,t4);let s=0,n=0;
  for(const it of items){if(!lisible(it.meas)||!lisible(it.lvlIn))continue;const ci=to(it.lvlIn);s+=err3(from([cur.R.f(ci[0]),cur.G.f(ci[1]),cur.B.f(ci[2])]),it.meas);n++;}
  console.log("  %s : %s",nom.padEnd(20),(s/n).toFixed(3));S+=s;N+=n;}
console.log("  MOYENNE : %s  (ProPhoto lin = 0.489 ; sRGB = 8.042)",(S/N).toFixed(3));
