
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Send a POST request to build a business."
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "Gemini is not configured. Check GEMINI_API_KEY in Vercel."
    });
  }

  try {
    const body = req.body || {};

    const business = String(
      body.business || body.idea || body.businessIdea || ""
    ).trim().slice(0, 2000);

    const skills = String(body.skills || "")
      .trim().slice(0, 1500);

    const budget = String(body.budget ?? "$0")
      .trim().slice(0, 100);

    const goal = String(body.goal || "recurring income")
      .trim().slice(0, 200);

    if (!business) {
      return res.status(400).json({
        error: "Describe the business you want to build."
      });
    }

    const prompt = `
You are SOLOCO AI, an approval-controlled business operator.

OBJECTIVE
Choose and prepare a realistic business that can start with $0,
prioritizing a service business that can earn recurring revenue.

USER
Business request: ${business}
Skills: ${skills || "Unknown. Prefer beginner-friendly options."}
Budget: ${budget}
Goal: ${goal}

OPERATING RULES
- Start with free tools and actions.
- Do not assume paid subscriptions, an existing audience, or customers.
- Prefer a service that can be sold before expensive infrastructure is needed.
- Never guarantee income or invent market research.
- Do not claim that drafts are published or that customers were contacted.
- Do not spend money, publish content, contact people, register accounts,
  accept contracts, or make commitments.
- Mark actions that affect the outside world as requiring human approval.
- Produce actual usable draft content, not just descriptions of content.
- Choose ONE initial business rather than listing dozens of ideas.
- Make tasks small enough to complete and verify.
- Explain how recurring revenue could work and what must be validated.
- If facts are uncertain, state assumptions.

Return ONLY valid JSON using this structure:
{
  "businessName": "string",
  "businessModel": "string",
  "targetCustomer": "string",
  "offer": "string",
  "pricingHypothesis": "string",
  "recurringRevenuePlan": "string",
  "assumptions": ["string"],
  "priorities": [
    {
      "title": "string",
      "reason": "string"
    }
  ],
  "tasks": [
    {
      "id": "task-1",
      "title": "string",
      "description": "string",
      "status": "pending",
      "actionType": "research|create|review|external_action",
      "requiresApproval": true
    }
  ],
  "assets": [
    {
      "id": "asset-1",
      "type": "landing_page|sales_copy|marketing_draft|service_description|other",
      "title": "string",
      "content": "string",
      "status": "draft",
      "requiresApproval": true
    }
  ],
  "approvalQueue": [
    {
      "id": "approval-1",
      "title": "string",
      "description": "string",
      "status": "awaiting_approval"
    }
  ],
  "metrics": [
    {
      "name": "string",
      "target": "string",
      "measurement": "string"
    }
  ],
  "nextAction": "string"
}

Create 3 to 8 actionable tasks and 2 to 5 usable assets.
Prioritize validating demand and getting the first customer.
Do not make every internal planning task require approval.
Every external action or commitment must require approval.
Use realistic pricing hypotheses, not claims of proven market rates.
`;

    let lastError = "The AI could not complete the request.";
    let operator = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      let response;

      try {
        response = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey
            },
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [{ text: prompt }]
                }
              ],
              generationConfig: {
                temperature: 0.4,
                responseMimeType: "application/json",
                maxOutputTokens: 6000
              }
            }),
            signal: AbortSignal.timeout(55000)
          }
        );
      } catch (error) {
        lastError = "Could not connect to Gemini or the request timed out.";

        if (attempt < 2) {
          await new Promise(resolve =>
            setTimeout(resolve, 1000 * (attempt + 1))
          );
          continue;
        }

        break;
      }

      const responseText = await response.text();
      let data = {};

      try {
        data = JSON.parse(responseText);
      } catch {
        lastError = "Gemini returned an unreadable server response.";
        break;
      }

      if (!response.ok) {
        lastError =
          data?.error?.message ||
          `Gemini returned HTTP ${response.status}.`;

        const temporary =
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500;

        if (temporary && attempt < 2) {
          await new Promise(resolve =>
            setTimeout(resolve, 1000 * (attempt + 1))
          );
          continue;
        }

        break;
      }

      const generatedText = (
        data?.candidates?.[0]?.content?.parts || []
      ).map(part => part.text || "").join("\n").trim();

      if (!generatedText) {
        lastError =
          "Gemini returned no content. Try again or check the API logs.";
        break;
      }

      try {
        operator = JSON.parse(
          generatedText
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/, "")
        );
      } catch {
        lastError = "Gemini returned invalid operator JSON.";
        break;
      }

      if (
        !operator ||
        typeof operator !== "object" ||
        !Array.isArray(operator.tasks) ||
        !Array.isArray(operator.assets) ||
        typeof operator.businessName !== "string"
      ) {
        operator = null;
        lastError = "The AI response is missing required business data.";
        break;
      }

      break;
    }

    if (!operator) {
      console.error("Soloco operator generation failed:", lastError);

      return res.status(502).json({
        error: lastError
      });
    }

    // Enforce approval gates on every generated external action.
    operator.tasks = operator.tasks.map((task, index) => {
      const external =
        task.actionType === "external_action" ||
        task.requiresApproval === true;

      return {
        ...task,
        id: String(task.id || `task-${index + 1}`),
        status: "pending",
        requiresApproval: external
      };
    });

    operator.assets = operator.assets.map((asset, index) => ({
      ...asset,
      id: String(asset.id || `asset-${index + 1}`),
      status: "draft",
      requiresApproval: true
    }));

    operator.approvalQueue = Array.isArray(operator.approvalQueue)
      ? operator.approvalQueue.map((item, index) => ({
          ...item,
          id: String(item.id || `approval-${index + 1}`),
          status: "awaiting_approval"
        }))
      : [];

    const text = [
      `BUSINESS: ${operator.businessName}`,
      "",
      `BUSINESS MODEL: ${operator.businessModel || ""}`,
      "",
      `TARGET CUSTOMER: ${operator.targetCustomer || ""}`,
      "",
      `OFFER: ${operator.offer || ""}`,
      "",
      `RECURRING REVENUE: ${operator.recurringRevenuePlan || ""}`,
      "",
      "PRIORITIES",
      ...(operator.priorities || []).map(
        (item, index) => `${index + 1}. ${item.title}: ${item.reason}`
      ),
      "",
      "TASKS",
      ...operator.tasks.map(
        task => `- [ ] ${task.title}: ${task.description}`
      ),
      "",
      "NEXT ACTION",
      operator.nextAction || "Review the first task."
    ].join("\n");

    return res.status(200).json({
      success: true,
      text,
      plan: text,
      result: text,
      operator
    });
  } catch (error) {
    console.error("Soloco operator error:", error);

    return res.status(500).json({
      error: "An unexpected error occurred while building your business."
    });
  }
}
