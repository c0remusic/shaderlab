interface Props {
  message: string;
  onDismiss: () => void;
}

export function ErrorBanner({ message, onDismiss }: Props) {
  return (
    <div
      style={{
        background: "var(--danger-bg)",
        borderBottom: "1px solid var(--danger-border)",
        color: "var(--text-primary)",
        padding: "var(--space-2) var(--space-3)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <span>{message}</span>
      <button
        onClick={onDismiss}
        aria-label="Fermer"
        style={{ background: "transparent", border: "none", color: "var(--danger)" }}
      >
        ✕
      </button>
    </div>
  );
}
