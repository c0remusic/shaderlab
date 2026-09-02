# 17: Retirer Blinn-Phong, poser un reflet d'environnement fabriqué (verre Poli)

> ⚠️ **2026-08-27 — LE CHOIX DE VOIE SE PREND DÉSORMAIS SUR LES FEUILLES SEULES.**
> Les cinq matières de PAVÉ sont retirées (ADR-0021, quatrième refus d'usage), et
> la planche de variantes liée plus bas montre un **Pavé nuage** : ses vignettes
> de pavé sont périmées, celles de feuille valent toujours. La décision porte sur
> les neuf matières restantes ; refaire la planche sur une feuille si le pavé y
> était le cas décisif. Les deux lignes citées ci-dessous ont bougé avec le
> retrait : la rampe de Fresnel est en `glass.ts:832`, la couleur fixe qu'il
> s'agit de remplacer en `glass.ts:833`.
>
> ⚠️ **ET ELLES ONT RE-BOUGÉ avec la livraison du 2026-08-27** : la rampe est en
> `glass.ts:848`, et la couleur fixe n'existe plus — le matcap qui la remplace
> occupe `glass.ts:878-883`. Tout numéro de ligne écrit plus bas dans ce fichier
> date d'AVANT et ne doit plus servir de repère ; le bloc FRESNEL se retrouve par
> son titre, pas par son rang.

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

**Status:** ready-for-human — **VOIE B TRANCHÉE ET LIVRÉE EN CODE le 2026-08-27 ;
reste le JUGEMENT sur captures.**

## Ce qui est livré (2026-08-27)

Antoine a choisi la **voie B — matcap procédural** sur la planche, contre la reco
C (auto-réflexion) : sa décision, actée. Le site du mélange
(`glass.ts`, bloc FRESNEL) ne va plus vers `vec3(0.86, 0.89, 0.95)` gelé mais
vers une **sphère d'environnement évaluée par la NORMALE** — ton d'ambiance +
source principale large (`key`, exposant 3) + liseré rasant (`rim`, exposant 6) :

```wgsl
let key = pow(clamp(dot(N, normalize(vec3<f32>(-0.45, -0.55, 0.70))), 0.0, 1.0), 3.0);
let rim = pow(clamp(dot(N, normalize(vec3<f32>(0.55, 0.35, 0.45))), 0.0, 1.0), 6.0);
let env = srgb_to_linear3(vec3<f32>(0.42, 0.44, 0.48))
  + srgb_to_linear3(vec3<f32>(1.0, 0.99, 0.94)) * key * 0.9
  + srgb_to_linear3(vec3<f32>(0.75, 0.82, 0.95)) * rim * 0.5;
c = mix(c, env, F * 0.55);
```

**Une seule évolution du chemin verre**, comme le veut la règle du backlog : la
rampe `F`, son facteur `0,55`, le Blinn-Phong, l'absorption et la dispersion sont
INTACTS. **Aucun paramètre nouveau** — le matcap est fonction de `N` seule, ALU
pur, **zéro lecture de texture** (2 `dot`, 2 `clamp`, 2 `pow`, 3 décodages sRGB
de constantes, 2 mul + 2 add de `vec3`).

Le mélange restant modulé par `F` : sur le **Poli** quasi plat (`F` ≈ 0,04
partout) le matcap est un voile FAIBLE, mais qui **suit désormais la normale**,
micro-relief compris, au lieu d'être le même ton en chaque pixel ; sur les
matières **texturées** (Cannelé, Martelé, Cathédrale…) les normales varient fort
et le reflet s'y **structure** tout seul. C'est l'inverse du piège de la
recherche : la structure vient du bord et du micro-relief, pas de la couleur.

Gates verts : `npx tsc --noEmit`, `npm run lint`, `npm run test` (140 fichiers /
2060 tests, naga compris), `npm run test-storybook` (33 / 333). Le test
`glass.test.ts` « absorption LINÉAIRE / reflet PERCEPTUEL » a été réécrit : il ne
gèle plus un ton, il vérifie que **chaque** ton de `env` passe par
`srgb_to_linear3` — geler les valeurs interdirait de régler le matcap.

Planche d'origine (les trois voies prototypées au même site) :
<https://claude.ai/code/artifact/842e4df1-7f91-4a33-ab5b-b4ff74a7ee04> — les
trois voies PROTOTYPÉES au même site du shader (`glass.ts:890`, tout le reste
inchangé), rendues sur Poli et Pavé nuage à 720 px, témoin compris. Reco :
**l'auto-réflexion (C)** — le reflet suit la photo, les noirs restent denses
(le voile disparaît vraiment), aucun asset ni couleur arbitraire ; réserve : un
reflet screen-space local ne fabrique pas de « fenêtre de studio », A s'y
combine si besoin. Les prototypes n'ont PAS été commités (`glass.ts` restauré) ;
régénérables : `assets/planche-17-rendu.mjs` (éditer le site, `npx tsc
--noEmit`, rendre, restaurer) puis `assets/planche-17-assemble.mjs`.

- [x] **[Antoine]** Choisir la voie (A studio / B matcap / C auto-réflexion /
      une combinaison) sur la planche. — **voie B**, le 2026-08-27, contre la
      reco C.
- [ ] ~~Blinn-Phong retiré du chemin Poli.~~ — **DIFFÉRÉ, délibérément.** Une
      seule évolution du chemin verre à la fois : cette tranche ne change QUE la
      couleur d'environnement. Le Blinn-Phong reste en place (émission additive
      séparée, quasi inerte sur le Poli par géométrie, utile sur les flancs des
      autres matières) ; **son sort se juge sur les captures de cette tranche**,
      une fois le matcap vu sur photo.
- [x] Un reflet d'environnement fabriqué (la voie choisie), modulé par Fresnel.
      — matcap procédural, voie B, livré le 2026-08-27 (bloc ci-dessus).
- [x] Pas d'aplat : le reflet porte une structure (bords + micro-normale),
      vérifié sur une vraie photo — planche avant/après du 2026-08-27
      (<https://claude.ai/code/artifact/db9b4d38-9190-44ab-9bb5-0a5368d6270a>,
      Poli · Cannelé · Martelé sur photo-1) : sur le Martelé, le réseau de
      cellules se lit dans les OMBRES, qui étaient des aplats morts avant.
- [x] Les **13** références du verre régénérées et **relues à l'œil** le
      2026-08-27 (commit `30dfd5b`) ; seules elles ont bougé, vérifié par
      `git status` après un `--update` global ; `test:render` complet vert.
      ⚠️ **13 et non 18** : les cinq références de Pavé sont parties avec
      les matières (ADR-0021).
- [ ] **[Antoine]** Jugé devant photo : la planche avant/après ci-dessus. Si
      les lobes sont à régler (direction, chaleur, force), ça se fait sur
      captures ; le sort du Blinn-Phong (différé) se tranche au même regard.
