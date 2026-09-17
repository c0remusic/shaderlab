// Petit client CDP reutilisable : evalue une expression dans la page et rend
// la valeur. Ecrit une fois, importe par toutes les sondes de ce dossier.
const CDP = process.env.SHADERLAB_CDP ?? "http://localhost:9222";

export async function connecter() {
  const cibles = await (await fetch(CDP + "/json/list")).json();
  const page = cibles.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page) throw new Error("Aucune page CDP");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, ko) => {
    ws.addEventListener("open", ok, { once: true });
    ws.addEventListener("error", () => ko(new Error("WebSocket refusee")), { once: true });
  });
  let id = 0;
  const attente = new Map();
  const ecouteurs = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && attente.has(m.id)) {
      attente.get(m.id)(m);
      attente.delete(m.id);
    } else if (m.method) ecouteurs.forEach((f) => f(m));
  });
  const envoyer = (method, params = {}) =>
    new Promise((ok) => {
      const n = ++id;
      attente.set(n, ok);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const evaluer = async (expression) => {
    const r = await envoyer("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    const d = r.result?.exceptionDetails;
    if (d) throw new Error(d.exception?.description ?? d.text);
    return r.result?.result?.value;
  };
  return { envoyer, evaluer, ws, surEvenement: (f) => ecouteurs.push(f), fermer: () => ws.close() };
}
