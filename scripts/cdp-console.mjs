const port = Number(process.argv[2] ?? 9222);
const deadline = Date.now() + 30_000;

async function findTarget() {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      const targets = await response.json();
      const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (target) return target;
    } catch {
      // WebView2 may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Aucune cible WebView2 CDP sur le port ${port} après 30 s.`);
}

function formatRemoteObject(value) {
  if (Object.hasOwn(value, "value")) {
    return typeof value.value === "string" ? value.value : JSON.stringify(value.value);
  }
  return value.description ?? value.type;
}

const target = await findTarget();
const socket = new WebSocket(target.webSocketDebuggerUrl);
socket.addEventListener("open", () => {
  socket.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
  console.log(`[cdp] connecté: ${target.title || target.url}`);
});
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data.toString());
  if (message.method === "Runtime.consoleAPICalled") {
    const { type, args, timestamp } = message.params;
    console.log(`[browser ${new Date(timestamp).toISOString()}] ${type}: ${args.map(formatRemoteObject).join(" ")}`);
  }
  if (message.method === "Runtime.exceptionThrown") {
    const details = message.params.exceptionDetails;
    console.error(`[browser exception] ${details.exception?.description ?? details.text}`);
  }
});
socket.addEventListener("close", () => process.exit(0));
socket.addEventListener("error", () => {
  console.error("[cdp] erreur de connexion WebSocket");
  process.exit(1);
});
