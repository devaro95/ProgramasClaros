// Cron diario (03:00 UTC) de comunidades autónomas: revisa las 3 comunidades que hace más tiempo que no se
// comprueban (las 19 se repasan en una semana). Para cada una busca cambios en el gobierno y leyes o presupuestos
// aprobados, en trámite o rechazados desde la última revisión, y hace commit de data/ccaa.json (Vercel redespliega).
// ?id=and,ara fuerza comunidades concretas.
import { getJSON, putFile } from "../../lib/github.js";
import { askJSON, webSearch } from "../../lib/claude.js";
import { authorized, madridDate, isURL, hash } from "../../lib/util.js";

const FILE = "data/ccaa.json";
const PER_RUN = +(process.env.CCAA_PER_RUN || 3);
const DATE = /^\d{4}(-\d{2})?$/;

const SYSTEM = `Eres el editor de la sección de comunidades autónomas de "Programas Claros", una web neutral para votantes españoles.
Reglas:
- Neutralidad estricta: describe hechos sin adjetivos valorativos. Atribuye las opiniones ("según X").
- Solo hechos verificables en medios reconocidos, boletines oficiales o webs de los parlamentos, con la URL exacta (nunca portadas ni URLs inventadas).
- Español muy claro, frases cortas, sin jerga; si usas un término técnico, explícalo en la misma frase.
- Qué entra: presupuestos (aprobados, rechazados, prorrogados), leyes con efecto en la vida diaria, derogaciones, cambios de gobierno o de apoyos. No incluyas mociones o PNL salvo que sean muy relevantes.
- Responde SOLO con JSON válido.`;

const clean = (it, srcOut) => {
  if (!it || !DATE.test(it.d || "") || !it.t || !Array.isArray(it.src)) return null;
  const keys = [];
  for (const s of it.src) {
    if (typeof s === "string") { keys.push(s); continue; }
    if (s && isURL(s.u) && s.t) { const k = "x" + hash(s.u); srcOut[k] = { t: String(s.t).trim(), u: s.u.trim() }; keys.push(k); }
  }
  return keys.length ? { d: it.d, t: String(it.t).trim(), src: keys } : null;
};

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: "unauthorized" });
  try {
    const today = madridDate();
    const file = await getJSON(FILE);
    if (!file) return res.status(500).json({ error: "Falta data/ccaa.json" });
    const data = file.data;
    const forced = String(req.query?.id || "").split(",").filter(Boolean);
    const todo = (forced.length ? data.items.filter(c => forced.includes(c.id))
      : [...data.items].sort((a, b) => (a.checked || "").localeCompare(b.checked || "")).slice(0, PER_RUN));

    const done = [];
    for (const c of todo) {
      const srcOf = keys => keys.map(k => data.src[k]?.u).filter(Boolean);
      const current = {
        gobierno: { presidente: c.pres, desde: c.since, partidos: c.gov.map(g => g[1]), forma: c.form, elecciones: c.elec, proximas: c.next },
        aprobado: c.si.map(x => ({ d: x.d, t: x.t, fuentes: srcOf(x.src) })),
        en_tramite: (c.tr || []).map(x => ({ d: x.d, t: x.t, fuentes: srcOf(x.src) })),
        no_salio: c.no.map(x => ({ d: x.d, t: x.t, fuentes: srcOf(x.src) })),
      };
      const out = await askJSON({
        system: SYSTEM,
        tools: [webSearch(8)],
        maxTokens: 5000,
        prompt: `Hoy es ${today}. Comunidad: ${c.name}. Última revisión: ${c.checked || "nunca"}.
Esto es lo que ya publicamos:
${JSON.stringify(current, null, 1)}

Busca en la web qué ha cambiado desde la última revisión (si es "nunca", desde junio de 2023):
1) ¿Ha cambiado el presidente, los partidos del gobierno o sus apoyos? 
2) Presupuestos o leyes importantes aprobados por el parlamento autonómico que no estén ya en la lista.
3) Leyes o presupuestos importantes que ahora estén en trámite.
4) Lo que no ha salido adelante: presupuestos rechazados o prorrogados, leyes rechazadas o retiradas, decretos no convalidados.
5) Si algo "en trámite" ya se ha aprobado o rechazado, indícalo en "resolver".
No repitas lo que ya está. Si no hay nada nuevo, devuelve listas vacías.

Formato (fechas "YYYY-MM" o "YYYY"):
{"gobierno":null o {"pres":"…","since":"YYYY","form":"1 frase","gov":[["id","Nombre"]],"next":"…"},
 "si":[{"d":"YYYY-MM","t":"1–2 frases","src":[{"t":"Medio — Titular (fecha)","u":"https://…"}]}],
 "tr":[…], "no":[…],
 "resolver":[{"t_actual":"texto exacto del elemento en trámite","a":"si"|"no","d":"YYYY-MM","t":"…","src":[…]}]}
Ids de partido para "gov": pp, psoe (también PSC, PSN, PSE-EE), vox, cc, pnv, upn, iu, gbai, contigo, u otro id corto.`,
      });

      const add = {};
      const pick = arr => (Array.isArray(arr) ? arr : []).map(x => clean(x, add)).filter(Boolean);
      const si = pick(out.si), tr = pick(out.tr), no = pick(out.no);
      for (const r of Array.isArray(out.resolver) ? out.resolver : []) {
        const i = (c.tr || []).findIndex(x => x.t === r.t_actual);
        const it = clean(r, add);
        if (i < 0 || !it || !["si", "no"].includes(r.a)) continue;
        c.tr.splice(i, 1);
        (r.a === "si" ? si : no).push(it);
      }
      Object.assign(data.src, add);
      const known = new Set([...c.si, ...(c.tr || []), ...c.no].map(x => x.t));
      c.si.push(...si.filter(x => !known.has(x.t)));
      c.tr = [...(c.tr || []), ...tr.filter(x => !known.has(x.t))];
      c.no.push(...no.filter(x => !known.has(x.t)));
      const g = out.gobierno;
      if (g && g.pres && Array.isArray(g.gov) && g.gov.length && g.form) {
        Object.assign(c, { pres: String(g.pres), since: String(g.since || c.since), form: String(g.form), next: String(g.next || c.next),
          gov: g.gov.filter(x => Array.isArray(x) && x.length === 2).map(([k, n]) => [String(k), String(n)]) });
      }
      c.checked = today;
      done.push({ id: c.id, si: si.length, tr: tr.length, no: no.length, gob: !!g });
    }

    data.updated = today;
    await putFile(FILE, JSON.stringify(data, null, 1) + "\n", `Comunidades: revisión ${today} (${done.map(d => d.id).join(", ")})`, { sha: file.sha });
    return res.status(200).json({ ok: true, done });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
