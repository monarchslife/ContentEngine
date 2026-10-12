// Give someone a fresh PIN: npm run offer-room:pin -- badal
import { openDb, hashPin, newPin } from "./src/db.js";

const login = (process.argv[2] || "").trim().toLowerCase();
const db = openDb();
const users = db.prepare("SELECT login, role FROM users ORDER BY role, login").all();

if (!login) {
  console.log("Usage: npm run offer-room:pin -- <login>\n");
  for (const u of users) console.log(`  ${u.login.padEnd(16)} ${u.role}`);
  process.exit(1);
}
if (!users.some((u) => u.login.toLowerCase() === login)) {
  console.error(`No login called "${login}". Logins here: ${users.map((u) => u.login).join(", ") || "none (start the app once first)"}`);
  process.exit(1);
}
const pin = newPin();
db.prepare("UPDATE users SET pin_hash = ? WHERE login = ?").run(hashPin(pin), login);
db.prepare("DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE login = ?)").run(login);
console.log(`New PIN for ${login}: ${pin}\nIf they were locked out, restart the app (Ctrl+C, then npm run offer-room) to clear it.`);
