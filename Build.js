q
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      success: false,
      error: "Use a POST request to build your business."
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("Missing GEMINI_API_KEY environment variable.");
    return res.status(500).json({
      success: false,
      error: "Gemini API key is missing. Add GEMINI_API_KEY in Vercel Project Settings → Environment Variables, then redeploy."
    });
  }

  const body = req.body || {};
  const business = String(body.business || body.idea || body.businessIdea || "").trim();
  const skills = String(body.skills || "").trim();
  const budget = String(body.budget || "$0").trim();
  const goal = String(body.goal || "Get first paying customer").trim();

  if (!business) {
    return res.status(400).json({
      success: false,
      error: "Describe the business you want to build."
    });
  }

  if (business.length > 2000 || skills.length > 1500) {
    return res.status(400).json({
      success: false,
      error: "Your business description or skills section is too long."
    });
  }

  const prompt = `
You are Soloco AI, a practical business-building operator.

Create a realistic, actionable business plan using the user's information.
Respect their budget. If the budget is $0, prioritize free tools, direct
outreach, and services they can sell before spending money. Do not promise
guaranteed income. Clearly label estimates and assumptions.

USER'S BUSINESS:
${business}

USER'S SKILLS AND RESOURCES:
${skills || "Not provided"}

STARTUP BUDGET:
${budget}

MAIN OBJECTIVE:
${goal}

Return ONLY a valid JSON object with exactly these fields and this structure:

{
  "businessName": "Short business name",
  "businessModel": "How the business works and earns revenue",
  "targetCustomer": "Specific likely customer",
  "offer": "The first product or service to sell",
  "pricingHypothesis": "Suggested starting price and why; label as a hypothesis",
  "recurringRevenuePlan": "Practical way to earn repeat revenue",
  "nextAction": "One specific action the user can take today",
  "priorities": [
    {
      "title": "Priority",
      "reason": "Why this matters"
    }
  ],
  "tasks": [
    {
      "id": "task-1",
      "title": "Actionable task",
      "description": "Clear steps to complete it",
      "actionType": "research, writing, sales, setup, or planning",
      "requiresApproval": false
    }
  ],
  "assets": [
    {
      "type": "sales message, offer, landing page copy, or other asset",
      "title": "Asset title",
      "content": "Complete usable draft"
    }
  ],
  "approvalQueue": [
    {
      "id": "approval-1",
      "title": "Action requiring review",
      "description": "What needs human review",
      "status": "awaiting_approval"
    }
  ],
  "metrics": [
    {
      "name": "Metric",
      "target": "Realistic initial target",
      "measurement": "How to measure it"
    }
  ],
  "assumptions": [
    "An assumption the user should verify"
  ]
}

Include 3 to 5 priorities, 5 to 8 tasks, 3 to 5 useful assets,
2 to 4 approval items, 3 to 5 metrics, and 2 to 4 assumptions.
Make the assets complete and useful, not just descriptions of what to write.
Do not claim that you have contacted customers, created accounts, published
anything, or completed external actions.
`;

  const model = "gemini-3.6-flash";
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  let geminiResponse;

  try {
    geminiResponse = await fetch(endpoint, {
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
          responseMimeType: "application/json",
          temperature: 0.4,
          maxOutputTokens: 8192
        }
      })
    });
  } catch (error) {
    console.error("Gemini network request failed:", error.message);
    return res.status(502).json({
      success: false,
      error: "Could not connect to Gemini. Please try again shortly."
    });
  }

  let result;

  try {
    result = await geminiResponse.json();
  } catch {
    console.error("Gemini returned a non-JSON response.");
    return res.status(502).json({
      success: false,
      error: "Gemini returned an unreadable response. Please try again."
    });
  }

  if (!geminiResponse.ok) {
    const providerMessage =
  typeof result?.error?.message === "string"
    ? result.error.message
    : JSON.stringify(result?.error || result);
    // Log the provider error, but never log the API key.
    console.error(
      "Gemini API error:",
      geminiResponse.status,
      providerMessage
    );

    if (geminiResponse.status === 400) {
      return res.status(502).json({
        success: false,
        error: `Gemini rejected the request: ${providerMessage}`
      });
    }

    if (geminiResponse.status === 401 || geminiResponse.status === 403) {
      return res.status(502).json({
        success: false,
        error: "Gemini rejected the API key or denied API access. Check your GEMINI_API_KEY and Google AI API access in Vercel."
      });
    }

    if (geminiResponse.status === 429) {
      return res.status(503).json({
        success: false,
        error: "Gemini quota or rate limit reached. Check your Google AI usage limits and billing, then try again."
      });
    }

    if (
      geminiResponse.status === 500 ||
      geminiResponse.status === 502 ||
      geminiResponse.status === 503 ||
      geminiResponse.status === 504
    ) {
      return res.status(503).json({
        success: false,
        error: "Gemini is temporarily unavailable. Try again shortly. Check Vercel Runtime Logs for the exact Gemini API error."
      });
    }

    return res.status(502).json({
      success: false,
      error: `Gemini API request failed with status ${geminiResponse.status}: ${providerMessage}`
    });
  }

  const parts = result?.candidates?.[0]?.content?.parts || [];
  const generatedText = parts
    .map(part => part.text || "")
    .join("")
    .trim();

  if (!generatedText) {
    const reason = result?.promptFeedback?.blockReason;
    console.error("Gemini returned no text. Block reason:", reason || "unknown");

    return res.status(502).json({
      success: false,
      error: reason
        ? `Gemini blocked this request: ${reason}. Try a different business description.`
        : "Gemini returned an empty response. Please try again."
    });
  }

  let operator;

  try {
    const cleanedText = generatedText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    operator = JSON.parse(cleanedText);
  } catch (error) {
    console.error("Could not parse Gemini JSON:", error.message);
    console.error("Gemini output preview:", generatedText.slice(0, 500));

    return res.status(502).json({
      success: false,
      error: "Gemini responded, but the business plan was not valid JSON. Please try again."
    });
  }

  if (
    !operator ||
    typeof operator !== "object" ||
    Array.isArray(operator) ||
    typeof operator.businessName !== "string"
  ) {
    console.error("Gemini returned an unexpected business plan structure.");

    return res.status(502).json({
      success: false,
      error: "Gemini returned an incomplete business plan. Please try again."
    });
  }

  return res.status(200).json({
    success: true,
    operator
  });
}
