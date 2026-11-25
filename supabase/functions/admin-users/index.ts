// Portal Contalfa: gestión de usuarios (administrador y supervisores), alta del primer administrador
// y registro propio con el código de la firma (con límite de intentos).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DOMAIN = "usuarios.contalfa.local";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (msg: string, status = 400) => json({ error: msg }, status);
const okUser = (u: string) => /^[a-z0-9._-]{3,30}$/.test(u);
const okPass = (p: string) => typeof p === "string" && p.length >= 8;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Método no permitido", 405);
  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail("Solicitud inválida"); }
  const action = String(body.action || "");

  async function createUser(username: string, full_name: string, password: string, role: string, extra: Record<string, unknown> = {}) {
    username = username.trim().toLowerCase();
    if (!okUser(username)) throw new Error("El usuario debe tener de 3 a 30 caracteres: letras minúsculas, números, punto, guion.");
    if (!okPass(password)) throw new Error("La clave debe tener al menos 8 caracteres.");
    const { data: exists } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
    if (exists) throw new Error("Ese usuario ya existe.");
    const { data, error } = await admin.auth.admin.createUser({
      email: `${username}@${DOMAIN}`, password, email_confirm: true, user_metadata: { username, full_name },
    });
    if (error || !data.user) throw new Error(error?.message || "No se pudo crear el usuario.");
    const { error: e2 } = await admin.from("profiles").insert({ id: data.user.id, username, full_name: full_name.trim(), role, ...extra });
    if (e2) { await admin.auth.admin.deleteUser(data.user.id); throw new Error(e2.message); }
    return { id: data.user.id, username };
  }

  const secret = async (k: string) => (await admin.from("app_secrets").select("value").eq("key", k).maybeSingle()).data?.value ?? null;
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "?";

  try {
    if (action === "signup_info") {
      return json({ enabled: (await secret("signup_enabled")) === "true" });
    }
    if (action === "signup") {
      if ((await secret("signup_enabled")) !== "true") return fail("El registro con código está cerrado. Pide tu usuario al administrador.", 403);
      const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { count: bad } = await admin.from("signup_attempts").select("id", { count: "exact", head: true }).eq("ip", ip).eq("ok", false).gte("at", since);
      if ((bad || 0) >= 5) return fail("Demasiados intentos con un código incorrecto. Espera 15 minutos e intenta de nuevo.", 429);
      const code = String(body.code || "").trim().toUpperCase();
      const real = String((await secret("signup_code")) || "").trim().toUpperCase();
      if (!real || code !== real) {
        await admin.from("signup_attempts").insert({ ip, ok: false });
        const left = 4 - (bad || 0);
        return fail("El código no es correcto." + (left > 0 ? " Te quedan " + left + " intento(s)." : " Espera 15 minutos para intentar de nuevo."), 403);
      }
      const full = String(body.full_name || "").trim();
      if (full.length < 3) return fail("Escribe tu nombre completo.");
      const u = await createUser(String(body.username || ""), full, String(body.password || ""), "analista",
        { origen: "registro", departamento: String(body.departamento || "").trim().slice(0, 60) });
      await admin.from("signup_attempts").insert({ ip, ok: true });
      return json({ ok: true, user: u });
    }
    if (action === "status") {
      const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
      return json({ needsSetup: !count });
    }
    if (action === "bootstrap") {
      const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
      if (count) return fail("El administrador ya fue creado.", 403);
      const { data: s } = await admin.from("app_secrets").select("value").eq("key", "setup_code").maybeSingle();
      if (!s || String(body.code || "").trim() !== s.value) return fail("Código de activación incorrecto.", 403);
      const u = await createUser(String(body.username || ""), String(body.full_name || ""), String(body.password || ""), "admin");
      await admin.from("app_secrets").delete().eq("key", "setup_code");
      return json({ ok: true, user: u });
    }

    // Todo lo demás requiere un administrador o un supervisor con sesión
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: who } = await admin.auth.getUser(token);
    if (!who?.user) return fail("Sesión no válida.", 401);
    const { data: me } = await admin.from("profiles").select("id, role, active").eq("id", who.user.id).maybeSingle();
    const isAdmin = !!me && me.active && me.role === "admin";
    const isSup = !!me && me.active && me.role === "supervisor";
    if (!isAdmin && !isSup) return fail("Solo el administrador o un supervisor puede hacer esto.", 403);
    const adminOnly = () => { if (!isAdmin) throw new Error("Solo el administrador puede hacer esto."); };
    const target = String(body.user_id || "");
    let tgt: { id: string; role: string; supervisor_id: string | null } | null = null;
    if (target) {
      tgt = (await admin.from("profiles").select("id, role, supervisor_id").eq("id", target).maybeSingle()).data;
      if (!tgt) return fail("Usuario no encontrado.", 404);
      if (!isAdmin && tgt.supervisor_id !== me!.id) return fail("Ese usuario no es de tu equipo.", 403);
    }
    if (["set_password", "set_active", "update", "delete"].includes(action) && !tgt) return fail("Falta indicar el usuario.");
    // herramientas que un supervisor puede repartir: las suyas
    const myTools = async () => isAdmin ? null : new Set(((await admin.from("tool_access").select("tool_slug").eq("user_id", me!.id)).data || []).map((x) => x.tool_slug));

    if (action === "create") {
      const allowed = await myTools();
      let tools = Array.isArray(body.tools) ? (body.tools as string[]) : [];
      if (allowed) tools = tools.filter((t) => allowed.has(t));
      const role = isAdmin && body.role === "supervisor" ? "supervisor" : "analista";
      const extra: Record<string, unknown> = { origen: isAdmin ? "admin" : "supervisor", departamento: String(body.departamento || "").trim().slice(0, 60) };
      if (isSup) extra.supervisor_id = me!.id;
      else if (body.supervisor_id) extra.supervisor_id = String(body.supervisor_id);
      const u = await createUser(String(body.username || ""), String(body.full_name || ""), String(body.password || ""), role, extra);
      if (tools.length) await admin.from("tool_access").insert(tools.map((t) => ({ user_id: u.id, tool_slug: t })));
      return json({ ok: true, user: u });
    }
    if (action === "set_password") {
      const p = String(body.password || "");
      if (!okPass(p)) return fail("La clave debe tener al menos 8 caracteres.");
      const { error } = await admin.auth.admin.updateUserById(target, { password: p });
      if (error) return fail(error.message);
      return json({ ok: true });
    }
    if (action === "set_active") {
      if (target === me!.id) return fail("No puedes desactivarte a ti mismo.");
      const active = !!body.active;
      await admin.from("profiles").update({ active }).eq("id", target);
      await admin.auth.admin.updateUserById(target, { ban_duration: active ? "none" : "876000h" });
      return json({ ok: true });
    }
    if (action === "update") {
      const patch: Record<string, unknown> = {};
      if (body.full_name !== undefined) patch.full_name = String(body.full_name || "").trim();
      if (body.departamento !== undefined) patch.departamento = String(body.departamento || "").trim().slice(0, 60);
      if (isAdmin && body.role !== undefined) {
        if (target === me!.id) return fail("No puedes cambiar tu propio rol.");
        if (!["analista", "supervisor"].includes(String(body.role))) return fail("Rol no válido.");
        patch.role = String(body.role);
        if (patch.role === "supervisor") patch.supervisor_id = null;
      }
      if (isAdmin && body.supervisor_id !== undefined) {
        const sid = body.supervisor_id ? String(body.supervisor_id) : null;
        if (sid) {
          const { data: s } = await admin.from("profiles").select("role").eq("id", sid).maybeSingle();
          if (!s || s.role !== "supervisor") return fail("Ese usuario no es supervisor.");
          if (sid === target) return fail("Un usuario no puede ser su propio supervisor.");
        }
        patch.supervisor_id = sid;
      }
      if (!Object.keys(patch).length) return fail("Nada que cambiar.");
      const { error } = await admin.from("profiles").update(patch).eq("id", target);
      if (error) return fail(error.message);
      if (patch.role === "analista") await admin.from("profiles").update({ supervisor_id: null }).eq("supervisor_id", target);
      return json({ ok: true });
    }
    if (action === "delete") {
      adminOnly();
      if (target === me!.id) return fail("No puedes eliminar tu propio usuario.");
      const { error } = await admin.auth.admin.deleteUser(target);
      if (error) return fail(error.message);
      return json({ ok: true });
    }
    if (action === "get_signup") {
      adminOnly();
      return json({ ok: true, enabled: (await secret("signup_enabled")) === "true", code: (await secret("signup_code")) || "" });
    }
    if (action === "set_signup") {
      adminOnly();
      const code = String(body.code || "").trim().toUpperCase();
      if (!/^[A-Z0-9-]{6,30}$/.test(code)) return fail("El código debe tener de 6 a 30 letras o números, sin espacios.");
      await admin.from("app_secrets").upsert([{ key: "signup_code", value: code }, { key: "signup_enabled", value: body.enabled ? "true" : "false" }]);
      return json({ ok: true });
    }
    return fail("Acción desconocida.");
  } catch (e) {
    return fail((e as Error).message || "Error inesperado.");
  }
});
