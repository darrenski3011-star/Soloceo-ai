
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("Gemini configuration: API key missing.");
    return res.status(500).json({
      error: "Gemini is not configured in Vercel."
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
Create a specific business operating plan.

Business: ${business.trim()}
Skills: ${skills.trim()}
Budget: ${String(budget || "unspecified").slice(0, 100)}
Goal: ${String(goal || "unspecified").slice(0, 200)}

Include:
1. Business model and paying customers.
2. A specific offer and realistic pricing.
3. Customer acquisition and marketing.
4. Three ready-to-use marketing messages.
5. Sales scripts and follow-up.
6. Daily operations.
7. A prioritized 30-day action plan.
8. Startup costs and revenue scenarios with assumptions.
9. Automation opportunities and required integrations.
10. The single most important next action.

Respect the budget. Do not guarantee revenue or claim
that actions were performed when they were not.
Return a detailed, practical plain-text plan.
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
          contents: [
            { parts: [{ text: prompt }] }
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 5000
          }
        }),
        signal: AbortSignal.timeout(50000)
      }
    );

    const raw = await response.text();

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = {};
    }

    if (!response.ok) {
      const googleMessage =
        data?.error?.message || "No error details returned.";

      // Diagnostic only. Never log the API key.
      console.error("Gemini API failure:", {
        status: response.status,
        message: googleMessage
      });

      if (response.status === 429) {
        return res.status(429).json({
          error: "Gemini usage limit reached. Try again later."
        });
      }

      if (response.status === 404) {
        return res.status(502).json({
          error:
            "Gemini could not find the requested resource. " +
            "Check the model name and the Vercel function logs."
        });
      }

      return res.status(502).json({
        error:
          "Gemini returned an error. Check the Vercel function logs."
      });
    }

    const plan = data?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("\n")
      .trim();

    if (!plan) {
      console.error("Gemini returned no usable plan.", {
        blockReason: data?.promptFeedback?.blockReason,
        finishReason: data?.candidates?.[0]?.finishReason
      });

      return res.status(502).json({
        error:
          "Gemini returned no usable plan. Try a different request."
      });
    }

    return res.status(200).json({ plan });

  } catch (error) {
    console.error("Gemini connection failure:", {
      name: error?.name,
      message: error?.message
    });

    return res.status(502).json({
      error:
        error?.name === "TimeoutError" ||
        error?.name === "AbortError"
          ? "Gemini took too long to respond. Try again."
          : "Could not contact Gemini. Check the Vercel logs."
    });
  }
}
