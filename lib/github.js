// Lectura/escritura del repo vía API de GitHub. Cada commit dispara un redeploy en Vercel.
const API = "https://api.github.com";
const repo = () => process.env.GITHUB_REPO || "devaro95/ProgramasClaros";
const base = () => process.env.GITHUB_BRANCH || "main";

async function gh(path, opts = {}) {
  const r = await fetch(`${API}/repos/${repo()}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ${opts.method || "GET"} ${path}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? {} : r.json();
}

export async function getFile(path, ref = base()) {
  const f = await gh(`/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`);
  if (!f) return null;
  return { sha: f.sha, text: Buffer.from(f.content, "base64").toString("utf8") };
}

export async function getJSON(path, ref) {
  const f = await getFile(path, ref);
  return f ? { sha: f.sha, data: JSON.parse(f.text) } : null;
}

export async function putFile(path, text, message, { sha, branch = base() } = {}) {
  return gh(`/contents/${encodeURI(path)}`, {
    method: "PUT",
    body: JSON.stringify({ message, content: Buffer.from(text, "utf8").toString("base64"), branch, ...(sha ? { sha } : {}) }),
  });
}

export async function createBranch(name) {
  const ref = await gh(`/git/ref/heads/${base()}`);
  return gh(`/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${name}`, sha: ref.object.sha }) });
}

export async function openPRs() {
  return (await gh(`/pulls?state=open&per_page=100`)) || [];
}

export async function createPR(head, title, body) {
  return gh(`/pulls`, { method: "POST", body: JSON.stringify({ head, base: base(), title, body }) });
}
