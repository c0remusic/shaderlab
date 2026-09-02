# 17: Retirer Blinn-Phong, poser un reflet d'environnement fabriqué (verre Poli)

> ⚠️ **2026-08-27 — LE CHOIX DE VOIE SE PREND DÉSORMAIS SUR LES FEUILLES SEULES.**
> Les cinq matières de PAVÉ sont retirées (ADR-0021, quatrième refus d'usage), et
> la planche de variantes liée plus bas montre un **Pavé nuage** : ses vignettes
> de pavé sont périmées, celles de feuille valent toujours. La décision porte sur
> les neuf matières restantes ; refaire la planche sur une feuille si le pavé y
> était le cas décisif. Les deux lignes citées ci-dessous ont bougé avec le
> retrait : la rampe de Fresnel est en `glass.ts:832`, la couleur fixe qu'il
> s'agit de remplacer en `glass.ts:833`.

**What to build:** Retirer le highlight ponctuel Blinn-Phong du Poli — mauvais
opérateur : sur une surface lisse le lobe se resserre en un point invisible (notre
bug, reflet à 0,0004). À la place, un **reflet d'environnement fabriqué sans
cubemap ni scène 3D**, modulé par la rampe de Fresnel EXISTANTE (`glass.ts:889`,
`F = 0.04 + 0.96·(1−cosi)⁵` — depuis le premier commit du verre, voir le constat
du ticket 16). La cible du remplacement est `glass.ts:890` : le mélange va
aujourd'hui vers une couleur FIXE `vec3(0.86, 0.89, 0.95)`, et c'est CE gel-là
qui fabrique le voile plat. La méthode se
choisit à l'œil parmi les trois voies 2D de la recherche : gradient synthétique de
studio, matcap (hughsk/matcap, MIT), ou auto-réflexion de la photo elle-même.

⚠️ **Piège écrit dans la recherche** : sur une surface plate la normale est
constante → sans la rampe de Fresnel (16) ET une micro-variation de normale, tout
reflet fabriqué rend un APLAT. La structure du reflet vient du bord (Fresnel) et du
micro-relief, pas d'une couleur d'environnement uniforme.

**Blocked by:** None — le 16 est clos en CONSTAT le 2026-08-26 : la rampe de
Fresnel existe déjà (`glass.ts:889`), ce ticket est la première vraie tranche de
code de la chaîne verre. La modulation par la rampe reste la règle, sinon aplat.

**Status:** ready-for-human — **le choix de la voie est PRÊT À TRANCHER SUR
IMAGES** (2026-08-26) :
<https://claude.ai/code/artifact/842e4df1-7f91-4a33-ab5b-b4ff74a7ee04> — les
trois voies PROTOTYPÉES au même site du shader (`glass.ts:890`, tout le reste
inchangé), rendues sur Poli et Pavé nuage à 720 px, témoin compris. Reco :
**l'auto-réflexion (C)** — le reflet suit la photo, les noirs restent denses
(le voile disparaît vraiment), aucun asset ni couleur arbitraire ; réserve : un
reflet screen-space local ne fabrique pas de « fenêtre de studio », A s'y
combine si besoin. Les prototypes n'ont PAS été commités (`glass.ts` restauré) ;
régénérables : `assets/planche-17-rendu.mjs` (éditer le site, `npx tsc
--noEmit`, rendre, restaurer) puis `assets/planche-17-assemble.mjs`.

- [ ] **[Antoine]** Choisir la voie (A studio / B matcap / C auto-réflexion /
      une combinaison) sur la planche.
- [ ] Blinn-Phong retiré du chemin Poli.
- [ ] Un reflet d'environnement fabriqué (la voie choisie), modulé par Fresnel.
- [ ] Pas d'aplat : le reflet porte une structure (bords + micro-normale), vérifié sur une vraie photo.
- [ ] Les 18 références régénérées et **relues à l'œil** ; jugé devant photo par Antoine.
