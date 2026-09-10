# Le ton en 8 bits : mesuré, et la décision qui en sort

Question d'Antoine, 2026-09-11 : « on peut faire tout ça en 8 ou 12 bits ou
c'est compliqué ? ». Réponse par simulation (la quantification est de
l'arithmétique, pas un phénomène GPU) : six curseurs de ton empilés sur une
rampe de gris 8 bits — Exposition +1 IL, Ombres +60, Noirs −30, Hautes
lumières −50, Contraste +40, courbe en S — opérateurs approchés de Lightroom,
en lumière linéaire.

| Chaîne | niveaux distincts | ombres (entrées 0-63) | plus grand trou |
|---|---|---|---|
| A — flottant d'un bloc, UNE quantification (un seul effet ; ce que fait Lightroom) | 132 / 256 | 42 / 64 | 3 |
| B — texture 8 bits sRGB entre chaque curseur (six effets empilés ; la pile telle quelle) | 109 / 256 | 30 / 64 | **7** |
| C — `rgba16float` entre chaque curseur | 132 / 256 | 42 / 64 | 3 |

Écart A−B : 93 entrées sur 256 diffèrent, jusqu'à 4 niveaux ; 147 fusions
d'entrées voisines en B contre 124 en A.

## Ce que ça dit

1. **La source JPEG plafonne** : même en flottant pur, 132 niveaux — un
   étirement crée des trous que rien ne rebouche. Le 16 bits n'y change rien.
2. **16 bits entre passes = flottant d'un bloc**, à l'identique. Il ne sert
   qu'à séparer les curseurs en plusieurs effets SANS perte.
3. **Six effets séparés en 8 bits** : −25 % de niveaux, trous de 7 — visibles
   dans un ciel dégradé. C'est le seul coût réel, et il vient des arrondis
   empilés, pas des bits.

## Décision (Antoine, « fais comme tu peux », 2026-09-11)

- **8 bits, invariant sRGB-par-le-format intact.** Pas de chemin flottant.
- **Tout ce qui ÉTIRE le ton vit dans UN SEUL effet**, calculé en flottant
  dans sa passe finale, quantifié une fois : balance des blancs relative,
  Exposition, Contraste, Hautes lumières, Ombres, Blancs, Noirs, Texture,
  Clarté, Correction du voile, Vibrance, Saturation, ET la courbe paramétrique
  (4 régions + 3 séparations) — le panneau « Réglages de base » et la moitié
  paramétrique de « Courbe des tonalités ». Ticket `issues/02`.
- **Ce qui n'étire pas le ton reste un effet séparé** sans dommage mesurable :
  Étalonnage (matrice, `issues/01`), HSL / N&B (rotation de teinte, dose par
  bande), Color Grading, Détail (netteté, bruit), Vignettage. Une passe 8 bits
  entre eux et le ton coûte un arrondi, pas un étirement.
- **12 bits n'existe pas** en WebGPU (8 unorm · `rgb10a2unorm` linéaire, pire
  que 8 bits sRGB dans les ombres, sans variante `-srgb` · 16 float). Le choix
  réel était 8 sRGB ou 16 float ; la mesure dit qu'on n'a pas besoin du second.

## Script (reproductible, Python + numpy)

```python
import numpy as np
def srgb2lin(c):
    c=np.clip(c,0,1); return np.where(c<=0.04045, c/12.92, ((c+0.055)/1.055)**2.4)
def lin2srgb(l):
    l=np.clip(l,0,1); return np.where(l<=0.0031308, l*12.92, 1.055*l**(1/2.4)-0.055)
def q8(l): return srgb2lin(np.round(lin2srgb(l)*255)/255)      # écriture 8 bits sRGB + relecture
def q16f(l): return np.float16(l).astype(np.float64)           # rgba16float
def exposure(l, ev): return np.clip(l*2**ev, 0, 1)
def contrast(l, k): s=lin2srgb(l); s=0.5+(s-0.5)*(1+k); return srgb2lin(np.clip(s,0,1))
def shadows(l, k): s=lin2srgb(l); w=(1-s)**2; return srgb2lin(np.clip(s + k*0.5*w*(1-s), 0, 1))
def blacks(l, k): s=lin2srgb(l); w=(1-s)**4; return srgb2lin(np.clip(s + k*0.4*w, 0, 1))
def highlights(l, k): s=lin2srgb(l); w=s**2; return srgb2lin(np.clip(s + k*0.5*w*(1-s), 0, 1))
def curve_s(l, k): s=lin2srgb(l); s=s-k*0.15*np.sin(2*np.pi*s); return srgb2lin(np.clip(s,0,1))
chain=[lambda l: exposure(l,1.0), lambda l: shadows(l,0.6), lambda l: blacks(l,-0.3),
       lambda l: highlights(l,-0.5), lambda l: contrast(l,0.4), lambda l: curve_s(l,1.0)]
ramp=srgb2lin(np.arange(256)/255)
def run(quant):
    l=ramp.copy()
    for f in chain:
        l=f(l)
        if quant: l=quant(l)
    return np.round(lin2srgb(l)*255).astype(int)
for nom,q in (("A flottant",None),("B 8 bits",q8),("C 16f",q16f)):
    o=run(q); u=np.unique(o); g=np.diff(u)
    print(nom, len(u), len(np.unique(o[:64])), g.max())
```

Les opérateurs sont des APPROXIMATIONS (Lightroom n'est pas public) : ils
étirent aux mêmes endroits et dans les mêmes proportions que les siens, ce qui
suffit pour compter des trous. Le rapport A/B ne dépend pas de leur forme
exacte, il dépend du nombre d'arrondis.
