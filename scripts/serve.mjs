import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, isAbsolute, join, normalize, relative as relativePath, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const port = Number(process.env.PORT || 4173);
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".yaml": "application/yaml; charset=utf-8",
};

const server = createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relative = normalize(pathname).replace(/^[/\\]+/u, "");
    let filename = resolve(join(root, relative || "index.html"));
    const traversalCheck = relativePath(root, filename);
    if (traversalCheck.startsWith("..") || isAbsolute(traversalCheck)) {
      throw new Error("Ugyldig filsti");
    }
    if (statSync(filename).isDirectory()) filename = join(filename, "index.html");
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filename)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    createReadStream(filename).pipe(response);
  } catch (_error) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Ikke funnet");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`ShiftWatch Kalender: http://127.0.0.1:${port}`);
});
