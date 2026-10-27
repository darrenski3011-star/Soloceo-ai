
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      success: false,
      error: "Send a POST request to build a business."
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      success: false,
      error: "Missing GEMINI_API_KEY. Add it to your deployment environment variables."
    });
  }

  try {
    const body = req.body || {};

    const business = String(
      body.business || body.idea || body.businessIdea || ""
    ).trim().slice(0, 2000);

    const skills = String(body.skills || "")
      .trim().slice(0, 1500);

    const budget = String(body.budget || "$0")
      .trim().slice(0, 100);

    const goal = String(body.goal || "Build recurring income")
      .trim().slice(0, 200);

    if (!business) {
      return res.status(400).json({
        success: false,
        error: "Describe the business you want Soloco AI to build."
      });
    }

    const prompt = `
You are Soloco AI, a practical AI business operator.

Create a specific, realistic business launch plan.

BUSINESS IDEA:
${business}

SKILLS AND RESOURCES:
${skills || "Not provided"}

STARTUP BUDGET:
${budget}

MAIN GOAL:
${goal}

RULES:
- Respect the stated budget.
- For a $0 budget, prioritize genuinely free methods.
- Do not assume paid tools, advertising, inventory, or contractors.
- Explain how to get the first paying customer.
- Include recurring revenue where appropriate.
- Never guarantee income or success.
- Separate estimates from verified facts.
- Never claim you performed external actions.
- Make the plan specific to this business.
- All assets must be complete drafts ready for review.
- External actions involving customers, public posts, money,
  or accounts require human approval.
- Return valid JSON only.

Return an object with exactly these fields:
{
  "businessName": "string",
  "businessModel": "string",
  "targetCustomer": "string",
  "offer": "string",
  "pricingHypothesis": "string",
  "recurringRevenuePlan": "string",
  "nextAction": "string",
  "priorities": [
    { "title": "string", "reason": "string" }
  ],
  "tasks": [
    {
      "id": "task-1",
      "title": "string",
      "description": "string",
      "actionType": "planning",
      "requiresApproval": false
    }
  ],
  "assets": [
    {
      "type": "sales",
      "title": "string",
      "content": "string"
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
  "assumptions": ["string"]
}

REQUIREMENTS:
- 4 to 6 priorities.
- 5 to 8 tasks in execution order.
- Unique task IDs.
- 3 to 5 useful business assets.
- 2 to 4 approval items.
- 3 to 5 measurable metrics.
- 3 to 5 assumptions.
- Make the first action achievable with the available resources.
- Return all fields, using strings and arrays as specified.
`;

    const model = "gemini-3.8-flash";

    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    let lastError = "Unable to generate your business plan.";

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(endpoint, {
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
              temperature: 0.3,
              responseMimeType: "application/json",
              maxOutputTokens: 4000
            }
          }),
          signal: AbortSignal.timeout(22000)
        });

        const responseText = await response.text();

        let data;

        try {
          data = JSON.parse(responseText);
        } catch {
          lastError = "Gemini returned an unreadable response.";

          if (attempt < 2) continue;
          break;
        }

        if (!response.ok) {
          const status = response.status;
          const message = data?.error?.message || "Unknown API error.";

          console.error("Gemini API error:", status, message);

          if (status === 429) {
            lastError =
              "Gemini quota or rate limit reached. Check your API quota and billing.";
          } else if (status === 401 || status === 403) {
            lastError =
              "Gemini rejected the API key or access. Check your key and API permissions.";
          } else if (status === 400) {
            lastError = `Gemini rejected the request: ${message}`;
          } else if (
  status === 408 ||
  status === 500 ||
  status === 502 ||
  status === 503 ||
  status === 504
) {
  lastError = `Gemini server error (${status}): ${message}`;
}
            lastError = "Gemini is temporarily unavailable. Try again shortly.";
          } else {
            lastError = `Gemini API error (${status}): ${message}`;
          }

          const retryable = [
            408, 429, 500, 502, 503, 504
          ].includes(status);

          if (retryable && attempt < 2) {
            await new Promise(resolve =>
              setTimeout(resolve, 1000 * (attempt + 1))
            );
            continue;
          }

          break;
        }

        const candidate = data?.candidates?.[0];

        const generatedText = candidate?.content?.parts
          ?.map(part => part.text || "")
          .join("")
          .trim();

        if (!generatedText) {
          lastError =
            "Gemini returned no plan. Check the model response and try again.";
          break;
        }

        let operator;

        try {
          const cleaned = generatedText
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();

          operator = JSON.parse(cleaned);
        } catch {
          lastError =
            "Gemini returned invalid JSON. Please try generating the plan again.";

          if (attempt < 2) continue;
          break;
        }

        if (
          !operator ||
          typeof operator !== "object" ||
          Array.isArray(operator)
        ) {
          lastError = "Gemini returned an invalid business plan.";
          break;
        }

        const stringFields = [
          "businessName",
          "businessModel",
          "targetCustomer",
          "offer",
          "pricingHypothesis",
          "recurringRevenuePlan",
          "nextAction"
        ];

        for (const field of stringFields) {
          if (typeof operator[field] !== "string") {
            operator[field] = "";
          }
        }

        const arrayFields = [
          "priorities",
          "tasks",
          "assets",
          "approvalQueue",
          "metrics",
          "assumptions"
        ];

        for (const field of arrayFields) {
          if (!Array.isArray(operator[field])) {
            operator[field] = [];
          }
        }

        operator.priorities = operator.priorities.map(item => ({
          title: String(item?.title || "Launch priority"),
          reason: String(item?.reason || "")
        }));

        operator.tasks = operator.tasks.map((task, index) => ({
          id: `task-${index + 1}`,
          title: String(task?.title || `Task ${index + 1}`),
          description: String(task?.description || ""),
          actionType: String(task?.actionType || "planning"),
          requiresApproval: task?.requiresApproval === true
        }));

        operator.assets = operator.assets.map(item => ({
          type: String(item?.type || "sales"),
          title: String(item?.title || "Business asset"),
          content: String(item?.content || "")
        }));

        operator.approvalQueue = operator.approvalQueue.map(
          (item, index) => ({
            id: `approval-${index + 1}`,
            title: String(item?.title || "Review proposed action"),
            description: String(item?.description || ""),
            status: "awaiting_approval"
          })
        );

        operator.metrics = operator.metrics.map(item => ({
          name: String(item?.name || "Business metric"),
          target: String(item?.target || "To be defined"),
          measurement: String(item?.measurement || "To be defined")
        }));

        operator.assumptions = operator.assumptions.map(item =>
          typeof item === "string" ? item : JSON.stringify(item)
        );

        return res.status(200).json({
          success: true,
          operator
        });

      } catch (error) {
        console.error("Soloco AI request failed:", error);

        lastError = error?.name === "TimeoutError"
          ? "Gemini timed out. Please try again."
          : "Could not connect to Gemini. Check your deployment and try again.";

        if (attempt < 2) {
          await new Promise(resolve =>
            setTimeout(resolve, 1000 * (attempt + 1))
          );
          continue;
        }
      }
    }

    return res.status(502).json({
      success: false,
      error: lastError
    });

  } catch (error) {
    console.error("Soloco AI backend error:", error);

    return res.status(500).json({
      success: false,
      error: "Unexpected server error. Check your deployment logs."
    });
  }
}
