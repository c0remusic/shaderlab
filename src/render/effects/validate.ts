import type { DisplayCondition, EffectModule, EffectParam } from "./types";
import { MAX_EFFECT_PARAMS } from "../shaderCompose";

/**
 * Valide une condition d'affichage (`DisplayCondition`), quel qu'en soit le
 * porteur : un contrôle canvas, un paramètre, une section.
 *
 * FONCTION COMMUNE, PAS TROIS COPIES. Cette validation ne servait qu'à
 * `CanvasControl.visibleWhen` ; deux porteurs se sont ajoutés le 2026-08-05.
 * Une copie par porteur aurait dérivé sans que rien ne rougisse — une condition
 * mal validée ne casse aucun rendu, elle masque un contrôle, et un contrôle
 * absent ne se plaint pas.
 *
 * `contexte` ne sert qu'au message : c'est lui qui dit à l'auteur de l'effet
 * LEQUEL de ses porteurs est fautif.
 */
function validerConditionDAffichage(
  effectId: string,
  params: Map<string, EffectParam>,
  condition: DisplayCondition,
  contexte: string,
): void {
  const cible = params.get(condition.param);
  if (!cible) {
    throw new Error(`Effet "${effectId}" : ${contexte} désigne le paramètre absent "${condition.param}".`);
  }
  const choix = cible.choices;
  if (!choix) {
    throw new Error(`Effet "${effectId}" : ${contexte} doit viser un paramètre choices.`);
  }
  const attendus = Array.isArray(condition.equals) ? condition.equals : [condition.equals];
  if (attendus.length === 0 || new Set(attendus).size !== attendus.length) {
    throw new Error(`Effet "${effectId}" : ${contexte} doit viser au moins un index de choix distinct.`);
  }
  const invalide = attendus.find((valeur) => !Number.isInteger(valeur) || valeur < 0 || valeur >= choix.length);
  if (invalide !== undefined) {
    throw new Error(`Effet "${effectId}" : ${contexte} vise l'index de choix invalide ${invalide}.`);
  }
}

/**
 * Fail-fast au chargement du registry. Sans cette validation, un effet
 * déclarant plus de MAX_EFFECT_PARAMS paramètres était TRONQUÉ en silence :
 * l'écriture hors-borne d'un Float32Array est un no-op, le shader lisait 0
 * pour les paramètres excédentaires — contraire au principe fail-fast du
 * projet.
 */
export function validateEffect(effect: EffectModule): void {
  if (effect.params.length > MAX_EFFECT_PARAMS) {
    throw new Error(
      `Effet "${effect.id}" : ${effect.params.length} paramètres déclarés, ` +
        `maximum ${MAX_EFFECT_PARAMS} (taille du uniform array<f32, ${MAX_EFFECT_PARAMS}> du shader). ` +
        `Élargir MAX_EFFECT_PARAMS et le header WGSL ensemble si nécessaire.`
    );
  }

  const params = new Map(effect.params.map((param) => [param.name, param]));

  // Paramètres à choix discret (`EffectParam.choices`). Les bornes et le pas ne
  // sont pas décoratifs : le panneau lit la valeur comme un INDEX dans le
  // tableau d'étiquettes, et le shader la lit comme un entier. Une borne
  // désaccordée produirait un choix affiché qui ne correspond à rien dans le
  // shader, ou un état du shader que l'interface ne sait pas nommer — un échec
  // silencieux des deux côtés à la fois.
  for (const param of effect.params) {
    if (!param.choices) continue;
    if (param.choices.length < 2) {
      throw new Error(
        `Effet "${effect.id}", paramètre "${param.name}" : un paramètre à choix ` +
          `doit proposer au moins deux états (${param.choices.length} déclaré).`
      );
    }
    const attendu = { min: 0, step: 1, max: param.choices.length - 1 };
    if (param.min !== attendu.min || param.step !== attendu.step || param.max !== attendu.max) {
      throw new Error(
        `Effet "${effect.id}", paramètre "${param.name}" : bornes incompatibles avec ` +
          `ses ${param.choices.length} choix — attendu min=${attendu.min}, max=${attendu.max}, ` +
          `step=${attendu.step} ; déclaré min=${param.min}, max=${param.max}, step=${param.step}.`
      );
    }
    if (!Number.isInteger(param.default) || param.default < 0 || param.default > attendu.max) {
      throw new Error(
        `Effet "${effect.id}", paramètre "${param.name}" : défaut ${param.default} ` +
          `hors de l'intervalle des choix (0..${attendu.max}, entier).`
      );
    }
    if (param.colorGroup) {
      throw new Error(
        `Effet "${effect.id}", paramètre "${param.name}" : \`choices\` et \`colorGroup\` ` +
          `sont exclusifs — le panneau ne peut pas rendre un même paramètre des deux façons.`
      );
    }
  }

  // MAXIMUM DYNAMIQUE (`maxFrom`). Il ne peut que RESSERRER la course, jamais
  // l'élargir : `max` reste la borne que le panneau, les presets et toute
  // relecture prennent pour la vérité du paramètre. Un `maxFrom` au-dessus
  // rendrait un curseur qui va plus loin que ce que l'effet déclare — l'inverse
  // exact du défaut qu'il vient corriger. Vérifié sur les DÉFAUTS, seul jeu de
  // valeurs connu au chargement ; les autres sont bornés à l'usage par `Math.min`.
  const defauts: Record<string, number> = {};
  for (const p of effect.params) defauts[p.name] = p.default;
  for (const param of effect.params) {
    if (!param.maxFrom) continue;
    const effectif = param.maxFrom(defauts);
    if (!Number.isFinite(effectif) || effectif > param.max || effectif < param.min) {
      throw new Error(
        `Effet "${effect.id}", paramètre "${param.name}" : \`maxFrom\` rend ${effectif} ` +
          `aux valeurs par défaut, hors de l'intervalle déclaré ${param.min}..${param.max}. ` +
          `Un maximum dynamique resserre la course, il ne l'élargit pas.`
      );
    }
  }

  // APPLICABILITÉ (`appliesWhen`). Ce que la validation attrape ici est une
  // faute de frappe dans un nom ou un index — deux fautes qui, sans elle,
  // produiraient exactement la même chose : un curseur qui ne s'affiche plus
  // jamais, sans erreur, sans pixel modifié, sans test rouge.
  for (const param of effect.params) {
    if (!param.appliesWhen) continue;
    if (param.appliesWhen.param === param.name) {
      throw new Error(
        `Effet "${effect.id}", paramètre "${param.name}" : \`appliesWhen\` se vise lui-même. ` +
          `Un sélecteur qui se masque hors de son propre choix ne se rouvre plus.`
      );
    }
    validerConditionDAffichage(effect.id, params, param.appliesWhen, `appliesWhen du paramètre "${param.name}"`);
  }

  // SECTIONS (`EffectModule.sections`). Elles ne réordonnent pas `params[]` —
  // les index sont persistés dans les presets — elles regroupent des items de
  // RENDU. Ce qui se vérifie donc ici est la cohérence de la CITATION : un nom
  // qui n'existe pas ferait une section silencieusement plus courte, et un nom
  // cité deux fois ferait apparaître le même curseur à deux endroits, pilotant
  // la même valeur. Les deux se lisent comme un bug d'affichage, et aucune
  // référence de rendu ne peut les voir.
  if (effect.sections) {
    const ids = new Set<string>();
    const citePar = new Map<string, string>();
    for (const section of effect.sections) {
      if (ids.has(section.id)) throw new Error(`Effet "${effect.id}" : section dupliquée "${section.id}".`);
      ids.add(section.id);
      if (section.params.length === 0) {
        throw new Error(
          `Effet "${effect.id}", section "${section.id}" : aucun paramètre cité. Une section qui ` +
            `DEVIENT vide parce que tous ses paramètres sont masqués disparaît d'elle-même à ` +
            `l'affichage ; une section vide à la déclaration est une faute de frappe.`
        );
      }
      for (const name of section.params) {
        if (!params.has(name)) {
          throw new Error(`Effet "${effect.id}", section "${section.id}" : désigne le paramètre absent "${name}".`);
        }
        const precedente = citePar.get(name);
        if (precedente !== undefined) {
          throw new Error(
            `Effet "${effect.id}" : le paramètre "${name}" est cité par deux sections ` +
              `("${precedente}" et "${section.id}").`
          );
        }
        citePar.set(name, section.id);
      }
      // Les gabarits `pose` et `figure` ne dessinent rien par eux-mêmes : ils
      // annoncent qu'un contrôle spécialisé de l'effet prend la place des
      // curseurs. Les déclarer sur un effet qui n'en porte aucun rendrait une
      // section titrée et VIDE. ⚠️ Ce garde prouve la PRÉSENCE du contrôle sur
      // l'effet, pas que la section cite les paramètres que ce contrôle pilote.
      if (section.layout === "pose" && !effect.canvasControls?.length) {
        throw new Error(
          `Effet "${effect.id}", section "${section.id}" : gabarit "pose" alors que l'effet ne ` +
            `déclare aucun canvasControl — un réglage posé sur l'image a besoin de son contrôle.`
        );
      }
      if (section.layout === "figure" && !effect.curveControls?.length && !effect.colorRampControls?.length) {
        throw new Error(
          `Effet "${effect.id}", section "${section.id}" : gabarit "figure" alors que l'effet ne ` +
            `déclare ni curveControls ni colorRampControls.`
        );
      }
      if (section.appliesWhen) {
        validerConditionDAffichage(effect.id, params, section.appliesWhen, `appliesWhen de la section "${section.id}"`);
      }
    }
  }

  if (effect.canvasControls) {
    const ids = new Set<string>();
    for (const control of effect.canvasControls) {
      if (ids.has(control.id)) throw new Error(`Effet "${effect.id}" : contrôle canvas dupliqué "${control.id}".`);
      ids.add(control.id);
      const roles = control.kind === "point" ? [control.x, control.y]
        : control.kind === "disk" ? [control.x, control.y, control.radius]
        : control.kind === "box" ? [control.x, control.y, control.width, control.height, control.rotation]
        : [control.angle, control.length];
      if (new Set(roles).size !== roles.length) throw new Error(`Effet "${effect.id}" : un contrôle canvas réutilise le même paramètre pour plusieurs rôles.`);
      for (const name of roles) if (!params.has(name)) throw new Error(`Effet "${effect.id}" : contrôle canvas désigne le paramètre absent "${name}".`);
      if ((control.kind === "point" || control.kind === "disk" || control.kind === "box") &&
          (params.get(control.x)?.unit !== "percent" || params.get(control.y)?.unit !== "percent")) {
        throw new Error(`Effet "${effect.id}" : les coordonnées d'un contrôle canvas doivent être en percent.`);
      }
      if (control.kind === "axis" && params.get(control.angle)?.unit !== "degrees") {
        throw new Error(`Effet "${effect.id}" : l'angle d'un axe canvas doit être en degrees.`);
      }
      // UNE BOÎTE A DEUX UNITÉS, et les confondre est le piège de son
      // adaptateur : ses étendues sont des FRACTIONS du cadre (percent) et son
      // angle est en DEGRÉS. Un angle déclaré en percent tournerait la boîte
      // d'un facteur 57 sans rien casser d'autre.
      if (control.kind === "box") {
        if (params.get(control.width)?.unit !== "percent" || params.get(control.height)?.unit !== "percent") {
          throw new Error(`Effet "${effect.id}" : les étendues d'une boîte canvas doivent être en percent.`);
        }
        if (params.get(control.rotation)?.unit !== "degrees") {
          throw new Error(`Effet "${effect.id}" : la rotation d'une boîte canvas doit être en degrees.`);
        }
      }
      if (control.visibleWhen) {
        validerConditionDAffichage(effect.id, params, control.visibleWhen, "visibleWhen");
      }
    }
  }

  if (effect.curveControls) {
    const controlIds = new Set<string>();
    const channelIds = new Set<string>();
    const usedParams = new Set<string>();
    for (const control of effect.curveControls) {
      if (controlIds.has(control.id)) throw new Error(`Effet "${effect.id}" : contrôle de courbe dupliqué "${control.id}".`);
      controlIds.add(control.id);
      if (control.channels.length === 0) throw new Error(`Effet "${effect.id}" : le contrôle de courbe "${control.id}" ne déclare aucun canal.`);
      for (const channel of control.channels) {
        if (channelIds.has(channel.id)) throw new Error(`Effet "${effect.id}" : canal de courbe dupliqué "${channel.id}".`);
        channelIds.add(channel.id);
        const names = [channel.startY, ...channel.points.flatMap((point) => [point.x, point.y]), channel.endY];
        for (const name of names) {
          const param = params.get(name);
          if (!param) throw new Error(`Effet "${effect.id}" : courbe désigne le paramètre absent "${name}".`);
          if (usedParams.has(name)) throw new Error(`Effet "${effect.id}" : paramètre de courbe réutilisé "${name}".`);
          usedParams.add(name);
        }
        let previousX = 0;
        let inactiveSeen = false;
        for (const point of channel.points) {
          const x = params.get(point.x)!.default;
          const y = params.get(point.y)!;
          if (y.min > 0 || y.max < 1) throw new Error(`Effet "${effect.id}" : ordonnée de courbe "${point.y}" doit couvrir 0..1.`);
          if (x < 0) { inactiveSeen = true; continue; }
          if (inactiveSeen) throw new Error(`Effet "${effect.id}" : un slot de courbe actif suit un slot inactif dans "${channel.id}".`);
          if (x <= previousX || x >= 1) throw new Error(`Effet "${effect.id}" : abscisses de courbe non strictement croissantes dans "${channel.id}".`);
          previousX = x;
        }
      }
    }
  }

  if (effect.tonalRangeControl) {
    const names = Object.values(effect.tonalRangeControl);
    for (const name of names) if (!params.has(name)) throw new Error(`Effet "${effect.id}" : plage tonale désigne le paramètre absent "${name}".`);
    if (new Set(names).size !== names.length) throw new Error(`Effet "${effect.id}" : la plage tonale réutilise un paramètre.`);
    const defaults = names.map((name) => params.get(name)!.default);
    if (!(defaults[0] <= defaults[1] && defaults[1] <= defaults[2] && defaults[2] <= defaults[3])) {
      throw new Error(`Effet "${effect.id}" : bornes tonales par défaut non ordonnées.`);
    }
  }

  if (effect.colorRampControls) {
    const controlIds = new Set<string>();
    const usedParams = new Set<string>();
    for (const control of effect.colorRampControls) {
      if (controlIds.has(control.id)) throw new Error(`Effet "${effect.id}" : contrôle de rampe dupliqué "${control.id}".`);
      controlIds.add(control.id);
      const positionedStops = control.stops.filter((stop) => stop.position !== undefined);
      if (positionedStops.length !== 1 && positionedStops.length !== control.stops.length) {
        throw new Error(`Effet "${effect.id}" : la rampe "${control.id}" doit déclarer un arrêt intérieur ou ses trois arrêts positionnables.`);
      }
      const names = [control.blackPoint, control.whitePoint, ...control.stops.flatMap((stop) => [stop.hue, stop.saturation, stop.lightness, ...(stop.position ? [stop.position] : [])])];
      for (const name of names) {
        if (!params.has(name)) throw new Error(`Effet "${effect.id}" : rampe désigne le paramètre absent "${name}".`);
        if (usedParams.has(name)) throw new Error(`Effet "${effect.id}" : paramètre de rampe réutilisé "${name}".`);
        usedParams.add(name);
      }
      const black = params.get(control.blackPoint)!.default;
      const white = params.get(control.whitePoint)!.default;
      if (black >= white) throw new Error(`Effet "${effect.id}" : points noir/blanc de rampe non ordonnés.`);
      if (positionedStops.length === control.stops.length) {
        const defaults = positionedStops.map((stop) => params.get(stop.position!)!.default);
        if (!(defaults[0] < defaults[1] && defaults[1] < defaults[2])) {
          throw new Error(`Effet "${effect.id}" : arrêts couleur de rampe non ordonnés.`);
        }
      }
    }
  }

  if (effect.colorWheelControls) {
    const controlIds = new Set<string>();
    const usedParams = new Set<string>();
    for (const control of effect.colorWheelControls) {
      if (controlIds.has(control.id)) throw new Error(`Effet "${effect.id}" : roue chromatique dupliquée "${control.id}".`);
      controlIds.add(control.id);
      const names = [control.hue, control.saturation, control.luminance];
      if (new Set(names).size !== names.length) throw new Error(`Effet "${effect.id}" : la roue "${control.id}" réutilise un paramètre pour plusieurs rôles.`);
      for (const name of names) {
        if (!params.has(name)) throw new Error(`Effet "${effect.id}" : roue "${control.id}" désigne le paramètre absent "${name}".`);
        if (usedParams.has(name)) throw new Error(`Effet "${effect.id}" : paramètre de roue réutilisé "${name}".`);
        usedParams.add(name);
      }
    }
  }

  if (effect.libraryTexture) {
    // Le rang d'une texture est le seul paramètre du dépôt lu HORS du shader
    // (par `FramePipelineExecutor`, pour choisir quoi lier au binding 7). Il
    // échappe donc à la garde de câblage, qui l'exempte sur cette déclaration —
    // raison de plus pour que le nom soit vérifié ici : une faute de frappe
    // blanchirait un paramètre réellement mort au lieu de lever.
    const declared = new Set(effect.params.map((p) => p.name));
    if (!declared.has(effect.libraryTexture.indexParam)) {
      throw new Error(
        `Effet "${effect.id}" : libraryTexture désigne le paramètre absent "${effect.libraryTexture.indexParam}".`,
      );
    }
    // ⚠️ CETTE COMBINAISON A ÉTÉ REFUSÉE ICI JUSQU'AU 2026-09-16, et le refus
    // portait sur la PLOMBERIE, pas sur la capacité : les passes internes ne
    // recevaient pas la texture de bibliothèque, donc elles échantillonnaient le
    // repli 1×1 — le binding 7 existe dès que l'effet déclare `libraryTexture`,
    // donc le shader compilait et l'image était fausse sans qu'aucune erreur ne
    // parte. `runInternalPasses` la reçoit maintenant et la transmet à chaque
    // passe, et le refus est levé. Deux capacités en dépendaient, toutes deux
    // au ROADMAP : le ZMap de `lensBlur` (un flou dont le rayon se lit dans une
    // carte) et la texture de bibliothèque sur `lensFlare`.
    // CONTRAT DU SHADER, jusqu'ici en prose seulement (`types.ts`) : tester
    // `textureDimensions(libraryTexture)` et rendre l'entrée inchangée quand un
    // côté vaut 1. Le chargement est asynchrone et le binding TOUJOURS fourni —
    // `TextureLibraryStore` sert une texture 1×1 de repli tant que la vraie
    // n'est pas décodée. Un shader qui ne teste pas échantillonne ce repli et
    // rend une image fausse pendant quelques frames, sans erreur nulle part.
    if (!effect.wgsl.includes("textureDimensions")) {
      throw new Error(
        `Effet "${effect.id}" : déclare libraryTexture mais son corps WGSL ne teste jamais ` +
          `textureDimensions — il échantillonnerait la texture 1×1 de repli pendant le décodage.`,
      );
    }
  }

  validerContratWgsl(effect);
  validerGroupesDeCouleur(effect);
}

/**
 * Le contrat que `types.ts` énonce sur `EffectModule.wgsl`, vérifié au lieu
 * d'être seulement écrit.
 *
 * Ce qui reste HORS de portée, et pourquoi c'est dit plutôt que découvert : le
 * plafond de niveau qu'un effet à `sourceMipmaps` doit poser sur son mip dérivé.
 * Il se MESURE par effet (2 sur `glass`, trouvé après un faux départ), donc
 * aucune valeur n'est vérifiable ici ; et chercher un `min(`/`clamp(` autour du
 * niveau attraperait des formes légitimes en les manquant d'autres. Une garde
 * fragile vaut moins que pas de garde : elle fait croire que la règle est tenue.
 */
function validerContratWgsl(effect: EffectModule): void {
  // La signature d'entrée. Un corps sans elle compile parfois (le compositeur
  // l'enveloppe) puis échoue à l'exécution, loin de sa cause.
  if (!/fn\s+fs_main\s*\(/.test(effect.wgsl)) {
    throw new Error(
      `Effet "${effect.id}" : son corps WGSL ne définit pas fs_main. ` +
        `Signature attendue : fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32>.`,
    );
  }
}

/**
 * Les TROIS rôles d'un même `colorGroup` doivent être présents.
 *
 * `ParamPanel` lève déjà si l'un manque — mais À L'EXÉCUTION, donc au moment où
 * l'utilisateur ouvre le panneau de cet effet, et pas au chargement du registre.
 * Une déclaration incomplète passait tous les gates et n'échouait que devant lui.
 */
function validerGroupesDeCouleur(effect: EffectModule): void {
  const rolesParCle = new Map<string, Set<string>>();
  for (const param of effect.params) {
    if (!param.colorGroup) continue;
    const roles = rolesParCle.get(param.colorGroup.key) ?? new Set<string>();
    if (roles.has(param.colorGroup.role)) {
      throw new Error(
        `Effet "${effect.id}" : le groupe de couleur "${param.colorGroup.key}" déclare deux fois le rôle "${param.colorGroup.role}".`,
      );
    }
    roles.add(param.colorGroup.role);
    rolesParCle.set(param.colorGroup.key, roles);
  }
  for (const [cle, roles] of rolesParCle) {
    const manquants = ["hue", "saturation", "lightness"].filter((r) => !roles.has(r));
    if (manquants.length > 0) {
      throw new Error(
        `Effet "${effect.id}" : le groupe de couleur "${cle}" n'a pas ses trois rôles — manque ${manquants.join(", ")}.`,
      );
    }
  }
}
