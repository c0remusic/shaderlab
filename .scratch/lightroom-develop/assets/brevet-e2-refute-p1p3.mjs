// E2 REFUTATION suite — (A) part 3 au BON S (0,80, m=0,35) et non S=1 ; (B) part 1
// residu reel du brevet parametrique a S commun, teinte par teinte.
import { s2l, l2s, SRGB_VERS_PP, ap, PP_XYZ, pentes, hermite, charge } from "./brevet-commun.mjs";
function inverse3(m){const[a,b,c]=m[0],[d,e,f]=m[1],[g,h,i]=m[2];const det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);return[[(e*i-f*h)/det,(c*h-b*i)/det,(b*f-c*e)/det],[(f*g-d*i)/det,(a*i-c*g)/det,(c*d-a*f)/det],[(d*h-e*g)/det,(b*g-a*h)/det,(a*e-b*d)/det]];}
const PP_VERS_SRGB = inverse3(SRGB_VERS_PP);
const W = PP_XYZ[1];
function ppLinEntree(i){const g=s2l(i/255);return ap(SRGB_VERS_PP,[g,g,g]);}
const niv=(lin)=>255*l2s(Math.max(0,Math.min(1,lin)));
function rampeBrevet(hue,S){const s0=pentes(hue,S,W);const out=[];for(let i=0;i<256;i++){const x=ppLinEntree(i)[0];const oc=[0,1,2].map(c=>hermite(x,s0[c],1));out.push({srgb:ap(PP_VERS_SRGB,oc),pp:oc});}return{out,s0};}

// ── (A) Part 3 : le R=0 vient-il de l'ecretage gamut, au VRAI S (0,80) ? ──
console.log("== (A) PART 3 au bon S : s0 min a sat100 est-il ~0 (part3: S=1) ou ~0,35 (part2: S=0,80) ? ==");
const mes = charge("st-ombres-sat100").rampe_rgb;
for (const S of [0.80, 0.999]) {
  const { out, s0 } = rampeBrevet(220, S);
  let clampMod=0, clampMes=0, accord=0;
  for (let i=1;i<255;i++){
    const modNeg = out[i].srgb[0] < 0;         // sRGB lineaire negatif -> export 0
    const mesZero = mes[i][0] < 0.5;
    if (modNeg) clampMod++; if (mesZero) clampMes++;
    if (modNeg === mesZero) accord++;
  }
  console.log(`  S=${S.toFixed(3)}  s0=(${s0.map(v=>v.toFixed(3)).join(",")})  R_PP pente=${s0[0].toFixed(3)}  clamp modele=${clampMod}  clamp mesure=${clampMes}  accord=${accord}/254`);
}
console.log("  Detail au bon S=0,80, niveaux clefs (R_PP dans [0,1] mais R_sRGB<0 => clamp gamut) :");
{
  const { out } = rampeBrevet(220, 0.80);
  for (const i of [8,32,64,96,128,160,200]) {
    console.log(`   niv ${String(i).padStart(3)}: R_PP=${out[i].pp[0].toFixed(4)} (dans[0,1]:${out[i].pp[0]>=0&&out[i].pp[0]<=1}) -> R_sRGBlin=${out[i].srgb[0].toFixed(4)} -> export=${niv(out[i].srgb[0]).toFixed(1)}   R_mesure=${mes[i][0].toFixed(1)}`);
  }
}

// ── (B) Part 1 : residu reel du brevet parametrique (hue+S), S commun 0,55 et 0,51 ──
console.log("\n== (B) PART 1 : residu du brevet PARAMETRIQUE (pas fit libre) par teinte ==");
function residu(pred,m){let se=0,n=0,mx=0;for(let i=1;i<255;i++)for(let c=0;c<3;c++){const e=pred[i].srgb2?pred[i].srgb2[c]:255*l2s(Math.max(0,Math.min(1,pred[i].srgb[c])))-m[i][c];}return null;}
function res(hue,S,m){let se=0,n=0,mx=0;const{out}=rampeBrevet(hue,S);for(let i=1;i<255;i++)for(let c=0;c<3;c++){const e=niv(out[i].srgb[c])-m[i][c];se+=e*e;n++;if(Math.abs(e)>mx)mx=Math.abs(e);}return{rms:Math.sqrt(se/n),max:mx};}
const HUES=[[0,"st-h000"],[220,"st-h220"],[270,"st-h270"],[300,"st-h300"],[330,"st-h330"]];
console.log("  teinte   rms@S=0,55   rms@S=0,51   rms@S* propre   S* propre");
for (const [h,n] of HUES){
  const m=charge(n).rampe_rgb;
  let best={S:0,rms:1e9};
  for(let S=0.2;S<=0.9;S+=0.005){const r=res(h,S,m);if(r.rms<best.rms)best={S,rms:r.rms};}
  console.log(`  h${String(h).padStart(3,"0")}    ${res(h,0.55,m).rms.toFixed(2).padStart(6)}       ${res(h,0.51,m).rms.toFixed(2).padStart(6)}       ${best.rms.toFixed(2).padStart(6)}        ${best.S.toFixed(3)}`);
}
console.log("\n  (claim: 'residu 2.0-2.2 niv a S commun 0.55'. Verdict = colonne rms@S=0,55)");
