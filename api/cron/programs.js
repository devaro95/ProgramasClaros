// Cron diario de programas electorales del 29N (19:00 UTC: los partidos suelen presentar el programa en actos de
// mañana o mediodía y colgar el PDF el mismo día). Para cada partido sin programa 29N:
//  1) comprueba si ya ha publicado el programa oficial completo;
//  2) si existe, lo lee y lo resume con la misma estructura de la web;
//  3) guarda data/programs-29n/<id>.json (marcado election:"29N").
// PROGRAMS_MODE=pr (por defecto) abre un Pull Request para revisarlo antes de publicar; PROGRAMS_MODE=direct publica directamente.
import { getJSON, getFile, putFile, createBranch, openPRs, createPR } from "../../lib/github.js";
import { askJSON, webSearch, webFetch } from "../../lib/claude.js";
import { authorized, madridDate, isDate, isURL } from "../../lib/util.js";

const DIR = "data/programs-29n";
const MAX_PER_RUN = +(process.env.PROGRAMS_MAX_PER_RUN || 2);

const SYSTEM = `Trabajas para "Programas Claros", una web neutral que resume los programas electorales de las elecciones generales españolas del 29 de noviembre de 2026 (29N) para que cualquiera los entienda.
Reglas: fidelidad absoluta al texto del programa (nada inventado ni inferido); neutralidad (sin adjetivos valorativos); español muy claro, frases cortas, sin jerga; si el programa no dice algo, no lo rellenes. Responde SOLO con JSON válido.`;

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: "unauthorized" });
  try {
    const today = madridDate();
    const mode = process.env.PROGRAMS_MODE === "direct" ? "direct" : "pr";
    const schema = (await getJSON("data/schema.json")).data;
    const prs = mode === "pr" ? await openPRs() : [];

    // Partidos pendientes: sin fichero en main y sin PR abierto
    const pending = [];
    for (const p of schema.parties) {
      if (await getFile(`${DIR}/${p.id}.json`)) continue;
      if (prs.some(pr => pr.head.ref.startsWith(`programa-29n-${p.id}-`))) continue;
      pending.push(p);
    }
    if (!pending.length) return res.status(200).json({ ok: true, note: "Todos los partidos tienen ya su programa 29N" });

    // 1) Detección
    const det = await askJSON({
      system: SYSTEM,
      tools: [webSearch(12)],
      maxTokens: 3000,
      prompt: `Hoy es ${today}. Para cada partido, comprueba si ya ha publicado OFICIALMENTE su programa electoral completo para las generales del 29N de 2026.
No cuentan: el programa de 2023, avances, "ejes", documentos de medidas sueltas ni propuestas anunciadas en mítines. Si el partido se presenta en coalición (p. ej. Sumar dentro de un frente amplio, UPN con el PP), cuenta el programa de esa candidatura.
Da la URL directa al documento (PDF o página oficial del programa), preferiblemente en la web del partido.
Partidos: ${pending.map(p => `${p.id}=${p.full}`).join("; ")}.
Formato: {"parties":{"<id>":{"published":true|false,"url":"…","title":"título del documento","date":"YYYY-MM-DD","coalition":"nombre de la candidatura si va en coalición o null"}}}`,
    });

    const found = pending.filter(p => { const d = det.parties?.[p.id]; return d?.published && isURL(d.url); }).slice(0, MAX_PER_RUN);
    const done = [];
    for (const p of found) {
      const d = det.parties[p.id];
      const entry = await summarize(p, d, schema, today);
      const path = `${DIR}/${p.id}.json`, msg = `Programa 29N: ${p.name}`;
      const text = JSON.stringify(entry, null, 1) + "\n";
      if (mode === "direct") {
        await putFile(path, text, msg);
      } else {
        const branch = `programa-29n-${p.id}-${today}`;
        await createBranch(branch);
        await putFile(path, text, msg, { branch });
        await createPR(branch, msg, `Programa electoral del 29N de **${p.full}** detectado automáticamente.\n\nFuente: [${entry.source.t}](${entry.source.u})\n\nRevisa que el resumen sea fiel al texto antes de hacer merge. Al hacer merge, la web lo mostrará marcado como «Programa 29N».`);
      }
      done.push(p.id);
    }
    return res.status(200).json({ ok: true, mode, checked: pending.map(p => p.id), published: done });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}

async function summarize(party, d, schema, today) {
  const gloss = schema.glossary.map(g => `${g.k}=${g.t}`).join("; ");
  const topics = schema.topics.map(t =>
    `## ${t.id} — ${t.name}: ${t.intro}\n` +
    t.ejes.map(e => `- eje ${e.id}: ${e.q}\n  Opciones ya usadas por otros partidos:\n${e.options.map(o => `    · ${o}`).join("\n")}`).join("\n")
  ).join("\n\n");

  const out = await askJSON({
    system: SYSTEM,
    tools: [webFetch(4), webSearch(3)],
    maxTokens: 16000,
    prompt: `Lee el programa electoral del 29N de ${party.full}${d.coalition ? ` (candidatura: ${d.coalition})` : ""}: ${d.url}
Resúmelo para estos temas y ejes:

${topics}

Devuelve:
{"p":{"<topicId>":["propuesta 1","propuesta 2",…]},          // 0–4 propuestas por tema, las más importantes y concretas, en una frase cada una
 "pos":{"<ejeId>":"postura del partido en esa pregunta"},       // omite el eje si el programa no dice nada
 "expl":{"<topicId>|<índice>":["Qué propone, explicado","Qué cambiaría para ti","Qué no detalla el programa (o —)"]}}
Normas:
- En "pos", si la postura coincide en lo esencial con una de las "Opciones ya usadas", copia ESE texto literalmente (así la brújula agrupa partidos con la misma postura). Si no, escribe una nueva con el mismo estilo.
- Puedes marcar términos del glosario con {{clave|palabra}} usando SOLO estas claves: ${gloss}.
- Nada que no esté en el programa. Si un tema no aparece, devuelve [] para ese tema.`,
  });

  const keys = new Set(schema.glossary.map(g => g.k));
  const clean = s => String(s || "").trim().replace(/\{\{(\w+)(?:\|([^}]+))?\}\}/g, (m, k, l) => (keys.has(k) ? m : l || k));
  const src = `p29-${party.id}`;
  const p = {}, pos = {}, expl = {};
  for (const t of schema.topics) {
    const list = (out.p?.[t.id] || []).map(clean).filter(Boolean).slice(0, 5);
    p[t.id] = list.map(s => [s, src]);
    list.forEach((_, i) => {
      const e = out.expl?.[`${t.id}|${i}`];
      if (Array.isArray(e)) expl[`${t.id}|${i}`] = [0, 1, 2].map(j => clean(e[j]) || "—");
    });
    for (const e of t.ejes) if (out.pos?.[e.id]) pos[e.id] = clean(out.pos[e.id]);
  }
  return {
    party: party.id,
    election: "29N",
    published: isDate(d.date) ? d.date : today,
    generated: today,
    coalition: d.coalition || null,
    source: { t: `${party.name} — ${d.title || "Programa electoral 29N"}`, u: d.url },
    p, pos, expl,
  };
}
