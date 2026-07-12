interface Props {
  message: string;
  onDismiss: () => void;
}

export function ErrorBanner({ message, onDismiss }: Props) {
  return (
    <div style={{ background: "#5a1a1a", color: "#e8e8e8", padding: 8, display: "flex", justifyContent: "space-between" }}>
      <span>{message}</span>
      <button onClick={onDismiss}>✕</button>
    </div>
  );
}
