
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
      error: "GEMINI_API_KEY is missing from Vercel Environment Variables."
    });
  }

  try {
    const body = req.body || {};

    const business = String(
      body.business || body.idea || body.businessIdea || ""
    ).trim().slice(0, 1500);

    const skills = String(body.skills || "")
      .trim()
      .slice(0, 800);

    const budget = String(body.budget || "$0").slice(0, 100);
    const goal = String(
      body.goal || "Build recurring income"
    ).slice(0, 200);

    if (!business) {
      return res.status(400).json({
        success: false,
        error: "Enter a business idea first."
      });
    }

    const prompt = `
You are Soloco AI, an AI business operator.

Create a practical business launch and operating blueprint.
The user's budget is ${budget}.
Business idea: ${business}
Skills: ${skills || "Not specified"}
Goal: ${goal}

Important:
- Start with actions possible at zero cost.
- Never claim you performed an action you did not perform.
- Do not invent customers, sales, revenue, or completed work.
- Require approval before spending money, publishing content,
  contacting people, or making commitments.
- Focus on a realistic offer and recurring revenue.
- Keep the response concise and specific.
- Return ONLY valid JSON, with no markdown fences.

Use this exact JSON structure:
{
  "businessName": "string",
  "businessModel": "string",
  "targetCustomer": "string",
  "offer": "string",
  "pricingHypothesis": "string",
  "recurringRevenuePlan": "string",
  "nextAction": "string",
  "priorities": ["string"],
  "tasks": [
    {
      "title": "string",
      "description": "string",
      "status": "pending"
    }
  ],
  "assets": [
    {
      "title": "string",
      "content": "string"
    }
  ],
  "approvalQueue": [],
  "metrics": [
    {
      "name": "string",
      "value": "Not measured yet"
    }
  ],
  "assumptions": ["string"]
}

Limit tasks to 5, assets to 3, priorities to 3.
Do not state that any external action has been completed.
`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 50000);

    let response;

    try {
      response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent"
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
              maxOutputTokens: 2500,
              responseMimeType: "application/json"
            }
          }),
          signal: controller.signal
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    const raw = await response.text();
    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      data = {};
    }

    if (!response.ok) {
      const apiMessage =
        data?.error?.message || raw.slice(0, 500) ||
        "No details supplied by Gemini.";

      let message;

      if (response.status === 429) {
        message = "Gemini quota or rate limit reached. Check your API usage and billing.";
      } else if (
        response.status === 401 ||
        response.status === 403
      ) {
        message = "Gemini rejected the API key. Check GEMINI_API_KEY and its permissions.";
      } else if (response.status === 400) {
        message = "Gemini rejected the request: " + apiMessage;
      } else {
        message = "Gemini API error (" +
          response.status + "): " + apiMessage;
      }

      return res.status(502).json({
        success: false,
        error: message
      });
    }

    const candidate = data?.candidates?.[0];
    const text = candidate?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

    if (!text) {
      return res.status(502).json({
        success: false,
        error: "Gemini returned no text. Try again with a shorter business idea."
      });
    }

    let operator;

    try {
      operator = JSON.parse(text);
    } catch {
      const cleaned = text
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();

      try {
        operator = JSON.parse(cleaned);
      } catch {
        return res.status(502).json({
          success: false,
          error: "Gemini responded, but its result was not valid JSON. Please try again."
        });
      }
    }

    if (
      !operator ||
      typeof operator !== "object" ||
      Array.isArray(operator)
    ) {
      return res.status(502).json({
        success: false,
        error: "Gemini returned an unexpected response format."
      });
    }

    operator.priorities = Array.isArray(operator.priorities)
      ? operator.priorities : [];
    operator.tasks = Array.isArray(operator.tasks)
      ? operator.tasks : [];
    operator.assets = Array.isArray(operator.assets)
      ? operator.assets : [];
    operator.approvalQueue = Array.isArray(operator.approvalQueue)
      ? operator.approvalQueue : [];
    operator.metrics = Array.isArray(operator.metrics)
      ? operator.metrics : [];
    operator.assumptions = Array.isArray(operator.assumptions)
      ? operator.assumptions : [];

    return res.status(200).json({
      success: true,
      operator
    });

  } catch (error) {
    console.error("Soloco build error:", error);

    if (error?.name === "AbortError") {
      return res.status(504).json({
        success: false,
        error: "Gemini took too long to respond. Vercel may be ending the request early. Check the function timeout and deployment logs."
      });
    }

    return res.status(500).json({
      success: false,
      error: "Backend error: " +
        (error?.message || "Unknown server error")
    });
  }
}
