const base = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export function operatorStoreReady() {
  return Boolean(base && serviceKey);
}

export async function operatorStore(path, options = {}) {
  if (!base || !serviceKey) throw new Error("Background operator storage is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel.");
  const response = await fetch(base + path, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: "Bearer " + serviceKey,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch {}
  if (!response.ok) {
    console.error("GoSolo operator database error:", response.status, raw.slice(0, 500));
    throw new Error(data?.message || data?.hint || "Operator database request failed (" + response.status + ").");
  }
  return data;
}
