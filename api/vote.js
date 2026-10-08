// Votación anónima de los lectores. No guarda IP ni datos personales:
// - el navegador genera un identificador aleatorio; aquí solo se guarda su hash con sal (para poder cambiar el voto);
// - la IP solo se usa, también con hash y caducidad de 24 h, para limitar abusos.
// Requiere Upstash Redis (Vercel → Storage/Marketplace), que define KV_REST_API_URL y KV_REST_API_TOKEN.
import { createHash } from "node:crypto";

const OPTIONS = ["pp","psoe","sumar","vox","podemos","salf","bng","bildu","erc","junts","pnv","upn","cc","otro","blanco","nose"];
// Sin resultados en los 5 días anteriores a la votación (art. 69.7 LOREG) hasta el cierre de colegios en Canarias.
const HIDE_FROM = Date.parse("2026-11-24T00:00:00+01:00");
const CLOSE_AT = Date.parse("2026-11-29T21:00:00+01:00");
const KEEP_UNTIL = Math.floor(Date.parse("2026-12-31T00:00:00+01:00") / 1000);
const IP_LIMIT = 30; // votos o cambios por IP y día (redes compartidas: universidades, móviles…)

// Conexión: vale tanto la integración de Upstash (REST, KV_REST_API_URL/TOKEN con cualquier prefijo)
// como la de Redis de Vercel Storage (REDIS_URL, conexión TCP).
const env = re => Object.entries(process.env).find(([k, v]) => v && re.test(k) && !/READ_ONLY/.test(k))?.[1];
const REST_URL = env(/REST_(API_)?URL$/), REST_TOKEN = env(/REST_(API_)?TOKEN$/);
const TCP_URL = env(/(^|_)(REDIS|KV)_URL$/);
let tcp;
async function redis(cmds) {
  if (REST_URL && REST_TOKEN) {
    const r = await fetch(`${REST_URL}/pipeline`, { method: "POST", headers: { Authorization: `Bearer ${REST_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(cmds) });
    if (!r.ok) throw new Error(`Redis ${r.status}`);
    return (await r.json()).map(x => x.result);
  }
  if (TCP_URL) {
    if (!tcp) { const { createClient } = await import("redis"); tcp = createClient({ url: TCP_URL }); tcp.on("error", () => {}); await tcp.connect(); }
    const out = [];
    for (const c of cmds) out.push(await tcp.sendCommand(c.map(String)));
    return out;
  }
  throw Object.assign(new Error("Falta conectar la base de datos de votos en Vercel (Storage)"), { config: true });
}
const h = s => createHash("sha256").update((process.env.VOTE_SALT || "pc") + s).digest("hex").slice(0, 32);
const validDevice = d => typeof d === "string" && /^[a-zA-Z0-9-]{16,64}$/.test(d);

async function results(device) {
  const [raw, mine] = await redis([["HGETALL", "votes"], device ? ["GET", `voter:${h(device)}`] : ["PING"]]);
  const counts = {};
  for (let i = 0; i < (raw || []).length; i += 2) counts[raw[i]] = +raw[i + 1];
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const now = Date.now(), hidden = now >= HIDE_FROM && now < CLOSE_AT;
  return { hidden, closed: now >= CLOSE_AT, total, counts: hidden ? null : counts, mine: device && mine !== "PONG" ? mine : null };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") return res.status(200).json(await results(validDevice(req.query.d) ? req.query.d : null));
    if (req.method !== "POST") return res.status(405).end();

    const { party, device } = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    if (!OPTIONS.includes(party) || !validDevice(device)) return res.status(400).json({ error: "Voto no válido" });
    if (Date.now() >= CLOSE_AT) return res.status(403).json({ error: "La votación está cerrada" });

    const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "0";
    const day = new Date().toISOString().slice(0, 10);
    const ipKey = `ip:${h(ip + day)}`, voterKey = `voter:${h(device)}`;
    const [n, prev] = await redis([["INCR", ipKey], ["GET", voterKey]]);
    if (n === 1) await redis([["EXPIRE", ipKey, 86400]]);
    if (n > IP_LIMIT) return res.status(429).json({ error: "Demasiados votos desde esta conexión hoy" });

    if (prev !== party) {
      const cmds = [["HINCRBY", "votes", party, 1], ["SET", voterKey, party, "EXAT", KEEP_UNTIL]];
      if (prev && OPTIONS.includes(prev)) cmds.unshift(["HINCRBY", "votes", prev, -1]);
      await redis(cmds);
    }
    return res.status(200).json(await results(device));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.config ? e.message : "No se ha podido registrar el voto" });
  }
}
