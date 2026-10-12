import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT, verifyPin } from "./db.js";
import { testState, startTest, saveClip, MAX_CLIP_BYTES } from "./assessment.js";
import { queue, attemptDetail, saveScore, setOpenTest, streamClip } from "./scoring.js";

const PUBLIC = path.join(ROOT, "public");
// Modules shared by server and browser.
const SHARED = { "rubric.js": path.join(ROOT, "src", "rubric.js") };
const SESSION_DAYS = 30;
const COOKIE = "or_sid";
const HOME = { student: "/room", coach: "/coach", management: "/dashboard" };

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(self), microphone=(self), geolocation=()",
};

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

function send(res, status, body, type = "application/json; charset=utf-8", extra = {}) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...SECURITY_HEADERS, ...extra });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}

const redirect = (res, to, extra = {}) => {
  res.writeHead(302, { Location: to, ...SECURITY_HEADERS, ...extra });
  res.end();
};

async function readJson(req) {
  if (!String(req.headers["content-type"] || "").startsWith("application/json")) throw httpError(415, "JSON only");
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw httpError(413, "Too large");
  }
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw httpError(400, "Bad JSON");
  }
}

async function readRaw(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw httpError(413, "Recording too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function cookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).filter((p) => p[0]).map(([k, ...v]) => [k, v.join("=")]),
  );
}

function sessionCookie(token, req, maxAge) {
  // Safari drops Secure cookies on plain-http localhost, so only mark them
  // Secure when the request really arrived over HTTPS.
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host || "");
  const secure = req.socket.encrypted || req.headers["x-forwarded-proto"] === "https" || (process.env.NODE_ENV === "production" && !local);
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function createApp(db) {
  // Five wrong PINs locks a login for 10 minutes.
  const attempts = new Map();

  function currentUser(req) {
    const token = cookies(req)[COOKIE];
    if (!token) return null;
    return db.prepare(
      `SELECT u.id, u.role, u.name FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > datetime('now')`,
    ).get(sha(token)) || null;
  }

  function page(res, file) {
    send(res, 200, fs.readFileSync(path.join(PUBLIC, file)), TYPES[".html"]);
  }

  function asset(res, name) {
    const file = path.join(PUBLIC, "assets", path.basename(name));
    const type = TYPES[path.extname(file)];
    if (!type || !fs.existsSync(file)) return send(res, 404, { error: "Not found" });
    send(res, 200, fs.readFileSync(file), type, { "Cache-Control": "no-cache" });
  }

  // Accepts JSON from login.js, or a plain form post when JavaScript is off.
  async function login(req, res) {
    const isForm = String(req.headers["content-type"] || "").startsWith("application/x-www-form-urlencoded");
    const input = isForm ? Object.fromEntries(new URLSearchParams((await readRaw(req, 2000)).toString())) : await readJson(req);
    const fail = (status, error) =>
      isForm ? redirect(res, `/login?e=${error}`) : send(res, status, { error });
    const key = String(input.login || "").trim().toLowerCase();
    const pin = String(input.pin || "").trim();
    const a = attempts.get(key) || { n: 0, until: 0 };
    if (a.until > Date.now()) {
      console.log(`[login] ${key || "(blank)"}: locked out`);
      return fail(429, "locked");
    }
    const user = db.prepare("SELECT id, role, pin_hash FROM users WHERE login = ?").get(key);
    if (!user || !verifyPin(pin, user.pin_hash)) {
      a.n += 1;
      if (a.n >= 5) Object.assign(a, { n: 0, until: Date.now() + 10 * 60_000 });
      attempts.set(key, a);
      console.log(`[login] ${key || "(blank)"}: ${user ? "wrong PIN" : "no such login"}`);
      return fail(401, "wrong");
    }
    attempts.delete(key);
    console.log(`[login] ${key}: signed in`);
    const token = crypto.randomBytes(32).toString("base64url");
    db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
    db.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`)
      .run(sha(token), user.id);
    const cookie = { "Set-Cookie": sessionCookie(token, req, SESSION_DAYS * 86400) };
    if (isForm) return redirect(res, HOME[user.role], cookie);
    send(res, 200, { home: HOME[user.role] }, undefined, cookie);
  }

  function logout(req, res) {
    const token = cookies(req)[COOKIE];
    if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha(token));
    send(res, 200, { ok: true }, undefined, { "Set-Cookie": sessionCookie("", req, 0) });
  }

  return async function handle(req, res) {
    try {
      const url = new URL(req.url, "http://x");
      const p = url.pathname;
      const user = currentUser(req);

      if (req.method === "GET" && p.startsWith("/assets/")) return asset(res, p.slice(8));
      if (req.method === "GET" && SHARED[p.slice(5)] && p.startsWith("/lib/")) {
        return send(res, 200, fs.readFileSync(SHARED[p.slice(5)]), TYPES[".js"], { "Cache-Control": "no-cache" });
      }
      if (req.method === "GET" && p === "/") return redirect(res, user ? HOME[user.role] : "/login");
      if (req.method === "GET" && p === "/login") return user ? redirect(res, HOME[user.role]) : page(res, "login.html");
      if (req.method === "POST" && (p === "/api/login" || p === "/login")) return await login(req, res);
      if (req.method === "POST" && p === "/api/logout") return logout(req, res);

      if (req.method === "GET" && (p === "/room" || p === "/test")) {
        if (user?.role !== "student") return redirect(res, "/login");
        return page(res, p === "/room" ? "room.html" : "test.html");
      }
      if (req.method === "GET" && (p === "/coach" || p === "/dashboard")) {
        if (!user || HOME[user.role] !== p) return redirect(res, "/login");
        return page(res, p === "/coach" ? "coach.html" : "soon.html");
      }

      if (p.startsWith("/api/")) {
        if (!user) return send(res, 401, { error: "Sign in first" });
        if (req.method === "GET" && p === "/api/me") return send(res, 200, { name: user.name, role: user.role });
        if (p.startsWith("/api/student/")) {
          if (user.role !== "student") return send(res, 403, { error: "Students only" });
          if (req.method === "GET" && p === "/api/student/test") return send(res, 200, testState(db, user.id));
          if (req.method === "POST" && p === "/api/student/test/start") {
            const { consent } = await readJson(req);
            if (consent !== true) return send(res, 400, { error: "Recording consent is needed to take the test" });
            return send(res, 200, startTest(db, user.id));
          }
          const part = p.match(/^\/api\/student\/test\/part\/([1-3])$/);
          if (req.method === "POST" && part) {
            // A custom header cannot be sent by a cross-site form, so this blocks CSRF uploads.
            if (req.headers["x-offer-room"] !== "1") return send(res, 403, { error: "Forbidden" });
            const body = await readRaw(req, MAX_CLIP_BYTES);
            return send(res, 200, saveClip(db, user.id, {
              part: Number(part[1]),
              mime: req.headers["content-type"],
              body,
              durationMs: Number(req.headers["x-duration-ms"]),
            }));
          }
        }
        if (p.startsWith("/api/coach/")) {
          if (user.role !== "coach") return send(res, 403, { error: "Coach only" });
          if (req.method === "GET" && p === "/api/coach/queue") return send(res, 200, queue(db));
          if (req.method === "PUT" && p === "/api/coach/open-test") {
            const { test } = await readJson(req);
            return send(res, 200, setOpenTest(db, test ?? null));
          }
          const one = p.match(/^\/api\/coach\/attempt\/(\d+)$/);
          if (req.method === "GET" && one) return send(res, 200, attemptDetail(db, Number(one[1])));
          const score = p.match(/^\/api\/coach\/attempt\/(\d+)\/score$/);
          if (req.method === "POST" && score) {
            return send(res, 200, saveScore(db, Number(score[1]), user.id, await readJson(req)));
          }
          const clip = p.match(/^\/api\/coach\/clip\/(\d+)$/);
          if (req.method === "GET" && clip) return streamClip(db, Number(clip[1]), req, res, SECURITY_HEADERS);
        }
      }
      send(res, 404, { error: "Not found" });
    } catch (err) {
      if (!err.status) console.error(err);
      send(res, err.status || 500, { error: err.status ? err.message : "Something broke on our side" });
    }
  };
}
