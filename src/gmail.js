const $ = id => document.getElementById(id);
const panel = $("gosolo-gmail-panel");

if (panel) {
  const sessionKey = "gosolo_supabase_session_v1";

  let queuedId = null;

  function getSession() {
    try { return JSON.parse(localStorage.getItem(sessionKey) || "null"); }
    catch { return null; }
  }

  async function accessToken() {
    let session = getSession();
    if (!session?.access_token) throw new Error("Log in to your GoSolo account first.");
    if (session.expires_at && session.expires_at * 1000 < Date.now() + 60000 && session.refresh_token) {
      const base = import.meta.env.VITE_SUPABASE_URL.replace(/\/$/, "");
      const response = await fetch(base + "/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: session.refresh_token })
      });
      const next = await response.json();
      if (!response.ok || !next.access_token) throw new Error("Your GoSolo login expired. Log in again.");
      localStorage.setItem(sessionKey, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent("gosolo:session-updated", { detail: { session: next } }));
      session = next;
    }
    return session.access_token;
  }

  async function callApi(path, method = "GET", body) {
    const token = await accessToken();
    const response = await fetch(path, {
      method,
      headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "GoSolo request failed (" + response.status + ").");
    return data;
  }

  function showStatus(message, isError = false) {
    const element = $("gosolo-gmail-status");
    element.textContent = message;
    element.className = "status" + (isError ? " error" : "");
  }

  async function refresh() {
    try {
      const data = await callApi("/api/google/status");
      $("gosolo-gmail-connect").disabled = !!data.connected;
      showStatus(data.connected ? "Connected to " + data.email + ". Gmail is ready for reviewed outreach drafts." : "Gmail is not connected.");
    } catch (error) {
      showStatus(error.message, true);
    }
  }

  $("gosolo-gmail-connect").addEventListener("click", async () => {
    try {
      const data = await callApi("/api/google/connect", "POST", {});
      if (!data.authorizationUrl) throw new Error("Google did not return a connection link.");
      location.href = data.authorizationUrl;
    } catch (error) {
      showStatus(error.message, true);
    }
  });

  $("gosolo-gmail-refresh").addEventListener("click", refresh);

  $("gosolo-gmail-queue").addEventListener("click", async () => {
    const button = $("gosolo-gmail-queue");
    button.disabled = true;
    try {
      const data = await callApi("/api/outreach/queue", "POST", {
        recipientEmail: $("gosolo-gmail-recipient").value,
        subject: $("gosolo-gmail-subject").value,
        body: $("gosolo-gmail-body").value
      });
      queuedId = data.approval?.id || null;
      $("gosolo-gmail-send").disabled = !queuedId;
      showStatus(data.message || "Draft saved for approval. Nothing was sent. Review it, then explicitly approve sending.");
    } catch (error) {
      showStatus(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  $("gosolo-gmail-send").addEventListener("click", async () => {
    if (!queuedId) {
      showStatus("Save an outreach draft first.", true);
      return;
    }
    if (!confirm("Send this email now from your connected Gmail account? This will contact the recipient.")) return;
    const button = $("gosolo-gmail-send");
    button.disabled = true;
    try {
      await callApi("/api/outreach/approve", "POST", { id: queuedId });
      const sent = await callApi("/api/outreach/send", "POST", { id: queuedId });
      showStatus("Email sent successfully. Gmail message ID: " + (sent.messageId || "confirmed"));
      queuedId = null;
      $("gosolo-gmail-recipient").value = "";
      $("gosolo-gmail-subject").value = "";
      $("gosolo-gmail-body").value = "";
    } catch (error) {
      showStatus(error.message, true);
      button.disabled = false;
    }
  });

  const params = new URLSearchParams(location.search);
  if (params.get("gmail") === "connected") {
    history.replaceState({}, "", "/");
    showStatus("Google returned to GoSolo. Verifying the Gmail connection...");
  }

  const billing = $("billing-status");
  function syncVisibility() {
    const active = /access is active|owner access verified/i.test(billing?.textContent || "");
    panel.classList.toggle("hidden", !active);
    if (active && !panel.dataset.checked) {
      panel.dataset.checked = "1";
      refresh();
    }
  }
  if (billing) {
    new MutationObserver(syncVisibility).observe(billing, { childList: true, subtree: true, characterData: true });
    syncVisibility();
  }
}
