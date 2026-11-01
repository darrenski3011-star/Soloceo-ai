import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const style = document.createElement("style");
style.textContent = `
#gosolo-account{margin:14px 0;padding:16px;border:1px solid #245331;border-radius:14px;background:#082512;color:#efffee}
#gosolo-account input{box-sizing:border-box;width:100%;margin:6px 0;padding:10px;background:#061b0d;color:#fff;border:1px solid #32633c;border-radius:7px}
#gosolo-account .account-row{display:flex;gap:8px;flex-wrap:wrap}
#gosolo-account button{padding:10px 14px;margin:6px 6px 0 0;border:0;border-radius:8px;background:#39ff14;color:#031b0a;font-weight:800}
#gosolo-account button.secondary{background:#123a20;color:#efffee;border:1px solid #245331}
`;
document.head.append(style);
const panel = document.createElement("section");
panel.id = "gosolo-account";
panel.innerHTML = `
<h2>Customer account & cloud backup</h2>
<p id="gosolo-account-status" aria-live="polite">Connecting...</p>
<div id="gosolo-auth-form">
<label>Email<input id="gosolo-email" type="email" autocomplete="email" placeholder="you@example.com"></label>
<label>Password<input id="gosolo-password" type="password" autocomplete="current-password" minlength="8" placeholder="At least 8 characters"></label>
<div class="account-row"><button id="gosolo-signup" type="button">Create account</button><button id="gosolo-login" class="secondary" type="button">Log in</button></div>
</div>
<div id="gosolo-signed-in" hidden><p id="gosolo-user"></p><button id="gosolo-sync" type="button">Sync my prospects</button><button id="gosolo-logout" class="secondary" type="button">Log out</button></div>
`;
const anchor = document.querySelector("header") || document.body.firstElementChild;
if (anchor) anchor.insertAdjacentElement("afterend", panel);
const $ = id => document.getElementById(id);
const status = $("gosolo-account-status");
const authForm = $("gosolo-auth-form");
const signedIn = $("gosolo-signed-in");

if (!url || !anonKey) {
  status.textContent = "Account setup is not configured. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel.";
} else {
  import("https://esm.sh/@supabase/supabase-js@2").then(({ createClient }) => {
    const supabase = createClient(url, anonKey);
    const storageKey = "gosolo ai_leads_v1";
    let syncing = false;
    async function syncProspects() {
      if (syncing) return;
      syncing = true;
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) throw new Error("Log in first.");
        const local = JSON.parse(localStorage.getItem(storageKey) || "[]");
        const { data: cloudRow, error: readError } = await supabase.from("user_data")
          .select("data").eq("data_key", "prospects").maybeSingle();
        if (readError) throw readError;
        const cloud = Array.isArray(cloudRow?.data) ? cloudRow.data : [];
        const seen = new Set();
        const merged = [...cloud, ...(Array.isArray(local) ? local : [])].filter(item => {
          const key = [item.sourceUrl || "", String(item.name || "").toLowerCase(), String(item.contact || "").toLowerCase()].join("|");
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        const { error } = await supabase.from("user_data").upsert({
          user_id: user.id, data_key: "prospects", data: merged, updated_at: new Date().toISOString()
        }, { onConflict: "user_id,data_key" });
        if (error) throw error;
        localStorage.setItem(storageKey, JSON.stringify(merged));
        status.textContent = "Cloud sync complete. " + merged.length + " prospect(s) saved to your account.";
      } finally { syncing = false; }
    }
    async function showUser(user) {
      const active = !!user;
      authForm.hidden = active;
      signedIn.hidden = !active;
      $("gosolo-user").textContent = active ? "Signed in as " + user.email : "";
      status.textContent = active ? "Account connected. Syncing your prospects..." : "Create an account or log in to sync your data.";
      if (active) try { await syncProspects(); } catch (e) { status.textContent = "Signed in, but sync needs attention: " + e.message; }
    }
    $("gosolo-signup").addEventListener("click", async () => {
      const email = $("gosolo-email").value.trim(), password = $("gosolo-password").value;
      if (!email || password.length < 8) { status.textContent = "Enter a valid email and a password of at least 8 characters."; return; }
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) { status.textContent = error.message; return; }
      if (data.session) await showUser(data.user);
      else status.textContent = "Account created. Check your email for the confirmation link, then log in.";
    });
    $("gosolo-login").addEventListener("click", async () => {
      const { data, error } = await supabase.auth.signInWithPassword({ email: $("gosolo-email").value.trim(), password: $("gosolo-password").value });
      if (error) { status.textContent = error.message; return; }
      await showUser(data.user);
    });
    $("gosolo-sync").addEventListener("click", async () => {
      try { await syncProspects(); } catch (e) { status.textContent = e.message; }
    });
    $("gosolo-logout").addEventListener("click", async () => {
      const { error } = await supabase.auth.signOut();
      if (error) status.textContent = error.message;
      else await showUser(null);
    });
    supabase.auth.onAuthStateChange((_event, session) => { showUser(session?.user || null); });
    supabase.auth.getSession().then(({ data }) => showUser(data.session?.user || null));
  }).catch(error => { status.textContent = "Could not load the account service: " + error.message; });
}
