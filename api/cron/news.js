// Cron diario de noticias a las 22:00 hora peninsular: ya han pasado los telediarios de las 21:00, los mítines de la
// tarde y las reacciones del día, así que lo importante ya ha salido. Vercel solo admite UTC, así que hay dos crons
// (20:00 y 21:00 UTC) y solo actúa el que cae a las 22 en Madrid (cubre horario de verano e invierno). ?force=1 lo salta. Busca, resume y hace commit de data/news.json (Vercel redespliega solo).
import { getJSON, putFile } from "../../lib/github.js";
import { askJSON, webSearch } from "../../lib/claude.js";
import { authorized, madridDate, isDate, isURL, hash, EXTRA_NEWS_PARTIES } from "../../lib/util.js";

const FILE = "data/news.json";
const KEEP_DAYS = 21, MAX_ITEMS = 60;

const SYSTEM = `Eres el editor de noticias de "Programas Claros", una web neutral que compara a los partidos ante las elecciones generales españolas del 29 de noviembre de 2026 (29N).
Reglas:
- Neutralidad estricta: sin adjetivos valorativos, sin opinión, sin titulares sensacionalistas. Describe hechos y atribuye declaraciones ("según X", "X afirma").
- Equilibrio: cubre a todos los partidos con relevancia ese día; no favorezcas a ninguno.
- Solo noticias reales de medios reconocidos, con la URL exacta del artículo (nunca portadas ni URLs inventadas). Prefiere agencias y medios de distinta línea editorial.
- Español claro, frases cortas. "summary": 1–2 frases que expliquen el hecho y por qué importa.
- Responde SOLO con JSON válido.`;

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: "unauthorized" });
  try {
    const today = madridDate();
    const hour = +new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hourCycle: "h23" }).format(new Date());
    if (req.query?.w && !req.query?.force && hour !== 22) return res.status(200).json({ ok: true, skipped: `Son las ${hour}h en Madrid` });
    const [file, schema] = await Promise.all([getJSON(FILE), getJSON("data/schema.json")]);
    const cur = file?.data || { meta: {}, items: [] };
    const parties = [...schema.data.parties, ...EXTRA_NEWS_PARTIES];
    const ids = new Set(parties.map(p => p.id));
    const known = cur.items.slice(0, 40).map(n => n.url);

    const out = await askJSON({
      system: SYSTEM,
      tools: [webSearch(12)],
      maxTokens: 6000,
      prompt: `Hoy es ${today} (hora de Madrid). Busca las noticias MÁS IMPORTANTES de las últimas 24 horas sobre la precampaña/campaña de las elecciones generales del 29N.
Prioriza: candidaturas y listas, programas y propuestas presentadas, pactos y coaliciones, debates, encuestas relevantes, decisiones de la Junta Electoral y hechos que cambien la campaña.
Entre 6 y 12 noticias, como máximo 2 por partido, y al menos una por cada partido que haya sido noticia hoy.

Partidos (usa estos ids en "parties"): ${parties.map(p => `${p.id}=${p.name}`).join(", ")}.
No repitas estas URLs ya publicadas: ${known.join(" ")}

Formato:
{"highlight":{"title":"titular del hecho más importante del día","text":"1–2 frases"},
 "items":[{"date":"YYYY-MM-DD","parties":["id"],"source":"Medio","title":"Titular neutral","summary":"…","url":"https://…"}]}`,
    });

    const fresh = (out.items || [])
      .filter(n => isURL(n.url) && n.title && n.summary && n.source)
      .map(n => ({
        date: isDate(n.date) ? n.date : today,
        parties: (n.parties || []).filter(p => ids.has(p)),
        source: String(n.source).trim(),
        summary: String(n.summary).trim(),
        title: String(n.title).trim(),
        url: n.url.trim(),
        id: "n" + hash(n.url),
      }))
      .filter(n => n.parties.length);
    if (!fresh.length) return res.status(200).json({ ok: true, added: 0, note: "Sin noticias nuevas válidas" });

    const cutoff = madridDate(new Date(Date.now() - KEEP_DAYS * 864e5));
    const seen = new Set();
    const items = [...fresh, ...cur.items]
      .filter(n => (seen.has(n.url) ? false : seen.add(n.url)))
      .filter(n => (n.date || "") >= cutoff)
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .slice(0, MAX_ITEMS);

    const h = out.highlight;
    const meta = { ...cur.meta, updated: today, ...(h?.title && h?.text ? { highlight: { title: h.title, text: h.text } } : {}) };
    await putFile(FILE, JSON.stringify({ meta, items }, null, 1) + "\n", `Noticias: actualización diaria ${today}`, { sha: file?.sha });
    return res.status(200).json({ ok: true, added: fresh.filter(n => items.includes(n)).length, total: items.length });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
