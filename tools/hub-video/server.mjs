// Local-only helper for making the Hub video: serves this folder and saves the recorded video that
// render.html posts back (POST /save?name=...), into ./output/. Listens on 127.0.0.1 only.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, normalize, extname, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || 5182);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json",
  ".mp3": "audio/mpeg", ".png": "image/png", ".mp4": "video/mp4", ".webm": "video/webm" };

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "POST" && url.pathname === "/save") {
    const name = basename(url.searchParams.get("name") || "hub-video-silent.mp4").replace(/[^\w.-]/g, "_");
    const chunks = [];
    for await (const c of req) chunks.push(c);
    await mkdir(join(root, "output"), { recursive: true });
    await writeFile(join(root, "output", name), Buffer.concat(chunks));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ saved: "output/" + name, bytes: chunks.reduce((n, c) => n + c.length, 0) }));
    return;
  }
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  if (p.endsWith("/")) p += "render.html";
  try {
    const body = await readFile(join(root, p));
    res.writeHead(200, { "Content-Type": types[extname(p)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
}).listen(port, "127.0.0.1", () => console.log("hub-video on", port));
