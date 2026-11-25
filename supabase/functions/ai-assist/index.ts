// Portal Contalfa: asistente de IA (Gemini) para revisar archivos antes de que entren a una herramienta.
// La clave GEMINI_API_KEY vive solo aquí (secreto de Supabase); nunca llega al navegador.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const KEY = Deno.env.get("GEMINI_API_KEY") || "";
const MODELS = (Deno.env.get("GEMINI_MODELS") || "gemini-flash-latest,gemini-flash-lite-latest").split(",").map((s) => s.trim()).filter(Boolean);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SYSTEM = `Eres el asistente de carga de archivos del Portal Contalfa, una firma de contadores en Venezuela.
Un analista subió una hoja de cálculo a una herramienta contable. Recibes: el tipo de documento que espera la herramienta (con sus campos),
el nombre del archivo, las hojas, y las primeras filas de cada hoja (algunos textos vienen enmascarados por privacidad).
Tu trabajo: decir qué es realmente el archivo, en qué hoja y fila está el encabezado, qué columna corresponde a cada campo, y explicar en español
sencillo, en 1 a 3 frases cortas, qué está mal o es distinto a lo esperado y qué debe verificar el analista.
Reglas: los índices de fila y columna empiezan en 0. Si un campo no existe en el archivo usa -1. No inventes columnas.
Formatos venezolanos: montos como 1.234,56; fechas dd/mm/aaaa. Si el archivo parece ser otro documento (por ejemplo libro de compras en vez de ventas,
mayor en vez de balance, o un reporte sin relación) dilo claramente en "es_otro_documento".
Responde SOLO con JSON con esta forma:
{"tipo": "<clave del tipo de documento elegido o 'otro'>", "es_otro_documento": "<vacío o qué documento parece ser>",
 "hoja": <índice>, "fila_encabezado": <índice o -1 si no hay encabezado>, "columnas": {"<campo>": <índice de columna>},
 "opciones": {"montos": "debe_haber" | "monto_con_signo", "formato_fecha": "dmy" | "mdy" | "ymd", "tipo_modulo": "CXP" | "CXC" | ""},
 "explicacion": "<texto breve para el analista>", "confianza": <0 a 1>}`;

// Modelos disponibles para esta clave (se consulta una vez y se guarda en memoria)
let discovered: string[] | null = null;
async function listModels(): Promise<string[]> {
  if (discovered) return discovered;
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": KEY } });
    const j = await r.json();
    const ver = (n: string) => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || "0");
    discovered = (j.models || [])
      .filter((m: { name: string; supportedGenerationMethods?: string[] }) => (m.supportedGenerationMethods || []).includes("generateContent") && /gemini-[\d.]+-flash(-lite)?$|gemini-flash(-lite)?-latest$/.test(m.name))
      .map((m: { name: string }) => m.name.replace(/^models\//, ""))
      .sort((a: string, b: string) => (/lite/.test(a) ? 1 : 0) - (/lite/.test(b) ? 1 : 0) || ver(b) - ver(a));
  } catch { discovered = []; }
  return discovered!;
}

async function gemini(prompt: string) {
  const errs: string[] = [];
  const order = [...new Set([...MODELS, ...(await listModels())])];
  for (const model of order) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1, maxOutputTokens: 4096 },
      }),
    });
    const t = await r.text();
    if (r.ok) {
      const j = JSON.parse(t);
      const text = j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "";
      try { return { model, result: JSON.parse(text.replace(/^```json\s*|```\s*$/g, "")) }; }
      catch { errs.push(model + ": respuesta no legible"); continue; }
    }
    errs.push(`${model}: ${r.status}`);
    if (r.status === 401 || r.status === 403) throw new Error("La clave de Gemini no es válida o no tiene permiso. Revisa GEMINI_API_KEY en Supabase.");
    if (r.status === 429 && errs.length >= 3) throw new Error("La IA alcanzó el límite gratuito por ahora. Intenta en un minuto o ajusta las columnas a mano.");
    // 404 (modelo retirado), 400, 429 o 5xx (saturado): se prueba el siguiente modelo
  }
  throw new Error("La IA no está disponible en este momento (" + errs.join(", ") + "). Puedes ajustar las columnas a mano.");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: who } = await admin.auth.getUser(token);
  if (!who?.user) return json({ error: "Sesión no válida." }, 401);
  const { data: me } = await admin.from("profiles").select("active").eq("id", who.user.id).maybeSingle();
  if (!me?.active) return json({ error: "Usuario sin acceso." }, 403);
  if (!KEY) return json({ error: "Falta la clave de Gemini (GEMINI_API_KEY) en Supabase." }, 503);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Solicitud inválida" }, 400); }
  if (body.action === "models") return json({ ok: true, models: [...new Set([...MODELS, ...(await listModels())])] });
  const payload = JSON.stringify(body).slice(0, 60000);
  try {
    const out = await gemini("Datos del archivo:\n" + payload);
    return json({ ok: true, ...out });
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
});
