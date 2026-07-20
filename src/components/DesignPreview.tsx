import {
  ChevronDown,
  Download,
  Eye,
  FolderOpen,
  Image as ImageIcon,
  Layers3,
  MoreHorizontal,
  Paintbrush,
  Plus,
  Redo2,
  SlidersHorizontal,
  Undo2,
} from "lucide-react";
import "./DesignPreview.css";

type Direction = "studio" | "graphite" | "editorial";

const directions: Array<{
  id: Direction;
  index: string;
  name: string;
  description: string;
}> = [
  {
    id: "studio",
    index: "01",
    name: "Studio pro",
    description: "Dense, précis, familier. La toile reste au centre de chaque décision.",
  },
  {
    id: "graphite",
    index: "02",
    name: "Graphite moderne",
    description: "Plus calme et tactile, avec des surfaces détachées et un rythme généreux.",
  },
  {
    id: "editorial",
    index: "03",
    name: "Noir éditorial",
    description: "Radical, contrasté et typographique. Un outil créatif avec une vraie signature.",
  },
];

function ToolButton({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <button className="mock-icon-button" type="button" aria-label={label}>
      {children}
    </button>
  );
}

function Slider({ label, value, fill }: { label: string; value: string; fill: string }) {
  return (
    <div className="mock-control">
      <div className="mock-control__label">
        <span>{label}</span>
        <span className="mock-control__value">{value}</span>
      </div>
      <div className="mock-slider" aria-hidden="true">
        <span style={{ width: fill }} />
      </div>
    </div>
  );
}

function Mockup({ direction }: { direction: Direction }) {
  const item = directions.find((entry) => entry.id === direction)!;

  return (
    <article className={`design-card design-card--${direction}`} aria-labelledby={`${direction}-title`}>
      <header className="design-card__heading">
        <div className="design-card__number">{item.index}</div>
        <div>
          <h2 id={`${direction}-title`}>{item.name}</h2>
          <p>{item.description}</p>
        </div>
        <span className="design-card__tag">Monochrome</span>
      </header>

      <div className="mock-app">
        <div className="mock-toolbar">
          <div className="mock-brand">
            <span className="mock-brand__mark"><Layers3 aria-hidden="true" /></span>
            <span>ShaderLab</span>
          </div>
          <div className="mock-toolbar__group">
            <button className="mock-button mock-button--quiet" type="button">
              <FolderOpen aria-hidden="true" /> Ouvrir
            </button>
            <ToolButton label="Annuler"><Undo2 aria-hidden="true" /></ToolButton>
            <ToolButton label="Rétablir"><Redo2 aria-hidden="true" /></ToolButton>
          </div>
          <div className="mock-document">
            <span>portrait_01.tif</span>
            <span>24 MP</span>
          </div>
          <button className="mock-button mock-button--primary" type="button">
            <Download aria-hidden="true" /> Exporter
          </button>
        </div>

        <div className="mock-workspace">
          <section className="mock-stage" aria-label="Aperçu de l’image">
            <div className="mock-stage__meta">
              <span>100%</span>
              <span>6000 × 4000</span>
            </div>
            <div className="mock-image">
              <div className="mock-image__scene" />
              <div className="mock-image__label">
                <ImageIcon aria-hidden="true" />
                <span>Aperçu image</span>
              </div>
            </div>
            <div className="mock-stage__footer">
              <span>RVB · 16 bits</span>
              <span>Profil Adobe RGB</span>
            </div>
          </section>

          <aside className="mock-inspector">
            <div className="mock-panel-header">
              <div>
                <span className="mock-eyebrow">Composition</span>
                <h3>Calques</h3>
              </div>
              <ToolButton label="Ajouter un calque"><Plus aria-hidden="true" /></ToolButton>
            </div>

            <div className="mock-layers">
              <div className="mock-layer mock-layer--active">
                <span className="mock-layer__grip">⋮⋮</span>
                <span className="mock-layer__icon"><SlidersHorizontal aria-hidden="true" /></span>
                <span className="mock-layer__name">Grain</span>
                <Eye aria-hidden="true" />
              </div>
              <div className="mock-layer">
                <span className="mock-layer__grip">⋮⋮</span>
                <span className="mock-layer__icon"><SlidersHorizontal aria-hidden="true" /></span>
                <span className="mock-layer__name">Bloom</span>
                <Eye aria-hidden="true" />
              </div>
              <div className="mock-layer">
                <span className="mock-layer__grip">⋮⋮</span>
                <span className="mock-layer__icon"><SlidersHorizontal aria-hidden="true" /></span>
                <span className="mock-layer__name">Contraste</span>
                <Eye aria-hidden="true" />
              </div>
            </div>

            <div className="mock-divider" />

            <div className="mock-panel-header mock-panel-header--settings">
              <div>
                <span className="mock-eyebrow">Effet sélectionné</span>
                <h3>Grain</h3>
              </div>
              <ToolButton label="Plus d’options"><MoreHorizontal aria-hidden="true" /></ToolButton>
            </div>

            <div className="mock-controls">
              <Slider label="Intensité" value="42" fill="42%" />
              <Slider label="Taille" value="18" fill="28%" />
              <Slider label="Rugosité" value="67" fill="67%" />
            </div>

            <button className="mock-mask" type="button">
              <span><Paintbrush aria-hidden="true" /> Peindre le masque</span>
              <ChevronDown aria-hidden="true" />
            </button>
          </aside>
        </div>
      </div>
    </article>
  );
}

export function DesignPreview() {
  return (
    <main className="design-preview">
      <header className="design-preview__intro">
        <div>
          <p className="design-preview__kicker">ShaderLab / exploration visuelle</p>
          <h1>Trois façons de mettre<br />l’image au premier plan.</h1>
        </div>
        <div className="design-preview__brief">
          <p>Même structure. Même contenu. Trois niveaux de densité et de caractère.</p>
          <span>Choisis une direction pour la prochaine passe.</span>
        </div>
      </header>

      <nav className="design-preview__nav" aria-label="Directions visuelles">
        {directions.map((direction) => (
          <a href={`#${direction.id}-title`} key={direction.id}>
            <span>{direction.index}</span>
            {direction.name}
          </a>
        ))}
      </nav>

      <div className="design-preview__gallery">
        {directions.map((direction) => (
          <Mockup direction={direction.id} key={direction.id} />
        ))}
      </div>
    </main>
  );
}
