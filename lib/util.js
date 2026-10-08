export function authorized(req) {
  const s = process.env.CRON_SECRET;
  return !!s && req.headers.authorization === `Bearer ${s}`;
}
// Fecha (YYYY-MM-DD) en Madrid
export const madridDate = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(d);
export const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const isURL = s => typeof s === "string" && /^https?:\/\/\S+$/.test(s);
export const hash = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
// Partidos que pueden aparecer en noticias (los del comparador + los que solo salen en noticias/encuestas)
export const EXTRA_NEWS_PARTIES = [
  { id: "podemos", name: "Podemos" }, { id: "cc", name: "Coalición Canaria" }, { id: "salf", name: "Se Acabó La Fiesta" },
];
