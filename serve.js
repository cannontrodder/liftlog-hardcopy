const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const url = require("url");

const root = process.cwd();
const preferredPort = Number(process.env.PORT || 4173);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function safeResolve(requestPath) {
  const decoded = decodeURIComponent(requestPath);
  const cleaned = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const resolved = path.join(root, cleaned);
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

async function serveFile(res, filePath) {
  try {
    const stat = await fsp.stat(filePath);
    const target = stat.isDirectory() ? path.join(filePath, "index.html") : filePath;
    const data = await fsp.readFile(target);
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

function createServer() {
  return http.createServer((req, res) => {
    const parsed = url.parse(req.url || "/");
    const pathname = parsed.pathname === "/" ? "/index.html" : parsed.pathname || "/index.html";
    const resolved = safeResolve(pathname);
    if (!resolved) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Bad request");
      return;
    }
    serveFile(res, resolved);
  });
}

function listen(port) {
  const server = createServer();
  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE" && port < preferredPort + 20) {
      listen(port + 1);
      return;
    }
    throw err;
  });
  server.listen(port, "0.0.0.0", () => {
    console.log(`LiftLog spike running at http://localhost:${port}`);
  });
}

listen(preferredPort);
