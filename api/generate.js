
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY is missing in Vercel."
    });
  }

  const { business, skills, budget, goal } = req.body || {};

  if (
    typeof business !== "string" ||
    typeof skills !== "string" ||
    !business.trim() ||
    !skills.trim()
  ) {
    return res.status(400).json({
      error: "Enter your business idea and skills."
    });
  }

  if (business.length > 500 || skills.length > 500) {
    return res.status(400).json({
      error: "Keep each answer under 500 characters."
    });
  }

  const prompt = `
Create a specific business operating plan for:
Business: ${business.trim()}
Skills: ${skills.trim()}
Budget: ${String(budget || "unspecified").slice(0, 100)}
Goal: ${String(goal || "unspecified").slice(0, 200)}

Include:
1. Business model and paying customers.
2. Specific offer and realistic pricing.
3. Customer acquisition and marketing.
4. Three ready-to-use marketing messages.
5. Sales scripts and follow-up.
6. Daily operations.
7. A prioritized 30-day action plan.
8. Startup costs and revenue scenarios with assumptions.
9. Automation opportunities and required integrations.
10. The single most important next action.

Be practical and specific. Respect the budget.
Never guarantee revenue or claim actions were performed.
Return a detailed plain-text plan.
`;

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 5000
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini HTTP status:", response.status);
      return res.status(response.status === 429 ? 429 : 502).json({
        error: response.status === 429
          ? "Gemini usage limit reached. Try later."
          : "Gemini request failed. Check API access and model availability."
      });
    }

    const plan = data.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("\n")
      .trim();

    if (!plan) {
      return res.status(502).json({
        error: "Gemini returned no business plan."
      });
    }

    return res.status(200).json({ plan });
  } catch {
    return res.status(500).json({
      error: "Could not contact Gemini. Please try again."
    });
  }
}
