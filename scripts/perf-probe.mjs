#!/usr/bin/env node
// Sonde de cadence en build de PRODUCTION — mesure ce que coûte un réglage
// pendant un VRAI glissement de souris.
//
// POURQUOI CE FICHIER EXISTE. Deux mesures de perf ont déjà été refaites de
// zéro dans ce dépôt parce que leur harnais vivait dans le scratchpad d'une
// session et n'y a pas survécu (feather SAT le 2026-08-13, coût du verre le
// 2026-08-14). Il est ici pour que la troisième n'ait pas à le réécrire.
//
// DEUX RÈGLES PAYÉES CHER, ET QUE CE SCRIPT APPLIQUE :
//
// 1. « Une mesure en build de DÉVELOPPEMENT prouve qu'un coût existe, jamais
//    qu'il est négligeable » — le plancher dev est 2,6x celui de la prod
//    (15,4 ms contre 6,2 ms de travail synchrone par événement) et noie les
//    petits signaux. Ce script REFUSE de mesurer si le pont de debug
//    (`window.__shaderlabDebug`, `import.meta.env.DEV` seulement) est présent.
//
// 2. « Un drag se simule ENTIER, jamais par une rafale d'`input` » — un `input`
//    isolé, sans pointeur en cours, est traité comme une FIN d'interaction :
//    chaque pas paie un `commit()` complet. Une sonde qui en dispatche 63
//    mesure 14 images/s là où le vrai geste en rend 165. Elle FABRIQUE la
//    lenteur qu'elle mesure. Ici, un glissement est
//    `mousePressed` + N `mouseMoved` + `mouseReleased`, par CDP `Input`.
//
// LANCER L'APP EN PRODUCTION (le pont de debug étant absent, la photo ne peut
// pas être ouverte par script — elle se passe en ARGUMENT de lancement, ce que
// `get_launch_path` sait faire) :
//
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
//   Start-Process src-tauri\target\release\shaderlab.exe -ArgumentList "C:\chemin\photo.jpg"
//
// Usage : node scripts/perf-probe.mjs <commande> [args]
//   etat                       build (prod/dev), document, calques, taille image
//   sliders                    les curseurs du panneau : rang, bornes, valeur
//   choix                      les listes de choix du panneau (matière, mode...)
//   add-effect <Nom>           ajoute un calque d'effet par son nom affiché
//   choisir <rang> <libellé>   pose une liste de choix (ex. la matière du verre)
//   poser <rang> <valeur>      pose un curseur SANS mesurer (setter + input)
//   drag <rang> [pas] [ms]     GLISSE le curseur et rend la cadence
//
// `drag` est le seul qui mesure. Les autres montent la scène.

import { setTimeout as dormir } from "node:timers/promises";

const CDP = process.env.SHADERLAB_CDP ?? "http://localhost:9222";

/* ── Transport ───────────────────────────────────────────────────────────── */

async function connect() {
  let cibles;
  try {
    cibles = await (await fetch(`${CDP}/json/list`)).json();
  } catch {
    throw new Error(
      `CDP injoignable sur ${CDP}. L'app tourne-t-elle avec --remote-debugging-port ?\n` +
        `  Voir l'en-tête de ce fichier pour la ligne de lancement en production.`,
    );
  }
  const page = cibles.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page) throw new Error(`Aucune page CDP parmi ${cibles.length} cible(s).`);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("WebSocket CDP refusée")), { once: true });
  });

  let id = 0;
  const attente = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && attente.has(m.id)) {
      attente.get(m.id)(m);
      attente.delete(m.id);
    }
  });

  const envoyer = (method, params = {}) =>
    new Promise((resolve) => {
      const n = ++id;
      attente.set(n, resolve);
      ws.send(JSON.stringify({ id: n, method, params }));
    });

  /** LÈVE sur exception dans la page : une sonde qui avale les erreurs
   *  rapporte « rien trouvé » aussi bien quand la cible manque que quand le
   *  code de la sonde est faux. */
  const evaluer = async (expression, attendrePromesse = false) => {
    const r = await envoyer("Runtime.evaluate", {
      expression,
      awaitPromise: attendrePromesse,
      returnByValue: true,
    });
    const details = r.result?.exceptionDetails;
    if (details) {
      throw new Error(
        `Exception dans la page : ${details.exception?.description ?? details.text ?? "inconnue"}`,
      );
    }
    return r.result?.result?.value;
  };

  // `Performance.getMetrics` rend une liste VIDE tant que le domaine n'est pas
  // activé — un vide qui se lirait comme « ce moteur n'a pas de compteurs ».
  await envoyer("Performance.enable");

  return { envoyer, evaluer, fermer: () => ws.close() };
}

/* ── Gardes ──────────────────────────────────────────────────────────────── */

/** Le pont de debug est `import.meta.env.DEV` SEULEMENT. Sa présence prouve
 *  donc qu'on est en développement — et une cadence mesurée là ne peut pas
 *  conclure. Refuser plutôt que produire un chiffre qui sera relu comme un
 *  chiffre de production six mois plus tard. */
async function exigerProduction(page) {
  const dev = await page.evaluer("!!window.__shaderlabDebug");
  if (dev) {
    throw new Error(
      "Pont de debug PRÉSENT : cette fenêtre est un build de DÉVELOPPEMENT.\n" +
        "  Une mesure de cadence y prouve qu'un coût existe, jamais qu'il est\n" +
        "  négligeable — le plancher dev est 2,6x celui de la prod.\n" +
        "  Relancer src-tauri\\target\\release\\shaderlab.exe (voir l'en-tête).\n" +
        "  Passer SHADERLAB_PERF_AUTORISER_DEV=1 pour forcer (et le DIRE dans le rapport).",
    );
  }
}

const CURSEURS = "input[type=range]";

/**
 * Attente PRÉCISE, en attente active sous 12 ms.
 *
 * ⚠️ Sans elle, la sonde plafonne à ~63 événements/s et ce plafond se lit comme
 * une mesure : `setTimeout` a une granularité de 15,6 ms sur Windows, donc un
 * `dt` de 8 ms en donne 15,8. Mesuré — l'effet Grain rendait « 63,6 images/s »
 * avec EXACTEMENT 150 images pour 150 pas de glissement : l'app rendait une
 * image par événement, et c'est le débit d'événements qu'on lisait, pas le sien.
 * Un chiffre plafonné a la même tête qu'un chiffre mesuré ; le témoin est
 * `images == pas`.
 */
async function attendrePrecis(ms) {
  if (ms >= 12) return dormir(ms);
  const fin = process.hrtime.bigint() + BigInt(Math.round(ms * 1e6));
  while (process.hrtime.bigint() < fin) { /* attente active */ }
  return undefined;
}

/* ── Instruments ─────────────────────────────────────────────────────────── */

/**
 * Les compteurs du moteur, par CDP `Performance.getMetrics`.
 *
 * ⚠️ DEUX PIÈGES D'INSTRUMENT PAYÉS ICI MÊME, dans l'ordre où ils sont tombés.
 *
 * 1. **Un compteur de `requestAnimationFrame` ne compte pas des rendus.** rAF
 *    tique à la cadence de l'ÉCRAN même quand aucune image nouvelle n'est
 *    composée, le travail GPU étant asynchrone. Mesuré sur le verre en pavé :
 *    médiane des intervalles rAF à 7,1 ms (donc « 140 images/s ») avec un 95ᵉ
 *    centile à 282 ms sur la MÊME passe. Seul le second parle du rendu.
 *
 * 2. **`Performance.getMetrics` a bien un compteur nommé `Frames`, et ce n'est
 *    PAS le nombre d'images rendues** — c'est le nombre de frames du document
 *    (iframes vivantes). Il rend donc un delta de ZÉRO sur cinq passes de
 *    glissement, ce qui aurait pu se lire « le rendu ne produit aucune image ».
 *    Le nom promettait la grandeur voulue ; la valeur mesure autre chose.
 *
 * Ce qui reste vrai de ce domaine et qu'on garde : `TaskDuration` (temps de fil
 * principal, en secondes cumulées) et `Timestamp`. Le compte d'images RÉEL est
 * pris ailleurs, par `installerCompteurDImages`.
 */
async function compteurs(page) {
  const r = await page.envoyer("Performance.getMetrics");
  const m = {};
  for (const x of r.result?.metrics ?? []) m[x.name] = x.value;
  return m;
}

/**
 * Compte les images RÉELLEMENT présentées, en instrumentant WebGPU dans la page.
 *
 * `GPUCanvasContext.getCurrentTexture()` est appelé UNE fois par image envoyée
 * à la surface de présentation : c'est la définition la plus proche de « ce que
 * l'œil reçoit » qu'on puisse obtenir sans le pont de debug, absent en
 * production. Le patch est idempotent et ne survit pas à un rechargement.
 */
async function installerCompteurDImages(page) {
  const pose = await page.evaluer(
    "(function () {" +
      " if (window.__sondeImages) { window.__sondeImages.n = 0; return 'déjà posé'; }" +
      " if (typeof GPUCanvasContext === 'undefined') return 'WebGPU absent';" +
      " window.__sondeImages = { n: 0 };" +
      " var p = GPUCanvasContext.prototype, o = p.getCurrentTexture;" +
      " p.getCurrentTexture = function () { window.__sondeImages.n++; return o.apply(this, arguments); };" +
      " return 'posé'; })()",
  );
  if (pose === "WebGPU absent") throw new Error("GPUCanvasContext introuvable — cette page ne rend pas en WebGPU.");
  return pose;
}

const lireCompteurDImages = (page) => page.evaluer("window.__sondeImages.n");

/**
 * Résout un curseur par le LIBELLÉ de sa ligne, et non par son rang.
 *
 * ⚠️ Un rang n'est pas comparable entre deux configurations : passer d'une
 * matière de pavé à une matière de feuille change la liste des paramètres
 * affichés (`EffectParam.appliesWhen`), donc « le curseur 5 » désigne
 * *Épaisseur* dans un cas et *Micro-relief* dans l'autre. Une comparaison faite
 * au rang compare deux réglages différents en croyant comparer deux
 * configurations.
 */
async function rangDuCurseur(page, designation) {
  if (/^\d+$/.test(String(designation))) return Number(designation);
  const r = await page.evaluer(`
    (function () {
      var all = Array.prototype.slice.call(document.querySelectorAll(${JSON.stringify(CURSEURS)}));
      var libelles = all.map(function (inp) {
        var s = inp.closest('[data-slot=slider]');
        var ligne = s ? s.parentElement.parentElement : inp.parentElement;
        return ligne ? ligne.textContent.trim() : '';
      });
      var i = libelles.findIndex(function (t) { return t.indexOf(${JSON.stringify(designation)}) === 0; });
      return JSON.stringify({ rang: i, libelles: libelles });
    })()
  `);
  const { rang, libelles } = JSON.parse(r);
  if (rang < 0) {
    throw new Error(
      `Curseur « ${designation} » absent du panneau. Présents : ${libelles.map((t) => t.slice(0, 24)).join(" | ")}`,
    );
  }
  return rang;
}

/* ── Le geste ────────────────────────────────────────────────────────────── */

/**
 * Un glissement RÉEL sur le n-ième curseur, et la cadence pendant le geste.
 *
 * Ce que le rapport contient et pourquoi chaque champ y est :
 * - `images` / `ms` / `cadence` : la mesure elle-même ;
 * - `valeurAvant` / `valeurApres` : TÉMOIN. Une cadence magnifique sur un
 *   curseur qui n'a pas bougé mesure une fenêtre au repos, pas un rendu ;
 * - `pas` : le nombre de `mouseMoved` réellement dispatchés.
 */
async function glisser(page, rang, pas, dt, depart, arrivee) {
  // ⚠️ Le rect de l'input NE DONNE PAS la piste. Les curseurs du panneau sont
  // des Slider shadcn : l'`input[type=range]` y est un carré de 10 px en
  // `position: fixed` posé SUR LE POUCE, et la piste est l'ancêtre
  // `[data-slot=slider]` (207 px). Glisser sur le rect de l'input reviendrait à
  // parcourir 10 px de course — mesuré, c'est ce que rendait la première
  // version de cette sonde.
  // ⚠️ AMENER LE CURSEUR DANS LA VUE, PUIS VÉRIFIER QUI EST SOUS LE POINT.
  // La colonne du dock défile et ses cartes débordent : un curseur peut être à
  // y = 1369 dans une fenêtre haute de 1377, donc hors de la zone cliquable.
  // Le press tombait alors sur la pasteboard, DÉSÉLECTIONNAIT le calque, et le
  // panneau disparaissait — l'erreur remontait ensuite comme un TypeError sur
  // la lecture de la valeur, à trois appels de la vraie cause.
  await page.evaluer(`
    (function () {
      var inp = document.querySelectorAll(${JSON.stringify(CURSEURS)})[${rang}];
      if (inp) (inp.closest('[data-slot=slider]') || inp).scrollIntoView({ block: 'center' });
    })()
  `);
  await dormir(250);

  const geom = await page.evaluer(`
    (function () {
      var all = Array.prototype.slice.call(document.querySelectorAll(${JSON.stringify(CURSEURS)}));
      var inp = all[${rang}];
      if (!inp) return JSON.stringify({ erreur: 'rang ' + ${rang} + ' introuvable, ' + all.length + ' curseurs' });
      var piste = inp.closest('[data-slot=slider]') || inp;
      var r = piste.getBoundingClientRect();
      var y = r.top + r.height / 2;
      var sous = document.elementFromPoint(r.left + r.width * 0.5, y);
      var dedans = !!(sous && piste.contains(sous));
      return JSON.stringify({
        x: r.left, y: y, w: r.width,
        piste: piste === inp ? 'input' : 'slider-shadcn',
        dedans: dedans,
        sous: sous ? (sous.tagName + '.' + String(sous.className).split(' ')[0]) : 'rien',
        valeur: inp.value, min: inp.min, max: inp.max
      });
    })()
  `);
  const g = JSON.parse(geom);
  if (g.erreur) throw new Error(g.erreur);
  if (g.w < 8) throw new Error(`Curseur ${rang} large de ${g.w} px — panneau replié ou hors écran ?`);
  if (!g.dedans) {
    throw new Error(
      `Le point de clic du curseur ${rang} (${Math.round(g.x + g.w / 2)}, ${Math.round(g.y)}) ` +
        `tombe sur ${g.sous}, pas sur la piste. Curseur hors de la vue : le geste ` +
        `désélectionnerait le calque au lieu de le régler.`,
    );
  }

  const xDe = g.x + g.w * depart;
  const xA = g.x + g.w * arrivee;

  await page.envoyer("Input.dispatchMouseEvent", {
    type: "mousePressed", x: xDe, y: g.y, button: "left", clickCount: 1, buttons: 1,
  });
  await dormir(120);
  // ⚠️ Le témoin compare la valeur À L'APPUI et AU RELÂCHEMENT, pas avant/après
  // le geste : un glissement qui finit toujours à 95 % rend la même valeur
  // finale que le précédent, et « avant == après » criait au geste mort sur un
  // geste parfaitement valide.
  const valeurDebut = await page.evaluer(`
    (function () {
      var all = document.querySelectorAll(${JSON.stringify(CURSEURS)});
      var inp = all[${rang}];
      return inp ? inp.value : 'DISPARU A L APPUI (' + all.length + ' curseurs)';
    })()
  `);

  // Compteur de frames posé APRÈS l'appui : l'appui lui-même repositionne le
  // curseur d'un coup, et son rendu n'appartient pas au glissement.
  // On garde les HORODATAGES, pas seulement le compte : une moyenne sur 20
  // frames saute du simple au double d'une passe à l'autre, là où la MÉDIANE
  // des intervalles tient. C'est elle qu'on rapporte.
  await page.evaluer(
    "window.__perf = { t: [], t0: performance.now(), on: true };" +
      "(function boucle(){ if(!window.__perf.on) return; window.__perf.t.push(performance.now()); requestAnimationFrame(boucle); })();",
  );
  await installerCompteurDImages(page);
  const imagesAvant = await lireCompteurDImages(page);
  const avant = await compteurs(page);

  // ⚠️ On N'ATTEND PAS l'accusé de réception de chaque `mouseMoved`. Le fil
  // principal de la page est occupé à rendre, donc la réponse CDP revient
  // quand il veut : attendre chaque événement étirait un geste de 640 ms en
  // 7,7 s (96 ms entre deux pas au lieu de 8) — la sonde ralentissait le
  // geste qu'elle mesurait. Les envois partent à la cadence voulue et le
  // compteur de frames, lui, mesure le temps réel.
  const envois = [];
  for (let i = 1; i <= pas; i += 1) {
    const x = xDe + ((xA - xDe) * i) / pas;
    envois.push(
      page.envoyer("Input.dispatchMouseEvent", {
        type: "mouseMoved", x, y: g.y, button: "left", buttons: 1,
      }),
    );
    await attendrePrecis(dt);
  }
  await Promise.all(envois);

  const mesure = await page.evaluer(
    "(function(){ window.__perf.on = false;" +
      " var t = window.__perf.t, d = [];" +
      " for (var i = 1; i < t.length; i++) d.push(t[i] - t[i-1]);" +
      " d.sort(function(a,b){return a-b;});" +
      " var med = d.length ? d[Math.floor(d.length/2)] : 0;" +
      " var p95 = d.length ? d[Math.floor(d.length*0.95)] : 0;" +
      " return JSON.stringify({ n: t.length, ms: performance.now() - window.__perf.t0," +
      " med: med, p95: p95 }); })()",
  );

  const apresCompteurs = await compteurs(page);
  const imagesApres = await lireCompteurDImages(page);

  await page.envoyer("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: xA, y: g.y, button: "left", clickCount: 1, buttons: 0,
  });
  await dormir(400);

  // Défensif : un curseur peut DISPARAÎTRE pendant le geste (un
  // `appliesWhen` franchi, ou le panneau qui se referme parce que le calque
  // s'est désélectionné). Vu ici même — le rendu de fin de geste levait alors
  // un TypeError qui masquait la vraie cause.
  const apres = await page.evaluer(`
    (function () {
      var all = document.querySelectorAll(${JSON.stringify(CURSEURS)});
      var inp = all[${rang}];
      return inp ? inp.value : 'DISPARU (' + all.length + ' curseurs restants)';
    })()
  `);

  const m = JSON.parse(mesure);
  const duree = apresCompteurs.Timestamp - avant.Timestamp;
  const images = imagesApres - imagesAvant;
  const filPrincipal = apresCompteurs.TaskDuration - avant.TaskDuration;
  return {
    rang,
    pas,
    // LA mesure : images réellement composées par seconde.
    imagesParSeconde: duree > 0 ? +(images / duree).toFixed(1) : 0,
    images,
    secondes: +duree.toFixed(2),
    // Part du temps où le fil principal travaille. Basse + cadence basse =
    // le goulot est le GPU, pas le JS.
    filPrincipalPct: duree > 0 ? +((filPrincipal / duree) * 100).toFixed(0) : 0,
    // Le compteur rAF est CONSERVÉ, mais comme témoin de l'écran, pas du rendu.
    rafParSeconde: +((m.n * 1000) / m.ms).toFixed(1),
    rafPireMs: +m.p95.toFixed(1),
    // Le pas réel, pas celui demandé : `setTimeout` a une granularité d'environ
    // 15 ms sur Windows, donc un `dt` de 8 donne un geste à ~65 Hz, pas 125.
    msParPas: +(m.ms / pas).toFixed(1),
    valeurDebut,
    valeurFin: apres,
    bornes: `${g.min}..${g.max}`,
    piste: g.piste,
  };
}

/* ── Commandes ───────────────────────────────────────────────────────────── */

const commandes = {
  async etat(page) {
    const dev = await page.evaluer("!!window.__shaderlabDebug");
    const url = await page.evaluer("location.href");
    const curseurs = await page.evaluer(`document.querySelectorAll(${JSON.stringify(CURSEURS)}).length`);
    const canvas = await page.evaluer(
      "(function(){var c=document.querySelector('canvas'); return c ? JSON.stringify({w:c.width,h:c.height}) : 'aucun';})()",
    );
    console.log(`url      : ${url}`);
    console.log(`build    : ${dev ? "DÉVELOPPEMENT (pont de debug présent) — mesure NON concluante" : "production"}`);
    console.log(`canvas   : ${canvas}`);
    console.log(`curseurs : ${curseurs}`);
  },

  async sliders(page) {
    const r = await page.evaluer(`
      (function () {
        var all = Array.prototype.slice.call(document.querySelectorAll(${JSON.stringify(CURSEURS)}));
        return JSON.stringify(all.map(function (inp, i) {
          var piste = inp.closest('[data-slot=slider]') || inp;
          var w = piste.getBoundingClientRect().width;
          return { rang: i, valeur: inp.value, min: inp.min, max: inp.max, largeur: Math.round(w) };
        }));
      })()
    `);
    for (const s of JSON.parse(r)) {
      console.log(`${String(s.rang).padStart(2)} : ${s.valeur.padStart(8)}  [${s.min}..${s.max}]  ${s.largeur} px`);
    }
  },

  async choix(page) {
    // Les listes de choix ne sont pas toutes des <select> : le panneau rend
    // aussi des groupes de boutons. On liste les deux.
    const r = await page.evaluer(`
      (function () {
        var out = [];
        Array.prototype.forEach.call(document.querySelectorAll('select'), function (s, i) {
          out.push({ genre: 'select', rang: i, valeur: s.value,
            options: Array.prototype.map.call(s.options, function (o) { return o.textContent.trim(); }) });
        });
        Array.prototype.forEach.call(document.querySelectorAll('[role=radiogroup],[role=tablist]'), function (g, i) {
          out.push({ genre: g.getAttribute('role'), rang: i,
            options: Array.prototype.map.call(g.querySelectorAll('button,[role=radio],[role=tab]'),
              function (b) { return b.textContent.trim(); }) });
        });
        return JSON.stringify(out);
      })()
    `);
    console.log(JSON.stringify(JSON.parse(r), null, 1));
  },

  async "add-effect"(page, nom) {
    if (!nom) throw new Error("usage : add-effect <Nom affiché>");
    const ouvert = await page.evaluer(
      "(function(){var b=Array.prototype.slice.call(document.querySelectorAll('button'))" +
        ".find(function(x){return x.textContent.trim()==='Ajouter un effet';});" +
        " if(!b) return 'absent'; b.click(); return 'ok';})()",
    );
    if (ouvert === "absent") throw new Error("Bouton « Ajouter un effet » introuvable — aucun document ouvert ?");
    await dormir(900);
    const choisi = await page.evaluer(`
      (function () {
        var c = Array.prototype.slice.call(document.querySelectorAll('button,li,[role=option]'))
          .filter(function (e) { return e.textContent.trim() === ${JSON.stringify(nom)}; });
        if (!c.length) return 'absent';
        c[c.length - 1].click();
        return 'ok';
      })()
    `);
    if (choisi === "absent") throw new Error(`Effet « ${nom} » introuvable dans le sélecteur.`);
    await dormir(2500);
    console.log(`calque d'effet ajouté : ${nom}`);
  },

  /** Sélectionne un calque par son nom dans la carte Pile — le panneau de
   *  propriétés n'existe QUE pour le calque sélectionné, et un geste qui
   *  déborde de la piste peut désélectionner sans rien dire. */
  async selectionner(page, ...nom) {
    const cible = nom.join(" ");
    if (!cible) throw new Error("usage : selectionner <nom du calque>  (ex. Glass)");
    const r = await page.evaluer(
      `
      (async function () {
        var lignes = Array.prototype.slice.call(document.querySelectorAll('[class*=layer], li, [role=listitem], button'))
          .filter(function (e) { return e.textContent.trim() === ${JSON.stringify(cible)}; });
        if (!lignes.length) return 'calque introuvable';
        lignes[0].click();
        await new Promise(function (r) { setTimeout(r, 800); });
        return 'sélectionné, ' + document.querySelectorAll('input[type=range]').length + ' curseurs';
      })()
    `,
      true,
    );
    if (r === "calque introuvable") throw new Error(`Calque « ${cible} » introuvable dans la pile.`);
    console.log(r);
  },

  async choisir(page, reglage, ...libelle) {
    const cible = libelle.join(" ");
    if (!reglage || !cible) throw new Error("usage : choisir <libellé du réglage> <libellé de l'option>  (ex. choisir Matière Pavé quadrillé)");
    // ⚠️ Les listes de choix ne sont PAS des <select> : ce sont des combobox
    // base-ui (role=combobox + popup role=listbox), donc ni `.value` ni un
    // événement `change` ne les pose. Le seul chemin est le geste : ouvrir,
    // puis cliquer l'option. On les désigne par le libellé de leur réglage —
    // il y a cinq combobox à l'écran, dont le sélecteur d'effet du calque.
    const r = await page.evaluer(
      `
      (async function () {
        var labels = Array.prototype.slice.call(document.querySelectorAll('div'))
          .filter(function (e) { return e.id && e.childNodes.length === 1 && e.textContent.trim() === ${JSON.stringify(reglage)}; });
        if (!labels.length) return 'réglage introuvable : ${reglage.replace(/'/g, "")}';
        var cb = document.getElementById(labels[0].id.replace(/-label$/, ''));
        if (!cb) return 'combobox introuvable pour ce réglage';
        var avant = cb.textContent.trim();
        cb.click();
        await new Promise(function (r) { setTimeout(r, 600); });
        var opts = Array.prototype.slice.call(document.querySelectorAll('[role=option]'));
        var cible = opts.find(function (o) { return o.textContent.trim() === ${JSON.stringify(cible)}; });
        if (!cible) {
          document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          return 'option absente parmi : ' + opts.map(function (o) { return o.textContent.trim(); }).join(' | ');
        }
        cible.click();
        await new Promise(function (r) { setTimeout(r, 2000); });
        return 'posé : ' + avant + ' -> ' + cb.textContent.trim();
      })()
    `,
      true,
    );
    if (!String(r).startsWith("posé")) throw new Error(String(r));
    console.log(r);
  },

  async poser(page, designation, valeur) {
    if (designation === undefined || valeur === undefined) throw new Error("usage : poser <rang ou libellé> <valeur>");
    const rang = await rangDuCurseur(page, designation);
    // ⚠️ Monte la scène, NE MESURE RIEN. Un `input` isolé est traité comme une
    // FIN d'interaction et paie un commit complet — c'est exactement la sonde
    // qui fabriquait 14 images/s là où le vrai geste en rend 165.
    const r = await page.evaluer(`
      (function () {
        var inp = document.querySelectorAll(${JSON.stringify(CURSEURS)})[${Number(rang)}];
        if (!inp) return 'introuvable';
        var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(inp, ${JSON.stringify(String(valeur))});
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return 'posé à ' + inp.value + ' (bornes ' + inp.min + '..' + inp.max + ')';
      })()
    `);
    if (r === "introuvable") throw new Error(`Curseur ${rang} introuvable.`);
    await dormir(1200);
    console.log(r);
  },

  /** Valide le GESTE avant d'en tirer un chiffre : qui reçoit le clic, et la
   *  valeur bouge-t-elle à l'appui puis au mouvement ? Une cadence sur un
   *  curseur qui ne bouge pas mesure une fenêtre au repos. */
  async sonde(page, rang = "0") {
    const n = Number(rang);
    const g = JSON.parse(
      await page.evaluer(`
      (function () {
        var inp = document.querySelectorAll(${JSON.stringify(CURSEURS)})[${n}];
        var piste = inp.closest('[data-slot=slider]') || inp;
        var r = piste.getBoundingClientRect();
        var au = function (f) {
          var e = document.elementFromPoint(r.left + r.width * f, r.top + r.height / 2);
          return e ? (e.tagName + '.' + String(e.className).split(' ')[0] + '[' + (e.getAttribute('data-slot') || '') + ']') : 'rien';
        };
        return JSON.stringify({
          x: r.left, y: r.top + r.height / 2, w: r.width, valeur: inp.value,
          a5: au(0.05), a50: au(0.5), a95: au(0.95)
        });
      })()
    `),
    );
    console.log(`piste    : x=${Math.round(g.x)} y=${Math.round(g.y)} w=${Math.round(g.w)}  valeur=${g.valeur}`);
    console.log(`sous 5%  : ${g.a5}`);
    console.log(`sous 50% : ${g.a50}`);
    console.log(`sous 95% : ${g.a95}`);

    const lire = () =>
      page.evaluer(`document.querySelectorAll(${JSON.stringify(CURSEURS)})[${n}].value`);

    await page.envoyer("Input.dispatchMouseEvent", {
      type: "mousePressed", x: g.x + g.w * 0.5, y: g.y, button: "left", clickCount: 1, buttons: 1,
    });
    await dormir(200);
    console.log(`apres appui a 50%   : ${await lire()}`);

    await page.envoyer("Input.dispatchMouseEvent", {
      type: "mouseMoved", x: g.x + g.w * 0.85, y: g.y, button: "left", buttons: 1,
    });
    await dormir(200);
    console.log(`apres deplacement 85%: ${await lire()}`);

    await page.envoyer("Input.dispatchMouseEvent", {
      type: "mouseReleased", x: g.x + g.w * 0.85, y: g.y, button: "left", clickCount: 1, buttons: 0,
    });
    await dormir(400);
    console.log(`apres relachement    : ${await lire()}`);
  },

  async drag(page, rang, pas = "60", dt = "8", depart = "0.05", arrivee = "0.95") {
    if (rang === undefined) throw new Error("usage : drag <rang ou libellé> [pas] [ms] [depart 0..1] [arrivee 0..1]");
    if (!process.env.SHADERLAB_PERF_AUTORISER_DEV) await exigerProduction(page);
    const cible = await rangDuCurseur(page, rang);
    const r = await glisser(page, cible, Number(pas), Number(dt), Number(depart), Number(arrivee));
    console.log(JSON.stringify(r, null, 1));
    if (r.valeurDebut === r.valeurFin) {
      console.log("⚠️  le curseur n'a PAS bougé : cette cadence mesure une fenêtre au repos, pas un rendu.");
      process.exitCode = 1;
    }
    if (r.images === 0) {
      console.log("⚠️  zéro frame : rAF gelé — fenêtre en arrière-plan ou minimisée ?");
      process.exitCode = 1;
    }
  },
  /**
   * N glissements aller-retour sur le même curseur, et la MÉDIANE de leurs
   * cadences médianes. Une passe isolée saute du simple au double (19,3 puis
   * 7,3 images/s sur le même réglage, mesuré) : la file GPU d'une passe
   * déborde sur la suivante, et vingt frames ne font pas une statistique.
   * Le premier aller-retour est un ÉCHAUFFEMENT et n'est pas compté.
   */
  async bench(page, rang, passes = "5", pas = "150", dt = "8", bas = "0.05", haut = "0.95") {
    if (rang === undefined) throw new Error("usage : bench <rang> [passes] [pas] [ms] [bas 0..1] [haut 0..1]");
    if (!process.env.SHADERLAB_PERF_AUTORISER_DEV) await exigerProduction(page);
    const n = Number(passes);
    const b = Number(bas);
    const h = Number(haut);
    const cible = await rangDuCurseur(page, rang);
    const cadences = [];
    for (let i = 0; i <= n; i += 1) {
      const versLeHaut = i % 2 === 1;
      const r = await glisser(
        page, cible, Number(pas), Number(dt),
        versLeHaut ? b : h, versLeHaut ? h : b,
      );
      const etiquette = i === 0 ? "échauffement" : `passe ${i}`;
      console.log(
        `${etiquette.padEnd(13)} ${String(r.imagesParSeconde).padStart(6)} img/s  ` +
          `(${r.images} images en ${r.secondes} s, fil principal ${r.filPrincipalPct} %, ` +
          `rAF ${r.rafParSeconde}/s pire ${r.rafPireMs} ms, ${r.valeurDebut} -> ${r.valeurFin})`,
      );
      if (r.valeurDebut === r.valeurFin) {
        throw new Error("le curseur n'a pas bougé — geste mort, aucun chiffre exploitable");
      }
      // TÉMOIN DE PLAFOND : une image par événement signifie que la sonde
      // n'envoie pas assez vite, et que le chiffre décrit son propre débit.
      if (r.images >= Number(pas)) {
        console.log(
          `   ⚠️  ${r.images} images pour ${pas} pas : l'app suit le rythme des ` +
            `événements. Ce chiffre est le PLAFOND de la sonde, pas le coût de l'effet.`,
        );
      }
      if (i > 0) cadences.push(r.imagesParSeconde);
      await dormir(900); // laisser la file GPU se vider entre deux passes
    }
    cadences.sort((a, b) => a - b);
    const mediane = cadences[Math.floor(cadences.length / 2)];
    console.log(
      `\nMÉDIANE sur ${cadences.length} passes : ${mediane} images/s  ` +
        `(étendue ${cadences[0]} … ${cadences[cadences.length - 1]})`,
    );
  },
};

/* ── Entrée ──────────────────────────────────────────────────────────────── */

const [, , nom, ...args] = process.argv;
if (!nom || nom === "--help" || !commandes[nom]) {
  console.log("commandes :", Object.keys(commandes).join(", "));
  process.exit(nom && nom !== "--help" ? 1 : 0);
}

let page;
try {
  page = await connect();
  await commandes[nom](page, ...args);
} catch (e) {
  console.error(`ECHEC : ${e.message}`);
  process.exitCode = 1;
} finally {
  page?.fermer();
}
