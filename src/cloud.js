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
  const storageKey = "gosolo ai_leads_v1";
  let accessToken = null;
  let syncing = false;

  async function authRequest(path, body) {
    const response = await fetch(url.replace(/\/$/, "")) + "/auth/v1/" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anonKey },
      body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.msg || result.message || result.error_description || result.error || "Supabase request failed (" + response.status + ").");
    return result;
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

  function setBusy(button, busy, label) {
    button.disabled = busy;
    if (busy) {
      button.dataset.originalLabel = button.textContent;
      button.textContent = label;
    } else if (button.dataset.originalLabel) {
      button.textContent = button.dataset.originalLabel;
      delete button.dataset.originalLabel;
    }
  }

  $("gosolo-signup").addEventListener("click", async () => {
    const email = $("gosolo-email").value.trim();
    const password = $("gosolo-password").value;
    const button = $("gosolo-signup");
    if (!email || password.length < 8) {
      status.textContent = "Enter a valid email and a password of at least 8 characters.";
      return;
    }
    setBusy(button, true, "Creating account...");
    status.textContent = "Connecting securely to Supabase...";
    try {
      const data = await authRequest("signup", { email, password });
      if (data.access_token) {
        accessToken = data.access_token;
        showUser(data.user);
      } else {
        status.textContent = "Account request received. Check your email for a confirmation link, then log in.";
      }
    } catch (error) {
      status.textContent = error.message || "Account creation failed.";
    } finally {
      setBusy(button, false);
    }
  });

  $("gosolo-login").addEventListener("click", async () => {
    const button = $("gosolo-login");
    const email = $("gosolo-email").value.trim();
    const password = $("gosolo-password").value;
    if (!email || !password) {
      status.textContent = "Enter your email and password first.";
      return;
    }
    setBusy(button, true, "Logging in...");
    try {
      const data = await authRequest("token?grant_type=password", { email, password });
      accessToken = data.access_token;
      showUser(data.user);
    } catch (error) {
      status.textContent = error.message || "Login failed.";
    } finally {
      setBusy(button, false);
    }
  });

  async function syncProspects() {
    if (syncing) return;
    if (!accessToken) throw new Error("Log in first.");
    syncing = true;
    try {
      const local = JSON.parse(localStorage.getItem(storageKey) || "[]");
      const headers = { apikey: anonKey, Authorization: "Bearer " + accessToken, "Content-Type": "application/json" };
      const read = await fetch(url.replace(/\/$/, "")) + "/rest/v1/user_data?select=data&data_key=eq.prospects", { headers });
      const rows = await read.json();
      if (!read.ok) throw new Error(rows.message || "Could not read saved prospects.");
      const cloud = Array.isArray(rows?.[0]?.data) ? rows[0].data : [];
      const seen = new Set();
      const merged = [...cloud, ...(Array.isArray(local) ? local : [])].filter(item => {
        const key = [item.sourceUrl || "", String(item.name || "").toLowerCase(), String(item.contact || "").toLowerCase()].join("|");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const write = await fetch(url.replace(/\/$/, "")) + "/rest/v1/user_data?on_conflict=user_id,data_key", {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ data_key: "prospects", data: merged })
      });
      if (!write.ok) {
        const error = await write.json().catch(() => ({}));
        throw new Error(error.message || "Cloud sync failed (" + write.status + ").");
      }
      localStorage.setItem(storageKey, JSON.stringify(merged));
      status.textContent = "Cloud sync complete. " + merged.length + " prospect(s) saved to your account.";
    } finally {
      syncing = false;
    }
  }

  $("gosolo-sync").addEventListener("click", async () => {
    try { await syncProspects(); }
    catch (error) { status.textContent = error.message || "Cloud sync failed."; }
  });

  $("gosolo-logout").addEventListener("click", () => {
    accessToken = null;
    showUser(null);
  });

  status.textContent = "Account service ready. Enter your email and password to create an account.";
}
