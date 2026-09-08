import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
const DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "") || "planche-06-aquarelle.html";
    const buf = await readFile(path.join(DIR, p));
    res.writeHead(200, { "Content-Type": p.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream" });
    res.end(buf);
  } catch { res.writeHead(404); res.end("404"); }
}).listen(8099, () => console.log("up on 8099"));
