import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PATH = path.join(ROOT, "data", "offer-room.db");
export const CLIP_DIR = process.env.OFFER_ROOM_CLIPS || path.join(ROOT, "data", "clips");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('student','coach','management')),
  login TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  roll TEXT,
  dept TEXT,
  pin_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
-- One row per scored answer. scorer: peer (trio), coach, blind (shuffled clip).
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  test TEXT NOT NULL CHECK (test IN ('day1','final')),
  scorer TEXT NOT NULL CHECK (scorer IN ('peer','coach','blind')),
  structure INTEGER NOT NULL, proof INTEGER NOT NULL, clarity INTEGER NOT NULL,
  presence INTEGER NOT NULL, fit INTEGER NOT NULL,
  weakest TEXT NOT NULL,
  strength TEXT, fix TEXT, note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS blind_queue (
  code TEXT PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  test TEXT NOT NULL,
  sort_key REAL NOT NULL,
  score_id INTEGER REFERENCES scores(id) ON DELETE SET NULL,
  UNIQUE (student_id, test)
);
-- A student's own workbook, one JSON document per tool.
CREATE TABLE IF NOT EXISTS work (
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (student_id, tool)
);
-- Append-only: the latest row per (student, kind) is the current state.
CREATE TABLE IF NOT EXISTS consent_log (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('test_recording','blind_sample','clip_use')),
  granted INTEGER NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS drives (
  id INTEGER PRIMARY KEY,
  company TEXT NOT NULL,
  drive_date TEXT
);
CREATE TABLE IF NOT EXISTS drive_status (
  drive_id INTEGER NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('registered','shortlisted','offer','not_selected')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (drive_id, student_id)
);
-- One Three-Minute Test sitting. Questions are drawn when it starts.
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  test TEXT NOT NULL CHECK (test IN ('day1','final')),
  status TEXT NOT NULL CHECK (status IN ('in_progress','submitted','scored')),
  questions TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at TEXT,
  UNIQUE (student_id, test)
);
-- One recorded answer per part. Files live outside the repo and are deleted
-- after the Readiness Report unless the student consents to clip use.
CREATE TABLE IF NOT EXISTS clips (
  id INTEGER PRIMARY KEY,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  part INTEGER NOT NULL CHECK (part BETWEEN 1 AND 3),
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  duration_ms INTEGER,
  file TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (attempt_id, part)
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

export const DEFAULT_SETTINGS = {
  institution: "Test Institution (demo)",
  program: "The Offer Room · Sprint",
  batch: "Final year, 2026-27",
  day1_date: "",
  final_date: "",
  ready_line: "15",
  open_test: "day1",
};

export function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pin), salt, 32);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

export function verifyPin(pin, stored) {
  const [salt, key] = stored.split(":").map((h) => Buffer.from(h, "hex"));
  const test = crypto.scryptSync(String(pin), salt, key.length);
  return crypto.timingSafeEqual(test, key);
}

export const newPin = () => String(crypto.randomInt(100000, 1000000));

export function openDb(file = process.env.OFFER_ROOM_DB || DEFAULT_PATH) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  const put = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) put.run(k, v);
  return db;
}

export function addUser(db, { role, login, name, roll = null, dept = null, pin = newPin() }) {
  const { lastInsertRowid } = db
    .prepare("INSERT INTO users (role, login, name, roll, dept, pin_hash) VALUES (?, ?, ?, ?, ?, ?)")
    .run(role, login, name, roll, dept, hashPin(pin));
  return { id: Number(lastInsertRowid), pin };
}

// First run: the test version has one coach (Yogesh), one placement-cell
// login and one student, Badal. PINs are random and written to a local,
// git-ignored file so they never land in the repo.
export function seed(db, { writeFile = true } = {}) {
  if (db.prepare("SELECT COUNT(*) AS n FROM users").get().n > 0) return null;
  const made = [
    { role: "coach", login: "yogesh", name: "Yogesh" },
    { role: "management", login: "placementcell", name: "Placement Cell" },
    { role: "student", login: "badal", name: "Badal", roll: "2026-001", dept: "B.Tech CSE" },
  ].map((u) => ({ ...u, ...addUser(db, u) }));
  if (writeFile) {
    const lines = made.map((u) => `${u.role.padEnd(11)} login: ${u.login.padEnd(14)} PIN: ${u.pin}`);
    fs.writeFileSync(
      path.join(ROOT, "data", "FIRST-RUN-LOGINS.txt"),
      `Offer Room test logins (eyes only, do not commit)\n\n${lines.join("\n")}\n`,
    );
  }
  return made;
}

export function getSettings(db) {
  return Object.fromEntries(db.prepare("SELECT key, value FROM settings").all().map((r) => [r.key, r.value]));
}

export function readyLine(db) {
  return Number(getSettings(db).ready_line) || 15;
}
