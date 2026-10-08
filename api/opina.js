// «Tu opinión»: preguntas anónimas a los lectores (preguntas en lib/opina.js). Mismo criterio de privacidad que api/vote.js.
import { createHash } from "node:crypto";
import { POLLS, findPoll } from "../lib/opina.js";

// Igual que la votación: sin resultados del 24 al 29 de noviembre (art. 69.7 LOREG).
const HIDE_FROM = Date.parse("2026-11-24T00:00:00+01:00");
const CLOSE_AT = Date.parse("2026-11-29T21:00:00+01:00");
const KEEP_UNTIL = Math.floor(Date.parse("2026-12-31T00:00:00+01:00") / 1000);
const IP_LIMIT = 120; // respuestas o cambios por IP y día, sumando todas las preguntas

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
  const dh = device && h(device);
  const cmds = POLLS.flatMap(p => [["HGETALL", `op:${p.id}`], dh ? ["GET", `opv:${p.id}:${dh}`] : ["PING"]]);
  const out = await redis(cmds);
  const now = Date.now(), hidden = now >= HIDE_FROM && now < CLOSE_AT;
  const polls = POLLS.map((p, i) => {
    const raw = out[i * 2] || [], mine = out[i * 2 + 1], counts = {};
    for (let j = 0; j < raw.length; j += 2) counts[raw[j]] = +raw[j + 1];
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return { id: p.id, q: p.q, opts: p.opts, total, counts: hidden ? null : counts, mine: dh && mine !== "PONG" ? mine : null };
  });
  return { hidden, closed: now >= CLOSE_AT, polls };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") return res.status(200).json(await results(validDevice(req.query.d) ? req.query.d : null));
    if (req.method !== "POST") return res.status(405).end();

    const { poll, option, device } = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const p = findPoll(poll), valid = p && p.opts.some(o => o[0] === option);
    if (!valid || !validDevice(device)) return res.status(400).json({ error: "Respuesta no válida" });
    if (Date.now() >= CLOSE_AT) return res.status(403).json({ error: "Las preguntas están cerradas" });

    const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "0";
    const day = new Date().toISOString().slice(0, 10);
    const ipKey = `opip:${h(ip + day)}`, voterKey = `opv:${p.id}:${h(device)}`;
    const [n, prev] = await redis([["INCR", ipKey], ["GET", voterKey]]);
    if (n === 1) await redis([["EXPIRE", ipKey, 86400]]);
    if (n > IP_LIMIT) return res.status(429).json({ error: "Demasiadas respuestas desde esta conexión hoy" });

    if (prev !== option) {
      const cmds = [["HINCRBY", `op:${p.id}`, option, 1], ["SET", voterKey, option, "EXAT", KEEP_UNTIL]];
      if (prev && p.opts.some(o => o[0] === prev)) cmds.unshift(["HINCRBY", `op:${p.id}`, prev, -1]);
      await redis(cmds);
    }
    return res.status(200).json(await results(device));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.config ? e.message : "No se ha podido guardar tu respuesta" });
  }
}
