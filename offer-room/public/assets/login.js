const form = document.getElementById("login");
const err = document.getElementById("err");
const who = document.getElementById("who");
const pin = document.getElementById("pin");

const MESSAGES = {
  wrong: "Hmm, that login and PIN don't match. Typos happen to the best of us. Try again?",
  locked: "Too many tries. Take a 10-minute chai break and come back.",
};

// A failed plain-form login comes back as /login?e=wrong
const fromServer = new URLSearchParams(location.search).get("e");
if (MESSAGES[fromServer]) err.textContent = MESSAGES[fromServer];

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  err.textContent = "";
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login: who.value.trim(), pin: pin.value.trim() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(MESSAGES[data.error] || "Something went sideways. Try again in a sec.");
    // Make sure the browser kept the sign-in cookie before moving on.
    const check = await fetch("/api/me");
    if (!check.ok) throw new Error("The PIN was right, but this browser didn't keep the sign-in. Allow cookies for this site (or try Chrome) and log in again.");
    location.href = data.home;
  } catch (e2) {
    err.textContent = e2.message;
    button.disabled = false;
  }
});
