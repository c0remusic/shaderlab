# Sélection : en avons-nous besoin, ou notre position est-elle meilleure ?

Type: grilling
Status: open
Parent: ../map.md

## Le constat

Affinity a des SÉLECTIONS **et** des masques :

```
RasterSelectionBrushTool · RefineSelectionTool · SelectionRasterNode
GrowShrinkSelection · OutlineSelection · FeatherSelectionTool
SmoothSelectionTool · FreeHandSelectionTool · RectangularMarqueeTool
EllipticalMarqueeTool · RowMarqueeTool · ColumnMarqueeTool
ObjectSelectionTool · RasterFloodSelectTool (baguette magique) · QuickMask
```

**Nous n'avons AUCUNE notion de sélection.** On peint un masque de calque, point.

## Ce qui est à trancher, et ce n'est pas « faut-il les ajouter »

Une sélection est un masque TEMPORAIRE, sans calque, partagé par tous les
outils. Notre modèle dit « tout est un masque de calque ».

**C'est peut-être meilleur, et personne ne l'a jamais écrit.** Une sélection est
un ÉTAT CACHÉ : elle borne les opérations suivantes sans se voir dans la pile,
et c'est une des causes classiques de « pourquoi mon pinceau ne peint pas ».
Notre modèle rend cet état visible, nommé et annulable.

## Les questions à se poser

- Quel geste concret une sélection débloque-t-elle qu'un masque de calque ne
  débloque pas ? La réponse évidente est « agir sur PLUSIEURS calques à la
  fois » — est-ce un besoin réel ici ?
- Le `QuickMask` d'Affinity est l'aveu que les deux modèles convergent : peindre
  une sélection COMME un masque. Pourquoi ont-ils gardé les deux ?
- ⚠️ **Une sélection sert aussi à COPIER, RECADRER, EXPORTER une région.** Ces
  gestes-là n'ont rien à voir avec le masquage, et nous ne les avons pas non
  plus. **Le besoin est peut-être là, et pas dans le masque** — auquel cas ce
  ticket répond à côté de sa propre question.
- Le recadrage est déjà modelé (`canvasFrame.ts`, ticket 28 du palier
  précédent) : une sélection rectangulaire et un cadre de recadrage sont-ils la
  même chose vue deux fois ?

## Ce qui prouve que le ticket est fini

Un ADR, dans un sens ou dans l'autre. Une position écrite vaut mieux qu'une
absence par défaut — c'est exactement ce que ce ticket existe pour produire.
