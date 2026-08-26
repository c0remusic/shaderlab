# 17: Retirer Blinn-Phong, poser un reflet d'environnement fabriqué (verre Poli)

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

**Status:** ready-for-agent

- [ ] Blinn-Phong retiré du chemin Poli.
- [ ] Un reflet d'environnement fabriqué (méthode arrêtée à l'œil avec Antoine), modulé par Fresnel.
- [ ] Pas d'aplat : le reflet porte une structure (bords + micro-normale), vérifié sur une vraie photo.
- [ ] Les 18 références régénérées et **relues à l'œil** ; jugé devant photo par Antoine.
