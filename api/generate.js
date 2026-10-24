
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
      error: "Gemini is not configured. Add GEMINI_API_KEY to your deployment environment variables."
    });
  }

  try {
    const body = req.body || {};

    const business = String(
      body.business || body.idea || body.businessIdea || ""
    ).trim().slice(0, 2000);

    const skills = String(body.skills || "")
      .trim()
      .slice(0, 1500);

    const budget = String(body.budget || "$0").slice(0, 100);
    const goal = String(body.goal || "Build recurring income").slice(0, 200);

    if (!business) {
      return res.status(400).json({
        error: "Describe the business you want Soloco AI to build."
      });
    }

    const prompt = `
You are Soloco AI, a practical AI business operator.

Create a realistic, actionable business launch plan using the
user's idea, skills, budget, and objective.

USER BUSINESS IDEA:
${business}

USER SKILLS AND RESOURCES:
${skills || "Not provided"}

STARTUP BUDGET:
${budget}

MAIN OBJECTIVE:
${goal}

IMPORTANT RULES:
- Respect the user's stated budget.
- If the budget is $0, prioritize genuinely free tools and methods.
- Do not assume the user can pay for subscriptions, advertising,
  inventory, contractors, or API credits.
- Focus on a simple offer that can be tested with real customers.
- Explain how to obtain the first customer.
- Include a realistic recurring revenue strategy where appropriate.
- Never guarantee income, customers, or business success.
- Distinguish estimates and assumptions from verified facts.
- Do not claim you contacted anyone, published anything,
  spent money, or completed external actions.
- Make the plan specific to the user's idea, not generic filler.
- Return valid JSON only, with no Markdown fences or commentary.

Return one JSON object with exactly this overall structure:

{
  "businessName": "Short business name",
  "businessModel": "Explain how the business works and earns money",
  "targetCustomer": "Specific ideal customer",
  "offer": "The main product or service being sold",
  "pricingHypothesis": "Suggested starting price and why",
  "recurringRevenuePlan": "A practical repeat-payment strategy",
  "nextAction": "The single most important next step",
  "priorities": [
    {
      "title": "Priority",
      "reason": "Why it matters and what to do"
    }
  ],
  "tasks": [
    {
      "id": "task-1",
      "title": "Actionable task",
      "description": "Concrete steps to complete it",
      "actionType": "planning",
      "requiresApproval": false
    }
  ],
  "assets": [
    {
      "type": "sales",
      "title": "Asset title",
      "content": "A complete usable draft"
    }
  ],
  "approvalQueue": [
    {
      "id": "approval-1",
      "title": "Proposed action",
      "description": "What needs human review before execution",
      "status": "awaiting_approval"
    }
  ],
  "metrics": [
    {
      "name": "Metric name",
      "target": "Initial measurable target",
      "measurement": "How to measure it"
    }
  ],
  "assumptions": [
    "An assumption the user must verify"
  ]
}

CONTENT REQUIREMENTS:
- Provide 4 to 6 launch priorities.
- Provide 5 to 8 practical tasks in execution order.
- Use unique task IDs.
- Provide 3 to 5 business assets, such as a customer
  outreach message, service description, offer, or sales script.
- Make each asset's content useful and ready for review.
- Provide 2 to 4 approval items for actions that could affect
  customers, public content, money, or external accounts.
- Provide 3 to 5 measurable business metrics.
- Provide 3 to 5 assumptions to verify.
- Make the first action achievable with the stated resources.
- Keep every field a string except for the arrays and objects
  explicitly shown in the structure above.
- Return every required field even if some details are uncertain.
`;

    const model = "gemini-3.6-flash";
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    let lastError = "Gemini could not generate the business plan.";

    for (let attempt = 0; attempt < 3; attempt++) {
      let response;

      try {
        response = await fetch(endpoint, {
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
        });
      } catch (error) {
        lastError =
          "Could not connect to Gemini or the request timed out.";

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
        const providerMessage =
          data?.error?.message ||
          `Gemini returned HTTP ${response.status}.`;

        console.error("Gemini API error:", response.status, providerMessage);

        if (response.status === 429) {
          lastError =
            "Gemini rate limit or quota reached. Check your Google AI API quota and billing settings, then try again.";
        } else if (response.status === 503 || response.status === 502) {
          lastError =
            "Gemini is temporarily overloaded. Please try again shortly.";
        } else if (response.status === 504 || response.status === 408) {
          lastError =
            "Gemini took too long to respond. Please try again.";
        } else {
          lastError = `Gemini API error (${response.status}): ${providerMessage}`;
        }

        const temporary =
          response.status === 408 ||
          response.status === 429 ||
          response.status === 500 ||
          response.status === 502 ||
          response.status === 503 ||
          response.status === 504;

        if (temporary && attempt < 2) {
          await new Promise(resolve =>
            setTimeout(resolve, 1000 * (attempt + 1))
          );
          continue;
        }

        break;
      }

      const generatedText =
        data?.candidates?.[0]?.content?.parts
          ?.map(part => part.text || "")
          .join("")
          .trim();

      if (!generatedText) {
        lastError =
          "Gemini returned no business plan. The response may have been blocked or stopped early.";
        break;
      }

      let operator;

      try {
        const cleanedText = generatedText
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/, "")
          .trim();

        operator = JSON.parse(cleanedText);
      } catch {
        lastError =
          "Gemini returned invalid JSON. Please try generating the plan again.";
        break;
      }

      if (
        !operator ||
        typeof operator !== "object" ||
        Array.isArray(operator) ||
        typeof operator.businessName !== "string" ||
        typeof operator.businessModel !== "string" ||
        !Array.isArray(operator.priorities) ||
        !Array.isArray(operator.tasks) ||
        !Array.isArray(operator.assets)
      ) {
        lastError =
          "The generated plan was missing required dashboard fields. Please try again.";
        break;
      }

      const requiredArrays = [
        "priorities",
        "tasks",
        "assets",
        "approvalQueue",
        "metrics",
        "assumptions"
      ];

      for (const key of requiredArrays) {
        if (!Array.isArray(operator[key])) {
          operator[key] = [];
        }
      }

      // Normalize task IDs and fields expected by index.html.
      operator.tasks = operator.tasks.map((task, index) => ({
        id: String(task?.id || `task-${index + 1}`),
        title: String(task?.title || `Task ${index + 1}`),
        description: String(task?.description || ""),
        actionType: String(task?.actionType || "planning"),
        requiresApproval: task?.requiresApproval === true
      }));

      // Normalize the approval queue.
      operator.approvalQueue = operator.approvalQueue.map(
        (item, index) => ({
          id: String(item?.id || `approval-${index + 1}`),
          title: String(item?.title || `Approval ${index + 1}`),
          description: String(item?.description || ""),
          status: String(item?.status || "awaiting_approval")
        })
      );

      // Keep every dashboard field in the expected format.
      operator.priorities = operator.priorities.map(item => ({
        title: String(item?.title || "Launch priority"),
        reason: String(item?.reason || "")
      }));

      operator.assets = operator.assets.map(item => ({
        type: String(item?.type || "business asset"),
        title: String(item?.title || "Business asset"),
        content: String(item?.content || "")
      }));

      operator.metrics = operator.metrics.map(item => ({
        name: String(item?.name || "Business metric"),
        target: String(item?.target || "To be defined"),
        measurement: String(item?.measurement || "To be defined")
      }));

      operator.assumptions = operator.assumptions.map(item =>
        typeof item === "string" ? item : JSON.stringify(item)
      );

      // Return the exact property the existing frontend expects.
      return res.status(200).json({
        success: true,
        operator
      });
    }

    return res.status(502).json({
      error: lastError
    });

  } catch (error) {
    console.error("Soloco AI backend error:", error);

    return res.status(500).json({
      error: "An unexpected server error occurred. Check your deployment logs and try again."
    });
  }
}
