// Small helpers shared by every page.

export async function api(url, { method = "GET", json, body, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    headers: json !== undefined ? { "Content-Type": "application/json", ...headers } : headers,
    body: json !== undefined ? JSON.stringify(json) : body,
  });
  if (res.status === 401) {
    location.href = "/login";
    throw new Error("Signed out");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

export async function logout() {
  await fetch("/api/logout", { method: "POST" });
  location.href = "/login";
}

export function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...kids.filter((k) => k != null));
  return node;
}
