import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { generateTitles } from "./src/generate.js";
import { PUBLIC_DIR } from "./src/corpus.js";

const PORT = Number(process.env.PORT) || 3000;

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "Content-Type": type });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 50_000) throw new Error("Request too large");
  }
  return JSON.parse(raw || "{}");
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      return send(res, 200, fs.readFileSync(path.join(PUBLIC_DIR, "index.html")), "text/html; charset=utf-8");
    }
    if (req.method === "POST" && req.url === "/api/titles") {
      const { idea, details, viewer } = await readJson(req);
      const report = await generateTitles({ idea, details, viewer });
      return send(res, 200, report);
    }
    send(res, 404, { error: "Not found" });
  } catch (err) {
    console.error(err);
    const status = err instanceof Anthropic.APIError ? 502 : 400;
    send(res, status, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`YouTube title creator running at http://localhost:${PORT}`);
});
