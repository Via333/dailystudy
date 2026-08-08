import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { ROOT } from "./lib.mjs";

const port = Number(process.env.PORT || 4173);
const dist = path.join(ROOT, "dist");
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8"
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    let relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    if (!relative || relative.endsWith("/")) relative += "index.html";
    const candidate = path.resolve(dist, relative);
    if (!candidate.startsWith(`${dist}${path.sep}`) && candidate !== path.join(dist, "index.html")) {
      throw new Error("Invalid path");
    }
    let file = candidate;
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
      await access(file);
    } catch {
      file = path.join(dist, "404.html");
      response.statusCode = 404;
    }
    response.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
    response.setHeader("Cache-Control", "no-cache");
    createReadStream(file).pipe(response);
  } catch {
    response.statusCode = 400;
    response.end("Bad request");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Local URL: http://127.0.0.1:${port}`);
});
