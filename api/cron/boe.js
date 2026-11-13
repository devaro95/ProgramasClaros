// Cron diario (07:30 UTC): añade a data/ccaa-leyes.json las leyes, leyes forales, decretos ley y textos refundidos
// autonómicos publicados en la sección I del BOE. Lee los sumarios oficiales (API de datos abiertos del BOE) de los
// últimos días y hace commit si hay novedades (Vercel redespliega).
// ?from=YYYYMMDD&to=YYYYMMDD fuerza un rango (p. ej. para rellenar huecos).
import { getJSON, putFile } from "../../lib/github.js";
import { authorized, madridDate } from "../../lib/util.js";

const FILE = "data/ccaa-leyes.json";
const DAYS_BACK = +(process.env.BOE_DAYS_BACK || 10);
const DEP = { "ANDALUCÍA": "and", "ARAGÓN": "ara", "PRINCIPADO DE ASTURIAS": "ast", "ILLES BALEARS": "bal", "CANARIAS": "can",
  "CANTABRIA": "cnt", "CASTILLA-LA MANCHA": "clm", "CASTILLA Y LEÓN": "cyl", "CATALUÑA": "cat", "COMUNITAT VALENCIANA": "val",
  "EXTREMADURA": "ext", "GALICIA": "gal", "COMUNIDAD DE MADRID": "mad", "REGIÓN DE MURCIA": "mur", "NAVARRA": "nav",
  "PAÍS VASCO": "eus", "LA RIOJA": "rio", "CEUTA": "ceu", "MELILLA": "mel" };
const MES = Object.fromEntries("enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre".split(" ").map((m, i) => [m, i + 1]));
const RX = /^((?:Ley(?: Foral)?(?: del Principado de Asturias| de Cantabria)?|Decreto[- ][Ll]ey(?: Foral)?|Decreto Legislativo(?: Foral)?)\s+(\d+)\/(\d{4}))(?:,? del Gobierno de Aragón)?,\s*(?:de\s+)?(\d+)\s+de\s+(\w+)\s*,?\s*([\s\S]*)$/;
const arr = x => (x == null ? [] : Array.isArray(x) ? x : [x]);
const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, "");

export function parse(dep, bid, title) {
  const cid = Object.entries(DEP).find(([k]) => dep.includes(k))?.[1];
  const m = cid && RX.exec(title);
  if (!m) return null;
  const [, num, , yr, dd, mm, restRaw] = m;
  if (+yr < 2023) return null;
  const rest = restRaw.trim().replace(/\.$/, "");
  const k = /ecreto/.test(num) ? (/egislativo/.test(num) ? "tr" : "dl") : "ley";
  const g = /[Pp]resupuesto/.test(rest) && !/modific/.test(rest.slice(0, 40)) ? "pres" : /[Mm]edidas (fiscales|tributarias)|tribut/.test(rest) ? "fis" : "";
  return { cid, it: { d: `${yr}-${String(MES[mm.toLowerCase()] || 1).padStart(2, "0")}-${String(+dd).padStart(2, "0")}`,
    n: num, t: rest ? rest[0].toUpperCase() + rest.slice(1) : num, k, g, b: bid } };
}

async function sumario(day) {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(`https://www.boe.es/datosabiertos/api/boe/sumario/${day}`, { headers: { Accept: "application/json" } });
      if (r.status === 404) return [];
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      const out = [];
      arr(j.data?.sumario?.diario).forEach(D => arr(D.seccion).filter(s => s.codigo === "1").forEach(s =>
        arr(s.departamento).filter(dp => /^(COMUNIDAD|CIUDAD|COMUNITAT|ILLES)/.test(dp.nombre)).forEach(dp =>
          [...arr(dp.item), ...arr(dp.epigrafe).flatMap(e => arr(e.item))].forEach(it => out.push([dp.nombre, it.identificador, it.titulo])))));
      return out;
    } catch (e) { if (a === 2) throw e; }
  }
}

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: "unauthorized" });
  try {
    const file = await getJSON(FILE);
    const data = file?.data || { items: {} };
    const to = req.query?.to ? new Date(`${req.query.to.slice(0, 4)}-${req.query.to.slice(4, 6)}-${req.query.to.slice(6, 8)}T12:00:00Z`) : new Date();
    const from = req.query?.from ? new Date(`${req.query.from.slice(0, 4)}-${req.query.from.slice(4, 6)}-${req.query.from.slice(6, 8)}T12:00:00Z`)
      : new Date(to.getTime() - DAYS_BACK * 864e5);
    const days = [];
    for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() !== 0) days.push(ymd(d));

    const seen = new Set(Object.values(data.items).flat().map(x => x.b));
    const added = [];
    let i = 0;
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (i < days.length) {
        const rows = await sumario(days[i++]);
        for (const [dep, bid, title] of rows) {
          if (seen.has(bid)) continue;
          const p = parse(dep, bid, title);
          if (!p) continue;
          seen.add(bid);
          (data.items[p.cid] ||= []).push(p.it);
          added.push(`${p.cid}: ${p.it.n}`);
        }
      }
    }));
    if (!added.length) return res.json({ ok: true, days: days.length, added: 0 });
    for (const k of Object.keys(data.items)) data.items[k].sort((a, b) => b.d.localeCompare(a.d));
    data.updated = madridDate();
    data.source ||= "BOE, sección I (sumarios diarios). Leyes y decretos leyes autonómicos publicados desde enero de 2023.";
    await putFile(FILE, JSON.stringify(data), `Leyes autonómicas del BOE: +${added.length}`, { sha: file?.sha });
    return res.json({ ok: true, days: days.length, added });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
