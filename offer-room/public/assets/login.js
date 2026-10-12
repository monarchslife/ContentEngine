const form = document.getElementById("login");
const err = document.getElementById("err");

const MESSAGES = {
  wrong: "Hmm, that login and PIN don't match. Typos happen to the best of us. Try again?",
  locked: "Too many tries. Take a 10-minute chai break and come back.",
};

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  err.textContent = "";
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login: form.who.value.trim(), pin: form.pin.value.trim() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(MESSAGES[data.error] || "Something went sideways. Try again in a sec.");
    location.href = data.home;
  } catch (e2) {
    err.textContent = e2.message;
    button.disabled = false;
  }
});
