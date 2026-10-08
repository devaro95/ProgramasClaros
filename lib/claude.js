// Llamada a Claude con búsqueda (y lectura) web del lado del servidor. Devuelve el JSON de la respuesta final.
const MODEL = () => process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

export const webSearch = (max = 10) => ({
  type: "web_search_20250305", name: "web_search", max_uses: max,
  user_location: { type: "approximate", country: "ES", timezone: "Europe/Madrid" },
});
export const webFetch = (max = 4) => ({ type: "web_fetch_20250910", name: "web_fetch", max_uses: max, max_content_tokens: 120000 });

export async function askJSON({ system, prompt, tools = [], maxTokens = 8000 }) {
  const messages = [{ role: "user", content: prompt }];
  for (let turn = 0; turn < 6; turn++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "web-fetch-2025-09-10",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: MODEL(), max_tokens: maxTokens, system, tools, messages }),
    });
    if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
    const res = await r.json();
    if (res.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: res.content }); continue; }
    const text = res.content.filter(b => b.type === "text").map(b => b.text).join("\n");
    return parseJSON(text);
  }
  throw new Error("Claude no terminó la respuesta");
}

function parseJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const s = fenced ? fenced[1] : text;
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("Respuesta sin JSON: " + text.slice(0, 300));
  return JSON.parse(s.slice(a, b + 1));
}
