import type { EffectModule } from "./types";
import { MAX_EFFECT_PARAMS } from "../shaderCompose";

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

  if (effect.canvasControls) {
    const params = new Map(effect.params.map((param) => [param.name, param]));
    const ids = new Set<string>();
    for (const control of effect.canvasControls) {
      if (ids.has(control.id)) throw new Error(`Effet "${effect.id}" : contrôle canvas dupliqué "${control.id}".`);
      ids.add(control.id);
      const roles = control.kind === "point" ? [control.x, control.y]
        : control.kind === "disk" ? [control.x, control.y, control.radius]
        : [control.angle, control.length];
      if (new Set(roles).size !== roles.length) throw new Error(`Effet "${effect.id}" : un contrôle canvas réutilise le même paramètre pour plusieurs rôles.`);
      for (const name of roles) if (!params.has(name)) throw new Error(`Effet "${effect.id}" : contrôle canvas désigne le paramètre absent "${name}".`);
      if ((control.kind === "point" || control.kind === "disk") &&
          (params.get(control.x)?.unit !== "percent" || params.get(control.y)?.unit !== "percent")) {
        throw new Error(`Effet "${effect.id}" : les coordonnées d'un contrôle canvas doivent être en percent.`);
      }
      if (control.kind === "axis" && params.get(control.angle)?.unit !== "degrees") {
        throw new Error(`Effet "${effect.id}" : l'angle d'un axe canvas doit être en degrees.`);
      }
      if (control.visibleWhen) {
        const conditionalParam = params.get(control.visibleWhen.param);
        if (!conditionalParam?.choices) {
          throw new Error(`Effet "${effect.id}" : visibleWhen doit viser un paramètre choices.`);
        }
        const choiceCount = conditionalParam.choices.length;
        const expectedValues = Array.isArray(control.visibleWhen.equals) ? control.visibleWhen.equals : [control.visibleWhen.equals];
        if (expectedValues.length === 0 || new Set(expectedValues).size !== expectedValues.length) {
          throw new Error(`Effet "${effect.id}" : visibleWhen doit viser au moins un index de choix distinct.`);
        }
        const invalid = expectedValues.find((value) => !Number.isInteger(value) || value < 0 || value >= choiceCount);
        if (invalid !== undefined) {
          throw new Error(`Effet "${effect.id}" : visibleWhen vise l'index de choix invalide ${invalid}.`);
        }
      }
    }
  }

  if (effect.curveControls) {
    const params = new Map(effect.params.map((param) => [param.name, param]));
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
    const params = new Map(effect.params.map((param) => [param.name, param]));
    const names = Object.values(effect.tonalRangeControl);
    for (const name of names) if (!params.has(name)) throw new Error(`Effet "${effect.id}" : plage tonale désigne le paramètre absent "${name}".`);
    if (new Set(names).size !== names.length) throw new Error(`Effet "${effect.id}" : la plage tonale réutilise un paramètre.`);
    const defaults = names.map((name) => params.get(name)!.default);
    if (!(defaults[0] <= defaults[1] && defaults[1] <= defaults[2] && defaults[2] <= defaults[3])) {
      throw new Error(`Effet "${effect.id}" : bornes tonales par défaut non ordonnées.`);
    }
  }

  if (effect.colorRampControls) {
    const params = new Map(effect.params.map((param) => [param.name, param]));
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
    // Les passes internes d'un effet à texture ne reçoivent PAS le binding 7 —
    // `FramePipelineExecutor` ne le résout que pour la passe finale. Lever
    // plutôt que de laisser un effet dont les passes internes échantillonneraient
    // une texture inexistante : le shader ne compilerait pas, et l'erreur
    // arriverait au rendu au lieu du chargement du registre.
    if (effect.passes?.length) {
      throw new Error(
        `Effet "${effect.id}" : libraryTexture et passes internes ne sont pas encore combinables (le binding 7 n'est résolu que pour la passe finale).`,
      );
    }
  }
}
