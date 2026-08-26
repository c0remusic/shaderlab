# 17: Retirer Blinn-Phong, poser un reflet d'environnement fabriqué (verre Poli)

**What to build:** Retirer le highlight ponctuel Blinn-Phong du Poli — mauvais
opérateur : sur une surface lisse le lobe se resserre en un point invisible (notre
bug, reflet à 0,0004). À la place, un **reflet d'environnement fabriqué sans
cubemap ni scène 3D**, modulé par la rampe de Fresnel du ticket 16. La méthode se
choisit à l'œil parmi les trois voies 2D de la recherche : gradient synthétique de
studio, matcap (hughsk/matcap, MIT), ou auto-réflexion de la photo elle-même.

⚠️ **Piège écrit dans la recherche** : sur une surface plate la normale est
constante → sans la rampe de Fresnel (16) ET une micro-variation de normale, tout
reflet fabriqué rend un APLAT. La structure du reflet vient du bord (Fresnel) et du
micro-relief, pas d'une couleur d'environnement uniforme.

**Blocked by:** 16 — le reflet se module sur la rampe de Fresnel, sinon aplat.

**Status:** ready-for-agent

- [ ] Blinn-Phong retiré du chemin Poli.
- [ ] Un reflet d'environnement fabriqué (méthode arrêtée à l'œil avec Antoine), modulé par Fresnel.
- [ ] Pas d'aplat : le reflet porte une structure (bords + micro-normale), vérifié sur une vraie photo.
- [ ] Les 18 références régénérées et **relues à l'œil** ; jugé devant photo par Antoine.
