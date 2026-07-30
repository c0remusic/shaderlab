import { describe, expect, it } from "vitest";
import {
  A3_MM,
  A3_PRINT_DPI,
  NAMED_CANVAS_FORMAT_LABELS,
  PHOTO_CANVAS_FORMAT,
  canvasSizeFor,
  parseFreeCanvasRequest,
  type CanvasFormatRequest,
} from "../../src/layers/canvasFormat";
import { MAX_CANVAS_PIXELS, assertCanvasWithinBudget } from "../../src/render/limits";

/** Photo de référence des mesures VRAM du projet : 6240 × 4160 = 25,96 Mpx. */
const PHOTO_26MP = { width: 6240, height: 4160 };

describe("canvasSizeFor — le défaut ne change rien", () => {
  it("« comme la photo » rend EXACTEMENT les dimensions de la photo", () => {
    expect(canvasSizeFor(PHOTO_CANVAS_FORMAT, PHOTO_26MP)).toEqual(PHOTO_26MP);
  });

  it("le défaut est le format photo — ouvrir sans rien choisir n'a rien à choisir", () => {
    expect(PHOTO_CANVAS_FORMAT).toEqual({ kind: "photo" });
  });

  it("une photo carrée reste carrée, au pixel près", () => {
    expect(canvasSizeFor(PHOTO_CANVAS_FORMAT, { width: 256, height: 256 })).toEqual({
      width: 256,
      height: 256,
    });
  });
});

// LE BUDGET NE BORNE QUE CE QUI A ÉTÉ CHOISI (correctif du 2026-07-30).
//
// La tranche T2 appliquait `assertCanvasWithinBudget` au chemin par défaut, si
// bien qu'une photo de plus de 64 Mpx cessait de s'ouvrir — une régression non
// déclarée, et le message parlait de « Toile » et de « budget » à quelqu'un qui
// n'avait choisi aucune toile. Ces tests fixent l'asymétrie DANS LES DEUX SENS :
// sans le second bloc, l'exemption serait devenue « plus de budget du tout ».
describe("canvasSizeFor — le budget borne une demande, pas un fichier", () => {
  /** 9000 × 7300 = 65,7 Mpx : au-delà du budget, sous la dimension maximale de
   *  texture d'un GPU courant (16384 mesuré sur la machine du projet). Cette
   *  photo s'ouvrait avant la tranche T2. */
  const PHOTO_66MP = { width: 9000, height: 7300 };
  /** Fujifilm GFX100 : 11648 × 8736 = 101,7 Mpx. */
  const PHOTO_GFX100 = { width: 11648, height: 8736 };

  it("une photo au-delà du budget s'ouvre quand même — c'est un fait, pas une demande", () => {
    expect(PHOTO_66MP.width * PHOTO_66MP.height).toBeGreaterThan(MAX_CANVAS_PIXELS);
    expect(canvasSizeFor(PHOTO_CANVAS_FORMAT, PHOTO_66MP)).toEqual(PHOTO_66MP);
    expect(canvasSizeFor(PHOTO_CANVAS_FORMAT, PHOTO_GFX100)).toEqual(PHOTO_GFX100);
  });

  it("la MÊME dimension demandée à la main est refusée", () => {
    // C'est l'asymétrie voulue : ce que le fichier impose passe, ce que
    // l'utilisateur réclame est borné. Le chèque en blanc que le design §5.2
    // refusait reste refusé.
    expect(() =>
      canvasSizeFor({ kind: "libre", width: PHOTO_66MP.width, height: PHOTO_66MP.height }, PHOTO_26MP),
    ).toThrow(/au-delà du budget/);
  });

  it("un format NOMMÉ dérivé d'une photo énorme reste borné", () => {
    // Le carré d'une photo de 101,7 Mpx ferait 11648² = 135,7 Mpx : la photo
    // s'ouvre, mais demander une toile carrée dessus est refusé. L'exemption ne
    // se propage pas au format dérivé de cette même photo.
    expect(() => canvasSizeFor({ kind: "nomme", format: "carre" }, PHOTO_GFX100)).toThrow(
      /au-delà du budget/,
    );
  });

  it("les trois formats nommés restent bornés sur la photo de référence... et donc passent", () => {
    // Garde-fou contre l'exemption trop large : si le budget avait été retiré
    // partout, ce test passerait toujours — c'est le test ci-dessus qui rougit.
    for (const format of ["carre", "quatre-cinq", "a3"] as const) {
      expect(() => canvasSizeFor({ kind: "nomme", format }, PHOTO_26MP)).not.toThrow();
    }
  });
});

describe("canvasSizeFor — formats nommés dérivés par CONTENANCE", () => {
  it("« carré » prend le plus grand côté de la photo : la photo tient entière, à 100 %", () => {
    expect(canvasSizeFor({ kind: "nomme", format: "carre" }, PHOTO_26MP)).toEqual({
      width: 6240,
      height: 6240,
    });
  });

  it("« carré » sur une photo portrait prend aussi le plus grand côté", () => {
    expect(canvasSizeFor({ kind: "nomme", format: "carre" }, { width: 3000, height: 4000 })).toEqual({
      width: 4000,
      height: 4000,
    });
  });

  it("« carré » sur une photo déjà carrée ne l'agrandit pas d'un pixel", () => {
    expect(canvasSizeFor({ kind: "nomme", format: "carre" }, { width: 512, height: 512 })).toEqual({
      width: 512,
      height: 512,
    });
  });

  it("« 4:5 » suit l'ORIENTATION de la photo — un paysage rend 5:4, jamais un portrait", () => {
    // Orienter le ratio comme la photo, plutôt que d'imposer le portrait,
    // évite 50 % de surface (donc de VRAM) gagnés uniquement pour tourner le
    // cadre. Ici : 6240 × 4992 = 31,2 Mpx, contre 6240 × 7800 = 48,7 Mpx en
    // portrait forcé.
    expect(canvasSizeFor({ kind: "nomme", format: "quatre-cinq" }, PHOTO_26MP)).toEqual({
      width: 6240,
      height: 4992,
    });
  });

  it("« 4:5 » sur une photo portrait rend bien un portrait 4:5", () => {
    expect(canvasSizeFor({ kind: "nomme", format: "quatre-cinq" }, { width: 4000, height: 4000 })).toEqual({
      width: 4000,
      height: 5000,
    });
  });

  it("« 4:5 » contient toujours la photo à sa résolution native", () => {
    for (const photo of [
      { width: 6240, height: 4160 },
      { width: 4160, height: 6240 },
      { width: 1000, height: 1000 },
      { width: 3, height: 7 },
    ]) {
      const toile = canvasSizeFor({ kind: "nomme", format: "quatre-cinq" }, photo);
      expect(toile.width).toBeGreaterThanOrEqual(photo.width);
      expect(toile.height).toBeGreaterThanOrEqual(photo.height);
    }
  });

  it("« A3 » est ABSOLU : 297 × 420 mm à 300 dpi, indépendant de la photo", () => {
    // 297 / 25,4 × 300 = 3507,87 → 3508 ; 420 / 25,4 × 300 = 4960,63 → 4961.
    const paysage = canvasSizeFor({ kind: "nomme", format: "a3" }, PHOTO_26MP);
    expect(paysage).toEqual({ width: 4961, height: 3508 });
    const portrait = canvasSizeFor({ kind: "nomme", format: "a3" }, { width: 3000, height: 4000 });
    expect(portrait).toEqual({ width: 3508, height: 4961 });
  });

  it("« A3 » peut être PLUS PETIT que la photo — le débordement est assumé, et il AMPUTE", () => {
    // 17,4 Mpx contre 26 Mpx : la photo dépasse la toile, donc l'export en rend
    // un recadrage. Assumé et écrit dans les Conséquences d'ADR-0007 depuis le
    // 2026-07-30 (R2) — distinct du débordement de `PhotoPanel`, qui suit un
    // geste de l'utilisateur là où celui-ci est l'état par DÉFAUT à l'ouverture.
    // La seule alternative aurait été de trahir le format d'impression.
    const toile = canvasSizeFor({ kind: "nomme", format: "a3" }, PHOTO_26MP);
    expect(toile.width * toile.height).toBeLessThan(PHOTO_26MP.width * PHOTO_26MP.height);
    // La photo dépasse sur les DEUX axes, pas seulement en surface : c'est ce
    // qui rend le recadrage visible sur les quatre bords.
    expect(toile.width).toBeLessThan(PHOTO_26MP.width);
    expect(toile.height).toBeLessThan(PHOTO_26MP.height);
  });

  it("les deux formats RELATIFS ne peuvent jamais amputer, eux — c'est ce qui isole A3", () => {
    // La contrepartie du test ci-dessus : si un jour « carré » ou « 4:5 » se
    // mettait à rogner, ce serait un défaut et non un arbitrage assumé.
    for (const format of ["carre", "quatre-cinq"] as const) {
      for (const photo of [PHOTO_26MP, { width: 3000, height: 4000 }, { width: 512, height: 512 }]) {
        const toile = canvasSizeFor({ kind: "nomme", format }, photo);
        expect(toile.width).toBeGreaterThanOrEqual(photo.width);
        expect(toile.height).toBeGreaterThanOrEqual(photo.height);
      }
    }
  });

  it("le libellé d'A3 annonce ses pixels, DÉRIVÉS et non recopiés (R2)", () => {
    // Le menu s'ouvre AVANT que la photo soit choisie : il ne peut pas avertir
    // d'un recadrage, il ne détient aucune dimension à comparer. Il expose donc
    // les pixels du format, seul fait qu'il connaisse. Le test vérifie que le
    // libellé porte le dpi ET la paire de pixels, et que celle-ci vient du même
    // calcul que le format — changer `A3_PRINT_DPI` doit changer les deux.
    const label = NAMED_CANVAS_FORMAT_LABELS.a3;
    const portrait = canvasSizeFor({ kind: "nomme", format: "a3" }, { width: 3000, height: 4000 });
    expect(label).toContain(String(A3_PRINT_DPI));
    expect(label).toContain(`${portrait.width} × ${portrait.height} px`);
    // Les formats relatifs n'annoncent pas de pixels : ils dépendent de la photo.
    expect(NAMED_CANVAS_FORMAT_LABELS.carre).not.toMatch(/px/);
    expect(NAMED_CANVAS_FORMAT_LABELS["quatre-cinq"]).not.toMatch(/px/);
  });

  it("A3 est dérivé des millimètres et du dpi, pas d'un couple de pixels recopié", () => {
    expect(A3_PRINT_DPI).toBe(300);
    expect(A3_MM).toEqual({ short: 297, long: 420 });
  });
});

// Cas réel du 2026-07-30, trouvé au rebasage : `Canvas.onOpenFile` était branché
// directement sur `handleOpenFile`, et `EmptyWorkspace` branche cette prop sur un
// `onClick` — React passait donc un SyntheticEvent dans le paramètre
// `canvasFormat` ajouté par la tranche T2. Le paramètre par défaut ne protège de
// rien : un événement n'est pas `undefined`. Mesuré sur la vraie fenêtre avant
// correctif : « TypeError: Cannot read properties of undefined (reading 'width') »,
// affiché APRÈS que l'utilisateur ait choisi son fichier.
describe("canvasSizeFor — une requête malformée échoue en se nommant", () => {
  it("un objet qui n'est pas une demande de format lève une erreur NOMMÉE", () => {
    const fauxEvent = { type: "click", nativeEvent: {} } as unknown as CanvasFormatRequest;
    expect(() => canvasSizeFor(fauxEvent, PHOTO_26MP)).toThrow(/Format de toile inconnu/);
    // Et surtout PAS un TypeError sur une lecture de propriété.
    expect(() => canvasSizeFor(fauxEvent, PHOTO_26MP)).not.toThrow(TypeError);
  });

  it("un format nommé inconnu lève aussi, plutôt que de rendre undefined", () => {
    const inconnu = { kind: "nomme", format: "a2" } as unknown as CanvasFormatRequest;
    expect(() => canvasSizeFor(inconnu, PHOTO_26MP)).toThrow(/Format de toile inconnu/);
  });
});

describe("canvasSizeFor — saisie libre", () => {
  it("rend exactement ce qui est saisi", () => {
    expect(canvasSizeFor({ kind: "libre", width: 1080, height: 1350 }, PHOTO_26MP)).toEqual({
      width: 1080,
      height: 1350,
    });
  });

  it("refuse une dimension non entière plutôt que de l'arrondir en silence", () => {
    expect(() => canvasSizeFor({ kind: "libre", width: 100.5, height: 100 }, PHOTO_26MP)).toThrow(
      /entier/,
    );
  });

  it("refuse une dimension nulle ou négative", () => {
    for (const bad of [0, -1]) {
      expect(() => canvasSizeFor({ kind: "libre", width: bad, height: 100 }, PHOTO_26MP)).toThrow();
      expect(() => canvasSizeFor({ kind: "libre", width: 100, height: bad }, PHOTO_26MP)).toThrow();
    }
  });

  it("refuse NaN / Infinity", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => canvasSizeFor({ kind: "libre", width: bad, height: 100 }, PHOTO_26MP)).toThrow();
    }
  });
});

describe("parseFreeCanvasRequest — validation de la saisie libre", () => {
  it("accepte deux entiers et rend la demande de format", () => {
    expect(parseFreeCanvasRequest("1080", "1350")).toEqual({
      kind: "ok",
      request: { kind: "libre", width: 1080, height: 1350 },
    });
  });

  it("tolère les espaces autour des nombres", () => {
    expect(parseFreeCanvasRequest("  800 ", " 800")).toEqual({
      kind: "ok",
      request: { kind: "libre", width: 800, height: 800 },
    });
  });

  it("un champ vide n'est pas une erreur de pipeline : un message, pas une exception", () => {
    const r = parseFreeCanvasRequest("", "800");
    expect(r.kind).toBe("erreur");
    expect(r.kind === "erreur" && r.message).toMatch(/Largeur et hauteur/);
  });

  it("refuse une décimale — jamais d'arrondi silencieux", () => {
    const r = parseFreeCanvasRequest("100.5", "100");
    expect(r.kind).toBe("erreur");
    expect(r.kind === "erreur" && r.message).toMatch(/entier/);
  });

  it("refuse une saisie non numérique", () => {
    expect(parseFreeCanvasRequest("abc", "100").kind).toBe("erreur");
  });

  // R5 du 2026-07-30 : `Number()` seul acceptait des écritures qui ne sont pas
  // des entiers décimaux et les convertissait en silence. Le module documente
  // une validation d'entier décimal ; ces cas fixent qu'il la fait vraiment.
  it("refuse une écriture qui n'est pas un entier DÉCIMAL, même si Number() la convertirait", () => {
    // Avant le correctif : "0x2000" -> 8192, "1e4" -> 10000, "0b1010" -> 10,
    // "0o20" -> 16 — tous acceptés en silence.
    for (const bad of ["0x2000", "1e4", "0b1010", "0o20", "1_000", " 8e2 ", "Infinity"]) {
      const r = parseFreeCanvasRequest(bad, "800");
      expect(r.kind, `« ${bad} » aurait dû être refusé`).toBe("erreur");
      expect(r.kind === "erreur" && r.message).toMatch(/entier/);
    }
  });

  it("refuse un signe explicite — « +800 » est une expression, pas une dimension", () => {
    expect(parseFreeCanvasRequest("+800", "800").kind).toBe("erreur");
    expect(parseFreeCanvasRequest("-800", "800").kind).toBe("erreur");
  });

  it("« 0 » passe la forme mais est refusé sur le fond, par le même message qu'avant", () => {
    // La forme est bien un entier décimal : c'est `canvasSizeFor` qui refuse,
    // sur « strictement positif ». Le correctif R5 n'a pas déplacé ce refus.
    const r = parseFreeCanvasRequest("0", "800");
    expect(r.kind).toBe("erreur");
    expect(r.kind === "erreur" && r.message).toMatch(/strictement positif/);
  });

  it("refuse au-delà du budget, en reprenant le message de la borne", () => {
    const r = parseFreeCanvasRequest("20000", "20000");
    expect(r.kind).toBe("erreur");
    expect(r.kind === "erreur" && r.message).toMatch(/Mpx/);
  });
});

describe("assertCanvasWithinBudget — la borne nommée du budget VRAM", () => {
  it("laisse passer la borne exacte", () => {
    expect(() => assertCanvasWithinBudget(8000, MAX_CANVAS_PIXELS / 8000)).not.toThrow();
  });

  it("refuse un pixel au-dessus, en nommant la borne et la surface demandée", () => {
    const side = Math.ceil(Math.sqrt(MAX_CANVAS_PIXELS)) + 1;
    expect(() => assertCanvasWithinBudget(side, side)).toThrow(/Mpx/);
  });

  it("la borne est celle que le module publie, pas un nombre recopié ailleurs", () => {
    expect(MAX_CANVAS_PIXELS).toBe(64_000_000);
  });

  it("tout format nommé dérivé de la photo de 26 Mpx tient sous la borne", () => {
    // La raison d'être du calibrage : les trois formats proposés à l'ouverture
    // ne doivent pas être refusés sur la photo de référence du projet.
    for (const format of ["carre", "quatre-cinq", "a3"] as const) {
      expect(() => canvasSizeFor({ kind: "nomme", format }, PHOTO_26MP)).not.toThrow();
    }
  });

  it("une saisie libre au-delà de la borne est refusée par le même chemin", () => {
    expect(() => canvasSizeFor({ kind: "libre", width: 20000, height: 20000 }, PHOTO_26MP)).toThrow(
      /Mpx/,
    );
  });

  it("un format nommé qui dépasserait la borne est refusé, pas tronqué", () => {
    // Une photo panoramique très large rend un carré énorme : 9000² = 81 Mpx.
    expect(() => canvasSizeFor({ kind: "nomme", format: "carre" }, { width: 9000, height: 1200 })).toThrow(
      /Mpx/,
    );
  });
});
