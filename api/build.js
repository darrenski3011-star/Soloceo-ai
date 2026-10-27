
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      success: false,
      error: "Use a POST request."
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      success: false,
      error: "GEMINI_API_KEY is missing in Vercel Environment Variables."
    });
  }

  try {
    const body = req.body || {};

    const business = String(
      body.business || body.idea || body.businessIdea || ""
    ).trim().slice(0, 1500);

    const skills = String(body.skills || "").trim().slice(0, 800);
    const budget = String(body.budget || "$0").slice(0, 100);
    const goal = String(
      body.goal || "Build recurring income"
    ).slice(0, 200);

    if (!business) {
      return res.status(400).json({
        success: false,
        error: "Please enter a business idea."
      });
    }

    const prompt = `
You are Soloco AI, an AI business operator.

Build a practical business launch blueprint.

Business idea: ${business}
Skills: ${skills || "Not specified"}
Budget: ${budget}
Goal: ${goal}

Rules:
- Prioritize free tools and actions.
- Focus on a real offer and recurring income.
- Never invent customers, sales, or revenue.
- Do not claim to have performed external actions.
- Require approval before spending money, publishing,
  contacting people, or making commitments.
- Keep the response concise.
- Return only valid JSON, without markdown.

Use these fields:
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

Limit priorities to 3, tasks to 5, and assets to 3.
`;

    const model = "gemini-flash-latest";
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      model +
      ":generateContent";

    let lastError = "Gemini did not return a response.";

    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        45000
      );

      let response;
      let raw = "";

      try {
        response = await fetch(url, {
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
              maxOutputTokens: 2200,
              responseMimeType: "application/json"
            }
          }),
          signal: controller.signal
        });

        raw = await response.text();
      } catch (error) {
        lastError =
          error.name === "AbortError"
            ? "Gemini request timed out."
            : "Network error: " + error.message;

        if (attempt === 0) {
          await new Promise(resolve => setTimeout(resolve, 1200));
          continue;
        }

        return res.status(502).json({
          success: false,
          error: lastError
        });
      } finally {
        clearTimeout(timer);
      }

      let data = {};

      try {
        data = JSON.parse(raw);
      } catch {
        data = {};
      }

      if (!response.ok) {
        const message =
          data?.error?.message || raw.slice(0, 300);

        lastError =
          "Gemini API error (" +
          response.status +
          "): " +
          message;

        const retryable = [
          429, 500, 502, 503, 504
        ].includes(response.status);

        if (retryable && attempt === 0) {
          await new Promise(resolve => setTimeout(resolve, 1200));
          continue;
        }

        return res.status(502).json({
          success: false,
          error: lastError
        });
      }

      const text = data?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();

      if (!text) {
        lastError =
          "Gemini returned an empty response. Try again.";

        if (attempt === 0) {
          await new Promise(resolve => setTimeout(resolve, 1200));
          continue;
        }

        return res.status(502).json({
          success: false,
          error: lastError
        });
      }

      let operator;

      try {
        operator = JSON.parse(text);
      } catch {
        return res.status(502).json({
          success: false,
          error: "Gemini returned invalid JSON. Please try again."
        });
      }

      if (
        !operator ||
        typeof operator !== "object" ||
        Array.isArray(operator)
      ) {
        return res.status(502).json({
          success: false,
          error: "Gemini returned an unexpected response."
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
    }

    return res.status(502).json({
      success: false,
      error: lastError
    });
  } catch (error) {
    console.error("Soloco AI backend error:", error);

    return res.status(500).json({
      success: false,
      error: "Backend error: " +
        (error.message || "Unknown error")
    });
  }
}
