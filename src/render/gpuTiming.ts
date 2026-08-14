/**
 * CHRONOMÉTRAGE GPU PAR PASSE (`timestamp-query`).
 *
 * POURQUOI CE FICHIER EXISTE (mesuré le 2026-08-14). Le dépôt avait DEUX
 * instruments de performance, et aucun des deux ne voit le GPU :
 *
 *  - `frameDiagnostics.ts` rend `jsEncodeMs` — le temps d'ENCODAGE JS. Le nom
 *    est honnête : il peut afficher 2 ms pendant que le GPU en passe 60.
 *  - `scripts/perf-probe.mjs` rend une CADENCE en horloge murale pendant un
 *    vrai glissement. Elle inclut le GPU, mais confondu avec tout le reste, et
 *    pour la pile ENTIÈRE.
 *
 * Aucun ne sait dire QUELLE passe coûte. C'est ce qui a manqué le 2026-08-13 :
 * la diffusion de `glass` passée de 9 à 16 prélèvements a coûté 37 % de cadence
 * (15,9 -> 10,0 images/s sur 26 Mpx), et c'est Antoine qui l'a signalé en pleine
 * session — pas l'instrument. Sur `outlines` et ses neuf passes de pyramide, la
 * question n'a toujours aucune réponse mesurée.
 *
 * DISPONIBILITÉ VÉRIFIÉE sur cette machine le 2026-08-14 (RTX 2060, WebView2
 * 151.0.4129) : `timestamp-query` est exposée par l'adapter, `requestDevice`
 * avec la feature requise passe, et `createQuerySet({type:"timestamp"})` aussi.
 * Aucun outil externe (Nsight & co) n'est nécessaire pour cette mesure.
 *
 * ── TROIS CHOIX DE CONCEPTION, ET LEURS RAISONS ──────────────────────────────
 *
 * 1. CAPTURE À LA DEMANDE, UNE FRAME À LA FOIS. Éteint, ce module n'attache
 *    AUCUN `timestampWrites` et n'alloue rien : le chemin chaud est inchangé,
 *    au sens strict. Deux raisons. D'abord un buffer mappable ne peut pas être
 *    re-mappé tant qu'il est en vol — un mode permanent demanderait un anneau
 *    de buffers. Ensuite ce dépôt mesure DÉLIBÉRÉMENT ; un profilage
 *    toujours-actif est une taxe permanente pour une question posée trois fois
 *    par mois.
 *
 * 2. LA FEATURE EST OPTIONNELLE, JAMAIS REQUISE. `initGpu` la demande si
 *    l'adapter l'annonce et n'échoue pas sinon (`available` reste faux, l'app
 *    tourne). Une machine sans la feature doit rendre des images, pas une
 *    erreur de démarrage.
 *
 * 3. L'INSTRUMENT DÉCLARE SA PROPRE GRANULARITÉ. Chromium QUANTIFIE les
 *    timestamps GPU (défense anti-empreinte / canaux temporels) : les valeurs
 *    remontent arrondies, typiquement au pas de 100 µs. Une passe de 0,3 ms lue
 *    sous ce pas rend 0,3 ms ou 0,4 ms — pas une mesure, un rangement en
 *    casiers. Plutôt que de le supposer, `detecterQuantumNs` le DÉDUIT du PGCD
 *    des valeurs brutes et le publie dans le rapport. Une mesure dont on ignore
 *    le pas est une mesure qu'on va sur-interpréter — c'est exactement la faute
 *    « l'instrument fabrique le résultat » payée sur la sonde à 63 `input`.
 *    Pour lever la quantification sur une session de profilage, essayer
 *    `--disable-dawn-features=timestamp_quantization` dans
 *    `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` — et vérifier que `quantumNs`
 *    tombe, plutôt que de croire le drapeau sur parole.
 */

/** Une passe chronométrée. `durationMs` est un temps GPU, pas mural. */
export interface PassTiming {
  /** Libellé posé par l'appelant — `glass#2`, `outlines/pyramide-3`, `present`. */
  label: string;
  durationMs: number;
}

export interface GpuTimingReport {
  passes: PassTiming[];
  /** Somme des passes. PAS le temps de frame : les passes peuvent se
   *  chevaucher côté pilote, et tout ce qui n'est pas chronométré manque. */
  totalMs: number;
  /** Pas de quantification déduit des valeurs brutes, en nanosecondes. Une
   *  durée du même ordre que ce pas n'est pas mesurée, elle est rangée. */
  quantumNs: number;
  /** Passes demandées au-delà de `maxPasses`, donc non chronométrées. Jamais
   *  silencieux : un rapport tronqué qui se présente comme complet ment. */
  droppedPasses: number;
}

/** Deux timestamps par passe (début, fin). 64 passes couvrent largement une
 *  pile réelle — `outlines` seul en demande neuf. */
const TIMESTAMPS_PAR_PASSE = 2;
const MAX_PASSES_DEFAUT = 64;

/**
 * PGCD des valeurs non nulles : si le pilote (ou Chromium) quantifie, toutes
 * les durées sont des multiples du pas, et leur PGCD LE révèle. Sur des valeurs
 * non quantifiées le PGCD retombe à 1 ns ou proche, ce qui se lit aussi bien.
 */
export function detecterQuantumNs(valeursNs: bigint[]): number {
  const pgcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : pgcd(b, a % b));
  let q = 0n;
  for (const v of valeursNs) {
    if (v <= 0n) continue;
    q = pgcd(q, v);
    if (q === 1n) break;
  }
  return Number(q);
}

export class GpuTiming {
  private querySet: GPUQuerySet | null = null;
  private resolveBuffer: GPUBuffer | null = null;
  private readbackBuffer: GPUBuffer | null = null;

  /** Libellés de la frame en cours de capture, dans l'ordre des slots. */
  private labels: string[] = [];
  private dropped = 0;
  /** Armé pour la PROCHAINE frame ; retombe à faux dès qu'elle est encodée. */
  private armed = false;
  /** Une capture est en vol (buffer mappé ou en cours de mapping). Empêche
   *  d'en armer une seconde, ce qui ferait échouer `mapAsync`. */
  private inFlight = false;
  private resolveReport: ((r: GpuTimingReport) => void) | null = null;
  private rejectReport: ((e: Error) => void) | null = null;

  constructor(
    private readonly device: GPUDevice,
    /** Vrai seulement si le device a été obtenu AVEC la feature. Le lire du
     *  device plutôt que le supposer : un device peut l'annoncer sur l'adapter
     *  et ne pas l'avoir reçue. */
    readonly available: boolean = device.features.has("timestamp-query"),
    private readonly maxPasses: number = MAX_PASSES_DEFAUT,
  ) {}

  /** Vrai pendant l'encodage de la frame capturée — les appelants n'ont pas à
   *  connaître l'état interne pour décider s'ils posent un libellé. */
  get capturing(): boolean {
    return this.armed;
  }

  /**
   * Arme une capture pour la prochaine frame rendue. Rend le rapport quand les
   * timestamps sont relus — après la soumission ET le mapping, donc pas dans la
   * même tâche.
   *
   * Rejette si une capture est déjà en vol : deux captures concurrentes
   * partageraient le buffer mappable. Refuser est le comportement détective —
   * un repli silencieux rendrait le rapport de l'AUTRE capture.
   */
  arm(): Promise<GpuTimingReport> {
    if (!this.available) {
      return Promise.reject(new Error("timestamp-query indisponible sur ce device."));
    }
    if (this.inFlight || this.armed) {
      return Promise.reject(new Error("Une capture GPU est déjà en cours."));
    }
    this.ensureResources();
    this.armed = true;
    this.labels = [];
    this.dropped = 0;
    return new Promise<GpuTimingReport>((resolve, reject) => {
      this.resolveReport = resolve;
      this.rejectReport = reject;
    });
  }

  /**
   * Réserve deux slots pour une passe et rend le descripteur à poser sur
   * `beginRenderPass`. Rend `undefined` hors capture — l'appelant étale alors
   * `...(timing.slotFor(x) ?? {})` et le descripteur est identique à l'existant,
   * au champ près. C'est ce qui garantit qu'une frame non capturée est encodée
   * exactement comme avant ce fichier.
   */
  slotFor(label: string): { timestampWrites: GPURenderPassTimestampWrites } | undefined {
    if (!this.armed || !this.querySet) return undefined;
    if (this.labels.length >= this.maxPasses) {
      this.dropped += 1;
      return undefined;
    }
    const index = this.labels.length;
    this.labels.push(label);
    return {
      timestampWrites: {
        querySet: this.querySet,
        beginningOfPassWriteIndex: index * TIMESTAMPS_PAR_PASSE,
        endOfPassWriteIndex: index * TIMESTAMPS_PAR_PASSE + 1,
      },
    };
  }

  /**
   * À appeler sur l'encodeur de la frame AVANT `finish()`. Résout le query set
   * dans un buffer GPU puis le recopie vers le buffer mappable — les deux
   * commandes doivent être dans le même encodeur que les passes mesurées.
   */
  endFrame(encoder: GPUCommandEncoder): void {
    if (!this.armed) return;
    this.armed = false;
    const count = this.labels.length;
    if (count === 0 || !this.querySet || !this.resolveBuffer || !this.readbackBuffer) {
      this.livrerRapport([], 0);
      return;
    }
    const octets = count * TIMESTAMPS_PAR_PASSE * 8;
    encoder.resolveQuerySet(this.querySet, 0, count * TIMESTAMPS_PAR_PASSE, this.resolveBuffer, 0);
    encoder.copyBufferToBuffer(this.resolveBuffer, 0, this.readbackBuffer, 0, octets);
    this.inFlight = true;
  }

  /**
   * À appeler APRÈS `queue.submit`. Lance la relecture asynchrone ; le rapport
   * promis par `arm()` se résout quand elle aboutit.
   *
   * Même point du cycle que la destruction des ressources jetables et que
   * `releaseFrameTargets` : après la soumission, les commandes en vol tiennent
   * la mémoire côté pilote.
   */
  afterSubmit(): void {
    if (!this.inFlight || !this.readbackBuffer) return;
    const buffer = this.readbackBuffer;
    const labels = this.labels;
    const dropped = this.dropped;
    const octets = labels.length * TIMESTAMPS_PAR_PASSE * 8;

    void buffer
      .mapAsync(GPUMapMode.READ, 0, octets)
      .then(() => {
        const brut = new BigUint64Array(buffer.getMappedRange(0, octets).slice(0));
        buffer.unmap();
        const durees: bigint[] = [];
        for (let i = 0; i < labels.length; i++) {
          const debut = brut[i * TIMESTAMPS_PAR_PASSE];
          const fin = brut[i * TIMESTAMPS_PAR_PASSE + 1];
          // Un timestamp peut valoir 0 si le pilote n'a pas pu l'écrire — le
          // laisser passer produirait une durée absurde issue de la soustraction.
          durees.push(fin > debut ? fin - debut : 0n);
        }
        const passes = labels.map((label, i) => ({
          label,
          durationMs: Number(durees[i]) / 1_000_000,
        }));
        this.livrerRapport(passes, dropped, detecterQuantumNs(durees));
      })
      .catch((e: unknown) => {
        this.inFlight = false;
        this.rejectReport?.(new Error(`Relecture des timestamps GPU échouée : ${String(e)}`));
        this.resolveReport = null;
        this.rejectReport = null;
      });
  }

  private livrerRapport(passes: PassTiming[], dropped: number, quantumNs = 0): void {
    this.inFlight = false;
    const rapport: GpuTimingReport = {
      passes,
      totalMs: passes.reduce((somme, p) => somme + p.durationMs, 0),
      quantumNs,
      droppedPasses: dropped,
    };
    this.resolveReport?.(rapport);
    this.resolveReport = null;
    this.rejectReport = null;
  }

  private ensureResources(): void {
    if (this.querySet) return;
    const timestamps = this.maxPasses * TIMESTAMPS_PAR_PASSE;
    this.querySet = this.device.createQuerySet({ type: "timestamp", count: timestamps });
    this.resolveBuffer = this.device.createBuffer({
      size: timestamps * 8,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    this.readbackBuffer = this.device.createBuffer({
      size: timestamps * 8,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  destroy(): void {
    this.querySet?.destroy();
    this.resolveBuffer?.destroy();
    this.readbackBuffer?.destroy();
    this.querySet = null;
    this.resolveBuffer = null;
    this.readbackBuffer = null;
  }
}
