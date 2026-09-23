// REFUTATION E5 — la puissance du test canal-par-canal vient-elle des echantillons SATURES ?
//
// cbc (canal-par-canal) et lumA/lumG (pilote-luminance) sont IDENTIQUES sur un pixel
// NEUTRE par construction : pour un neutre, ppin[c]=x et Y=x, donc cbc(x)=lumA(x). Toute
// la puissance discriminante vient donc des echantillons OU la valeur d'un canal s'ecarte
// de la luminance du pixel — c.-a-d. les couleurs SATUREES. Or 185-217 des 268 items sont
// ecretes. Ce script mesure :
//   (1) le vrai PLANCHER : cbc sur une scene IDENTITE (temoin predit par temoin) ;
//   (2) la distribution de saturation des echantillons SURVIVANTS ;
//   (3) l'erreur cbc / lumA / lumG PAR BANDE de saturation — le test garde-t-il sa
//       puissance a haute saturation, ou les survivants sont-ils quasi neutres ?
//   (4) la structure du residu cbc : correle a la saturation (systematique) ou bruit ?
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const ICI = path.dirname(url.fileURLToPath(import.meta.url));
const MESURES = path.resolve(ICI, "../research/mesures");
const charge = (nom) => JSON.parse(readFileSync(path.join(MESURES, `${nom}.json`), "utf8"));

const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const l2s = (l) => (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);
const niveau = (lin) => 255 * l2s(Math.max(0, Math.min(1, lin)));
const linDeNiveau = (n) => s2l(n / 255);

const PP_XYZ = [[0.7976749, 0.1351917, 0.0313534], [0.2880402, 0.7118741, 0.0000857], [0, 0, 0.82521]];
const XYZ50_SRGB = [[3.1338561, -1.6168667, -0.4906146], [-0.9787684, 1.9161415, 0.033454], [0.0719453, -0.2289914, 1.4052427]];
const ap = (m, v) => [m[0][0]*v[0]+m[0][1]*v[1]+m[0][2]*v[2], m[1][0]*v[0]+m[1][1]*v[1]+m[1][2]*v[2], m[2][0]*v[0]+m[2][1]*v[1]+m[2][2]*v[2]];
function inverse3(m) {
  const [a,b,c]=m[0],[d,e,f]=m[1],[g,h,i]=m[2];
  const det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
  return [[(e*i-f*h)/det,(c*h-b*i)/det,(b*f-c*e)/det],[(f*g-d*i)/det,(a*i-c*g)/det,(c*d-a*f)/det],[(d*h-e*g)/det,(b*g-a*h)/det,(a*e-b*d)/det]];
}
const mulM=(A,B)=>A.map((L)=>[0,1,2].map((j)=>L[0]*B[0][j]+L[1]*B[1][j]+L[2]*B[2][j]));
const PP_VERS_SRGB=mulM(XYZ50_SRGB,PP_XYZ);
const SRGB_VERS_PP=inverse3(PP_VERS_SRGB);
const W_PP=PP_XYZ[1];
const lisible=(rgb)=>rgb.every((v)=>v>0.5&&v<254.5);
const levelToPP=(lvl)=>ap(SRGB_VERS_PP,[linDeNiveau(lvl[0]),linDeNiveau(lvl[1]),linDeNiveau(lvl[2])]);
const ppToLevel=(pp)=>ap(PP_VERS_SRGB,pp).map(niveau);

function hls2rgb(h,l,s){if(s===0)return[l,l,l];const m2=l<=0.5?l*(1+s):l+s-l*s;const m1=2*l-m2;const v=(hue)=>{hue=((hue%1)+1)%1;if(hue<1/6)return m1+(m2-m1)*6*hue;if(hue<1/2)return m2;if(hue<2/3)return m1+(m2-m1)*(2/3-hue)*6;return m1;};return[v(h+1/3),v(h),v(h-1/3)];}

function interpolateur(xs,ys){
  const idx=xs.map((_,i)=>i).sort((a,b)=>xs[a]-xs[b]);
  const X=idx.map((i)=>xs[i]),Y=idx.map((i)=>ys[i]);
  const xmin=X[0],xmax=X[X.length-1];
  const f=(x)=>{if(x<=xmin)return Y[0]+(Y[1]-Y[0])*(x-X[0])/(X[1]-X[0]||1);if(x>=xmax){const n=X.length;return Y[n-2]+(Y[n-1]-Y[n-2])*(x-X[n-2])/(X[n-1]-X[n-2]||1);}let lo=0,hi=X.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(X[m]<=x)lo=m;else hi=m;}return Y[lo]+(Y[hi]-Y[lo])*(x-X[lo])/(X[hi]-X[lo]);};
  return {f,xmin,xmax};
}
function courbes(scene,temoin){
  const xs=[],R=[],G=[],B=[];
  for(let i=0;i<256;i++){
    const oin=temoin.rampe_rgb[i],oout=scene.rampe_rgb[i];
    if(!lisible(oin)||!lisible(oout))continue;
    const ppin=levelToPP(oin);const x=(ppin[0]+ppin[1]+ppin[2])/3;const ppout=levelToPP(oout);
    xs.push(x);R.push(ppout[0]);G.push(ppout[1]);B.push(ppout[2]);
  }
  return {R:interpolateur(xs,R),G:interpolateur(xs,G),B:interpolateur(xs,B)};
}
function entreesColorees(scene,temoin){
  const items=[];
  for(const champ of ["balayage","balayage_l25","balayage_l75","balayage_sat50"]){
    for(let i=0;i<256;i+=4){
      const ti=temoin[champ][i],si=scene[champ][i];
      const inRgb=hls2rgb(ti[1]/360,ti[3],ti[2]).map((v)=>v*255);
      const outRgb=hls2rgb(si[1]/360,si[3],si[2]).map((v)=>v*255);
      items.push({src:`${champ}@${Math.round(ti[0])}`,lvlIn:inRgb,meas:outRgb});
    }
  }
  for(let p=0;p<temoin.patches.length;p++)items.push({src:`patch${p}`,lvlIn:temoin.patches[p],meas:scene.patches[p]});
  return items;
}

// "saturation" d'un item = ecart max entre un canal ProPhoto et la luminance Y ProPhoto.
// C'est exactement ce qui separe cbc de lumA (cbc indexe par ppin[c], lumA par Y).
function ecartCanalLum(lvlIn){
  const ppin=levelToPP(lvlIn);
  const Y=W_PP[0]*ppin[0]+W_PP[1]*ppin[1]+W_PP[2]*ppin[2];
  return Math.max(...ppin.map((c)=>Math.abs(c-Y)));
}

function preds(lvlIn,cur){
  const ppin=levelToPP(lvlIn);
  const Y=W_PP[0]*ppin[0]+W_PP[1]*ppin[1]+W_PP[2]*ppin[2];const xn=Y;
  const cbc=ppToLevel([cur.R.f(ppin[0]),cur.G.f(ppin[1]),cur.B.f(ppin[2])]);
  const gout=[cur.R.f(xn),cur.G.f(xn),cur.B.f(xn)];
  const lumA=ppToLevel([ppin[0]+(gout[0]-xn),ppin[1]+(gout[1]-xn),ppin[2]+(gout[2]-xn)]);
  const lumG=ppToLevel([ppin[0]*gout[0]/xn,ppin[1]*gout[1]/xn,ppin[2]*gout[2]/xn]);
  return {cbc,lumA,lumG};
}
const err3=(a,m)=>(Math.abs(a[0]-m[0])+Math.abs(a[1]-m[1])+Math.abs(a[2]-m[2]))/3;

const SCENES=["st-h000","st-h220","st-h300","st-ombres-bleu","st-hl-orange","st-duo","cg-glob-h040","grading-moyens-vert"];
const t4=charge("temoin4");

// (1) PLANCHER : identite (temoin4 predit par temoin4). cbc devrait etre au bruit d'interp.
{
  const cur=courbes(t4,t4);const items=entreesColorees(t4,t4);
  let n=0,sc=0,sa=0,sg=0;
  for(const it of items){if(!lisible(it.meas)||!lisible(it.lvlIn))continue;const p=preds(it.lvlIn,cur);n++;sc+=err3(p.cbc,it.meas);sa+=err3(p.lumA,it.meas);sg+=err3(p.lumG,it.meas);}
  console.log("(1) PLANCHER identite temoin4>temoin4 : n=%d  cbc=%s  lumA=%s  lumG=%s",n,(sc/n).toFixed(3),(sa/n).toFixed(3),(sg/n).toFixed(3));
  console.log("    (les trois DOIVENT etre au plancher : sur l'identite aucun modele ne peut se tromper)");
}

// (2)+(3) distribution de saturation ET erreur par bande, agregees sur les 8 scenes reelles.
const BANDES=[[0,0.02],[0.02,0.05],[0.05,0.10],[0.10,0.20],[0.20,1.0]];
const acc=BANDES.map(()=>({n:0,cbc:0,lumA:0,lumG:0}));
console.log("\n(3) erreur PAR BANDE d'ecart canal-luminance (ProPhoto), agregee sur les 8 scenes");
console.log("    bande ecart      | n   | cbc    | lumA   | lumG   | ratio lumA/cbc");
for(const nom of SCENES){
  const sc=charge(nom);const cur=courbes(sc,t4);const items=entreesColorees(sc,t4);
  for(const it of items){
    if(!lisible(it.meas)||!lisible(it.lvlIn))continue;
    const d=ecartCanalLum(it.lvlIn);const p=preds(it.lvlIn,cur);
    const bi=BANDES.findIndex(([lo,hi])=>d>=lo&&d<hi);if(bi<0)continue;
    acc[bi].n++;acc[bi].cbc+=err3(p.cbc,it.meas);acc[bi].lumA+=err3(p.lumA,it.meas);acc[bi].lumG+=err3(p.lumG,it.meas);
  }
}
for(let i=0;i<BANDES.length;i++){
  const a=acc[i];if(a.n===0){console.log("    [%s,%s) vide",BANDES[i][0],BANDES[i][1]);continue;}
  const c=a.cbc/a.n,la=a.lumA/a.n,lg=a.lumG/a.n;
  console.log("    [%s,%s)".padEnd(18)+" | %s | %s | %s | %s | x%s",
    BANDES[i][0].toFixed(2),BANDES[i][1].toFixed(2),String(a.n).padStart(3),
    c.toFixed(3).padStart(6),la.toFixed(3).padStart(6),lg.toFixed(3).padStart(6),(la/c).toFixed(1));
}

// (4) sur les survivants LES PLUS SATURES (bande >=0.10), profil detaille par scene :
//     combien de survivants > 0.10 par scene, et l'erreur cbc/lumA/lumG dessus.
console.log("\n(4) survivants FORTEMENT satures (ecart canal-lum >= 0.10) par scene");
console.log("    scene                | n>=.10 | cbc    | lumA   | lumG   | maxEcart");
for(const nom of SCENES){
  const sc=charge(nom);const cur=courbes(sc,t4);const items=entreesColorees(sc,t4);
  let n=0,c=0,la=0,lg=0,mx=0;
  for(const it of items){
    if(!lisible(it.meas)||!lisible(it.lvlIn))continue;
    const d=ecartCanalLum(it.lvlIn);if(d<0.10)continue;
    const p=preds(it.lvlIn,cur);n++;c+=err3(p.cbc,it.meas);la+=err3(p.lumA,it.meas);lg+=err3(p.lumG,it.meas);mx=Math.max(mx,d);
  }
  if(n===0){console.log("    %s |   0    | (aucun survivant fortement sature)",nom.padEnd(20));continue;}
  console.log("    %s | %s | %s | %s | %s | %s",nom.padEnd(20),String(n).padStart(6),
    (c/n).toFixed(3).padStart(6),(la/n).toFixed(3).padStart(6),(lg/n).toFixed(3).padStart(6),mx.toFixed(3));
}
