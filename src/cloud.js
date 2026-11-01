const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const $ = id => document.getElementById(id);
const panel = $("gosolo-account");
const status = $("gosolo-account-status");
const authForm = $("gosolo-auth-form");
const signedIn = $("gosolo-signed-in");

if (!panel || !status || !authForm || !signedIn) {
  console.error("GoSolo account panel markup is missing.");
} else if (!url || !anonKey) {
  status.textContent = "Account service is not configured. Check the Supabase URL and publishable key in Vercel.";
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
      } finally {
        syncing = false;
      }
    }

    function showUser(user) {
      const active = !!user;
      authForm.hidden = active;
      signedIn.hidden = !active;
      $("gosolo-user").textContent = active ? "Signed in as " + user.email : "";
      status.textContent = active
        ? "Signed in. Your prospects stay on this device until you choose Sync my prospects."
        : "Create an account or log in to save your GoSolo workspace.";
    }

    $("gosolo-signup").addEventListener("click", async () => {
      const email = $("gosolo-email").value.trim();
      const password = $("gosolo-password").value;
      if (!email || password.length < 8) {
        status.textContent = "Enter a valid email and a password of at least 8 characters.";
        return;
      }
      const button = $("gosolo-signup");
      button.disabled = true;
      try {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) showUser(data.user);
        else status.textContent = "Account created. Check your email for a confirmation link, then log in.";
      } catch (error) {
        status.textContent = error.message || "Account creation failed.";
      } finally {
        button.disabled = false;
      }
    });

    $("gosolo-login").addEventListener("click", async () => {
      const button = $("gosolo-login");
      button.disabled = true;
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: $("gosolo-email").value.trim(),
          password: $("gosolo-password").value
        });
        if (error) throw error;
        showUser(data.user);
      } catch (error) {
        status.textContent = error.message || "Login failed.";
      } finally {
        button.disabled = false;
      }
    });

    $("gosolo-sync").addEventListener("click", async () => {
      try { await syncProspects(); }
      catch (error) { status.textContent = error.message || "Cloud sync failed."; }
    });

    $("gosolo-logout").addEventListener("click", async () => {
      const { error } = await supabase.auth.signOut();
      if (error) status.textContent = error.message;
      else showUser(null);
    });

    supabase.auth.onAuthStateChange((_event, session) => showUser(session?.user || null));
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) status.textContent = error.message;
      else showUser(data.session?.user || null);
    });
  }).catch(error => {
    status.textContent = "Could not load the account service: " + (error.message || String(error));
  });
}
