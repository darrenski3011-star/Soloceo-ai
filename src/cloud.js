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
  status.textContent = "Account service is not configured. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel.";
} else {
  const base = url.replace(/\/$/, "");
  const storageKey = "gosolo ai_leads_v1";
  const sessionKey = "gosolo_supabase_session_v1";
  let session = null;
  let syncing = false;
  let refreshPromise = null;

  function saveSession(value) {
    session = value;
    try {
      if (value) localStorage.setItem(sessionKey, JSON.stringify(value));
      else localStorage.removeItem(sessionKey);
    } catch (_) {
      status.textContent = "This browser blocked session storage. Enable site storage and log in again.";
    }
  }

  async function request(path, options = {}, token) {
    const response = await fetch(base + path, {
      ...options,
      headers: {
        apikey: anonKey,
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.msg || result.message || result.error_description || result.error || "Supabase request failed (" + response.status + ").");
    }
    return result;
  }

  function showUser(user) {
    const active = !!user;
    authForm.hidden = active;
    signedIn.hidden = !active;
    $("gosolo-user").textContent = active ? "Signed in as " + user.email : "";
    status.textContent = active
      ? "Signed in. Your prospects sync to your account when you save them."
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

  async function refreshSession() {
    if (!session?.refresh_token) return null;
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      try {
        const next = await request("/auth/v1/token?grant_type=refresh_token", {
          method: "POST",
          body: JSON.stringify({ refresh_token: session.refresh_token })
        });
        saveSession(next);
        return next;
      } catch (error) {
        saveSession(null);
        showUser(null);
        throw error;
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }

  async function validAccessToken() {
    if (!session?.access_token) throw new Error("Log in first.");
    const expiresAt = Number(session.expires_at || 0);
    if (expiresAt && expiresAt * 1000 < Date.now() + 60000) {
      await refreshSession();
    }
    if (!session?.access_token) throw new Error("Your session expired. Log in again.");
    return session.access_token;
  }

  async function authRequest(path, body) {
    return request("/auth/v1/" + path, { method: "POST", body: JSON.stringify(body) });
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
    status.textContent = "Creating your secure account...";
    try {
      const data = await authRequest("signup", { email, password });
      if (data.access_token && data.user) {
        saveSession(data);
        showUser(data.user);
        await syncProspects();
      } else {
        status.textContent = "Account created. Check your email for the confirmation link, then return here and log in.";
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
      saveSession(data);
      showUser(data.user);
      await syncProspects();
    } catch (error) {
      status.textContent = error.message || "Login failed.";
    } finally {
      setBusy(button, false);
    }
  });

  async function syncProspects() {
    if (syncing) return;
    const token = await validAccessToken();
    const userId = session?.user?.id;
    if (!userId) throw new Error("Your account session is incomplete. Log out and log in again.");
    syncing = true;
    try {
      const headers = { Prefer: "resolution=merge-duplicates,return=minimal" };
      const read = await request("/rest/v1/user_data?select=data&data_key=eq.prospects&user_id=eq." + encodeURIComponent(userId), {}, token);
      const cloud = Array.isArray(read?.[0]?.data) ? read[0].data : [];
      let local = [];
      try {
        const parsed = JSON.parse(localStorage.getItem(storageKey) || "[]");
        local = Array.isArray(parsed) ? parsed : [];
      } catch (_) {}
      const seen = new Set();
      const merged = [...cloud, ...local].filter(item => {
        const key = [item.sourceUrl || "", String(item.name || "").toLowerCase(), String(item.contact || "").toLowerCase()].join("|");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      await request("/rest/v1/user_data?on_conflict=user_id,data_key", {
        method: "POST",
        headers,
        body: JSON.stringify({ user_id: userId, data_key: "prospects", data: merged })
      }, token);
      localStorage.setItem(storageKey, JSON.stringify(merged));
      status.textContent = "Cloud sync complete. " + merged.length + " prospect(s) saved to your account.";
      window.dispatchEvent(new CustomEvent("gosolo:cloud-synced", { detail: { count: merged.length } }));
    } finally {
      syncing = false;
    }
  }

  $("gosolo-sync").addEventListener("click", async () => {
    const button = $("gosolo-sync");
    setBusy(button, true, "Syncing...");
    try { await syncProspects(); }
    catch (error) { status.textContent = error.message || "Cloud sync failed."; }
    finally { setBusy(button, false); }
  });

  $("gosolo-logout").addEventListener("click", async () => {
    const button = $("gosolo-logout");
    setBusy(button, true, "Logging out...");
    try {
      if (session?.access_token) {
        await request("/auth/v1/logout", { method: "POST" }, session.access_token);
      }
    } catch (error) {
      console.warn("Remote sign-out did not complete:", error);
    } finally {
      saveSession(null);
      showUser(null);
      setBusy(button, false);
    }
  });

  window.addEventListener("gosolo:prospects-updated", () => {
    if (session?.access_token && !syncing) {
      syncProspects().catch(error => {
        status.textContent = "Prospects saved on this device. Cloud sync needs attention: " + (error.message || "unknown error");
      });
    }
  });

  async function restoreSession() {
    try {
      const saved = JSON.parse(localStorage.getItem(sessionKey) || "null");
      if (!saved?.refresh_token) {
        showUser(null);
        status.textContent = "Account service ready. Enter your email and password to create an account.";
        return;
      }
      session = saved;
      if (Number(session.expires_at || 0) * 1000 < Date.now() + 60000) {
        await refreshSession();
      }
      if (session?.access_token && session?.user) {
        showUser(session.user);
        await syncProspects();
      } else {
        showUser(null);
      }
    } catch (error) {
      status.textContent = "Could not restore your account session. Log in again. " + (error.message || "");
      saveSession(null);
      showUser(null);
    }
  }

  restoreSession();
}
