// Student onboarding: the profile draft, the resume, and the "done" gate the
// Three-Minute Test checks before it starts.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { RESUME_DIR } from "./db.js";
import { cleanProfile, missing, MAX_RESUME_BYTES } from "./profile.js";

const bad = (status, message) => Object.assign(new Error(message), { status });

function row(db, studentId) {
  db.prepare("INSERT OR IGNORE INTO profiles (student_id) VALUES (?)").run(studentId);
  return db.prepare("SELECT * FROM profiles WHERE student_id = ?").get(studentId);
}

export function profileState(db, studentId) {
  const r = row(db, studentId);
  const data = JSON.parse(r.data);
  const hasResume = Boolean(r.resume_file);
  return {
    data,
    resume: hasResume ? { name: r.resume_name, bytes: r.resume_bytes, uploadedAt: r.resume_at } : null,
    missing: missing(data, hasResume),
    completed: Boolean(r.completed_at),
    completedAt: r.completed_at,
  };
}

export const isOnboarded = (db, studentId) =>
  Boolean(db.prepare("SELECT completed_at FROM profiles WHERE student_id = ?").get(studentId)?.completed_at);

// Saves a draft. Editing after completion is allowed; it stays complete only
// while nothing required is missing.
export function saveProfile(db, studentId, input) {
  const r = row(db, studentId);
  const data = { ...JSON.parse(r.data), ...cleanProfile(input) };
  const stillComplete = r.completed_at && missing(data, Boolean(r.resume_file)).length === 0;
  db.prepare("UPDATE profiles SET data = ?, completed_at = ?, updated_at = datetime('now') WHERE student_id = ?")
    .run(JSON.stringify(data), stillComplete ? r.completed_at : null, studentId);
  return profileState(db, studentId);
}

export function saveResume(db, studentId, { body, filename }) {
  if (!body.length) throw bad(400, "That file is empty");
  if (body.length > MAX_RESUME_BYTES) throw bad(413, "Resume is over 5 MB");
  if (body.subarray(0, 5).toString("latin1") !== "%PDF-") throw bad(415, "Resume must be a PDF");
  const r = row(db, studentId);
  fs.mkdirSync(RESUME_DIR, { recursive: true });
  const file = `${studentId}-${crypto.randomBytes(6).toString("hex")}.pdf`;
  fs.writeFileSync(path.join(RESUME_DIR, file), body);
  if (r.resume_file) fs.rmSync(path.join(RESUME_DIR, path.basename(r.resume_file)), { force: true });
  const name = String(filename || "resume.pdf").replace(/[^\w .()-]/g, "_").slice(0, 120);
  db.prepare("UPDATE profiles SET resume_file = ?, resume_name = ?, resume_bytes = ?, resume_at = datetime('now'), updated_at = datetime('now') WHERE student_id = ?")
    .run(file, name, body.length, studentId);
  return profileState(db, studentId);
}

export function completeProfile(db, studentId) {
  const state = profileState(db, studentId);
  if (state.missing.length) throw bad(400, `Still missing: ${state.missing.join(", ")}`);
  db.prepare("UPDATE profiles SET completed_at = COALESCE(completed_at, datetime('now')) WHERE student_id = ?").run(studentId);
  return profileState(db, studentId);
}

export function resumeFile(db, studentId) {
  const r = db.prepare("SELECT resume_file, resume_name FROM profiles WHERE student_id = ?").get(studentId);
  const file = r?.resume_file && path.join(RESUME_DIR, path.basename(r.resume_file));
  if (!file || !fs.existsSync(file)) throw bad(404, "No resume");
  return { file, name: r.resume_name };
}
