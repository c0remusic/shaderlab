# 15 — Levier perf lensBlur (mipmap / scale adaptatif)

**What to build:** SI le ticket 14 confirme que la cible 60 souple n'est pas
tenue, appliquer le levier — **pyramide de mips sur la source de collecte** (comme
`glass`, brique `mipmapGenerator.ts` déjà sur master) ou **scale de collecte
adaptatif** au rayon — sans abîmer le bokeh (qualité d'abord, décision du
grilling). ⚠️ La source de collecte est une cible de ping-pong recréée chaque
frame : le coût de la mipmapper PAR IMAGE est à mesurer, pas à supposer (le verdict
mipmap de `texture` ne le couvre pas). Pistes condamnées à ne pas refaire :
réduire le nombre de taps, réécrire en dérivées analytiques.

**Blocked by:** 14 — on ne code pas un levier avant d'avoir mesuré le besoin (leçon glass).

**Status:** ready-for-agent
**Type:** task

- [ ] Le levier retenu est mesuré : gain réel en production vs coût de la mipmapper par frame.
- [ ] Bokeh propre préservé — les 5 références de pixels de `lensBlur` régénérées et **relues à l'œil**.
- [ ] Cadence améliorée vers 60 souple, OU verdict chiffré que 60 n'est pas atteignable sans concession de qualité.
