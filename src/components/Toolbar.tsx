interface Props {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onExport: () => void;
  onOpenFile: () => void;
}

export function Toolbar({ canUndo, canRedo, onUndo, onRedo, onExport, onOpenFile }: Props) {
  return (
    <div style={{ padding: 8, borderBottom: "1px solid #333", display: "flex", gap: 8, color: "#e8e8e8" }}>
      <button onClick={onOpenFile}>Ouvrir</button>
      <button disabled={!canUndo} onClick={onUndo}>
        ↶ Annuler
      </button>
      <button disabled={!canRedo} onClick={onRedo}>
        ↷ Rétablir
      </button>
      <div style={{ flex: 1 }} />
      <button onClick={onExport}>Exporter</button>
    </div>
  );
}
