import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(fileURLToPath(new URL("../web/", import.meta.url)));
const fixtures = path.resolve(root, "../prototype/stress/models");
const args = process.argv.slice(2), at = args.indexOf("--port");
const port = at >= 0 ? Number(args[at + 1]) : 8735;
const types = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".html": "text/html",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};
const server = http.createServer(async (req, res) => {
  try {
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405);
      res.end();
      return;
    }
    const name = decodeURIComponent(
      new URL(req.url, "http://127.0.0.1").pathname,
    );
    const model = name.startsWith("/models/"), base = model ? fixtures : root;
    const file = path.resolve(
      base,
      "." + (model ? name.slice(7) : name === "/" ? "/index.html" : name),
    );
    if (!file.startsWith(base + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
server.listen(
  port,
  "127.0.0.1",
  () =>
    console.log(
      `Hjort Support Fins: http://127.0.0.1:${server.address().port}`,
    ),
);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit()));
}
