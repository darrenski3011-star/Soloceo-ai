const dashboard = document.getElementById("dashboard");
if (dashboard && !document.getElementById("warriorplus-panel")) {
  const panel = document.createElement("section");
  panel.className = "panel";
  panel.id = "warriorplus-panel";
  panel.innerHTML = '<h2>WarriorPlus connection</h2><p class="muted">Import your WarriorPlus products, offers, vendor sales and buyer purchases into GoSolo for analysis. This connection is read-only.</p><button class="button secondary" id="warriorplus-refresh" type="button">Connect and refresh WarriorPlus</button><div id="warriorplus-status" class="status" role="status" aria-live="polite">Not checked yet.</div><div id="warriorplus-summary" class="cards"></div>';
  dashboard.prepend(panel);

  const button = panel.querySelector("#warriorplus-refresh");
  const status = panel.querySelector("#warriorplus-status");
  const summary = panel.querySelector("#warriorplus-summary");
  const token = () => {
    try { return JSON.parse(localStorage.getItem("gosolo_supabase_session_v1") || "null")?.access_token || ""; }
    catch { return ""; }
  };
  const showCount = (label, value) => {
    const card = document.createElement("div");
    card.className = "item";
    const heading = document.createElement("h3");
    heading.textContent = label;
    const count = document.createElement("p");
    count.textContent = String(value);
    card.append(heading, count);
    summary.append(card);
  };
  button.addEventListener("click", async () => {
    button.disabled = true;
    status.classList.remove("error");
    status.textContent = "Connecting securely to WarriorPlus and retrieving your account data...";
    summary.replaceChildren();
    try {
      const accessToken = token();
      if (!accessToken) throw new Error("Log in to your GoSolo owner account first.");
      const response = await fetch("/api/operator?resource=warriorplus&action=overview&limit=25", {
        headers: { Authorization: "Bearer " + accessToken }
      });
      const data = await response.json();
      if (!response.ok || !data.connected) throw new Error(data.error || "WarriorPlus connection failed.");
      showCount("Products", data.products?.data?.length || 0);
      showCount("Offers", data.offers?.data?.length || 0);
      showCount("Vendor sales", data.sales?.data?.length || 0);
      showCount("Purchases", data.purchases?.data?.length || 0);
      status.textContent = "Connected to WarriorPlus V2. Retrieved the latest page of account records at " + new Date(data.checkedAt).toLocaleString() + ".";
    } catch (error) {
      status.classList.add("error");
      status.textContent = error.message || "Could not connect to WarriorPlus.";
    } finally {
      button.disabled = false;
    }
  });
}
