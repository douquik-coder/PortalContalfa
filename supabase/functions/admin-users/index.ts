// Portal Contalfa: gestión de usuarios (solo administrador) y alta del primer administrador.
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

  async function createUser(username: string, full_name: string, password: string, role: string) {
    username = username.trim().toLowerCase();
    if (!okUser(username)) throw new Error("El usuario debe tener de 3 a 30 caracteres: letras minúsculas, números, punto, guion.");
    if (!okPass(password)) throw new Error("La clave debe tener al menos 8 caracteres.");
    const { data: exists } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
    if (exists) throw new Error("Ese usuario ya existe.");
    const { data, error } = await admin.auth.admin.createUser({
      email: `${username}@${DOMAIN}`, password, email_confirm: true, user_metadata: { username, full_name },
    });
    if (error || !data.user) throw new Error(error?.message || "No se pudo crear el usuario.");
    const { error: e2 } = await admin.from("profiles").insert({ id: data.user.id, username, full_name: full_name.trim(), role });
    if (e2) { await admin.auth.admin.deleteUser(data.user.id); throw new Error(e2.message); }
    return { id: data.user.id, username };
  }

  try {
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

    // Todo lo demás requiere un administrador con sesión
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: who } = await admin.auth.getUser(token);
    if (!who?.user) return fail("Sesión no válida.", 401);
    const { data: me } = await admin.from("profiles").select("id, role, active").eq("id", who.user.id).maybeSingle();
    if (!me || me.role !== "admin" || !me.active) return fail("Solo el administrador puede hacer esto.", 403);
    const target = String(body.user_id || "");

    if (action === "create") {
      const u = await createUser(String(body.username || ""), String(body.full_name || ""), String(body.password || ""), "analista");
      const tools = Array.isArray(body.tools) ? (body.tools as string[]) : [];
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
      if (target === me.id) return fail("No puedes desactivarte a ti mismo.");
      const active = !!body.active;
      await admin.from("profiles").update({ active }).eq("id", target);
      await admin.auth.admin.updateUserById(target, { ban_duration: active ? "none" : "876000h" });
      return json({ ok: true });
    }
    if (action === "update") {
      const { error } = await admin.from("profiles").update({ full_name: String(body.full_name || "").trim() }).eq("id", target);
      if (error) return fail(error.message);
      return json({ ok: true });
    }
    if (action === "delete") {
      if (target === me.id) return fail("No puedes eliminar tu propio usuario.");
      const { error } = await admin.auth.admin.deleteUser(target);
      if (error) return fail(error.message);
      return json({ ok: true });
    }
    return fail("Acción desconocida.");
  } catch (e) {
    return fail((e as Error).message || "Error inesperado.");
  }
});
