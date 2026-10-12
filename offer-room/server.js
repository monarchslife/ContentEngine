import http from "node:http";
import { openDb, seed } from "./src/db.js";
import { createApp } from "./src/app.js";

const PORT = Number(process.env.PORT) || 3100;
const db = openDb();
const made = seed(db);
if (made) console.log("First run: logins written to offer-room/data/FIRST-RUN-LOGINS.txt");

http.createServer(createApp(db)).listen(PORT, () => {
  console.log(`The Offer Room running at http://localhost:${PORT}`);
});
