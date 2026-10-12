
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Use POST to generate a business strategy."
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("GEMINI_API_KEY is missing.");
    return res.status(500).json({
      error: "The AI service is not configured. Check GEMINI_API_KEY in Vercel."
    });
  }

  try {
    const body = req.body || {};

    const business = String(
      body.business ?? body.idea ?? body.businessIdea ?? ""
    ).trim().slice(0, 2000);

    const skills = String(body.skills ?? "")
      .trim()
      .slice(0, 1500);

    const budget = String(body.budget ?? "0").trim().slice(0, 100);

    const goal = String(body.goal ?? "long-term income")
      .trim()
      .slice(0, 200);

    if (!business) {
      return res.status(400).json({
        error: "Describe the business you want to build."
      });
    }

    const prompt = `
You are Soloco AI, a practical AI business-building assistant.

MISSION:
Help the user turn their business idea into a realistic, actionable
business they can start and grow. Focus on concrete work, not hype.

USER INFORMATION
Business idea: ${business}
Skills and experience: ${skills || "Not specified"}
Available startup budget: ${budget}
Main goal: ${goal}

REQUIREMENTS:
1. Start with actions that cost $0 wherever possible.
2. Never assume the user has money, customers, a website, or special tools.
3. Prefer free tools, simple services, and ways to get the first paying customer.
4. Give specific actions, not vague advice.
5. Prioritize the first 3 actions the user should take today.
6. Include a seven-day launch plan.
7. Include a realistic first-customer strategy.
8. Write one example marketing message the user can use.
9. Identify likely costs, risks, and how to avoid unnecessary spending.
10. Explain what must be validated before investing money.
11. Do not promise income or guaranteed results.
12. Never claim you created an account, contacted a customer, published
    an advertisement, accepted payment, or completed an external action
    unless that action was actually performed by an authorized tool.
13. Do not request passwords, API keys, or payment credentials.
14. Require the user's explicit approval before spending money,
    contacting people, publishing content, or making commitments.
15. If information is missing, state reasonable assumptions and proceed.

Return a useful, clearly formatted response with these headings:

BUSINESS DIRECTION
THE FIRST 3 ACTIONS
YOUR 7-DAY LAUNCH PLAN
HOW TO FIND YOUR FIRST CUSTOMER
READY-TO-USE MARKETING MESSAGE
FREE TOOLS TO USE
COSTS AND RISKS
NEXT STEP

Keep the plan realistic, direct, and tailored to the user's information.
`;

    const models = ["gemini-3.8-flash"];
    let lastError = "The AI service could not complete the request.";

    for (const model of models) {
      for (let attempt = 0; attempt < 3; attempt++) {
        let response;

        try {
          response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
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
                  temperature: 0.6,
                  maxOutputTokens: 4096
                }
              }),
              signal: AbortSignal.timeout(55000)
            }
          );
        } catch (error) {
          lastError =
            error.name === "TimeoutError" ||
            error.name === "AbortError"
              ? "The AI request timed out. Please try again."
              : "Could not connect to the AI service.";

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
          data = {};
        }

        if (!response.ok) {
          const message =
            data?.error?.message ||
            `The AI service returned HTTP ${response.status}.`;

          console.error("Gemini API error:", response.status, message);
          lastError = message;

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

        const text = (data?.candidates?.[0]?.content?.parts || [])
          .map(part => part.text || "")
          .join("\n")
          .trim();

        if (!text) {
          lastError =
            data?.promptFeedback?.blockReason
              ? "The request was blocked. Please revise your business idea."
              : "The AI returned an empty response. Please try again.";

          break;
        }

        return res.status(200).json({
          success: true,
          text,
          plan: text,
          result: text
        });
      }
    }

    return res.status(502).json({
      error: `Soloco AI couldn't generate a response. ${lastError}`
    });
  } catch (error) {
    console.error("Soloco AI server error:", error);

    return res.status(500).json({
      error: "An unexpected server error occurred. Please try again."
    });
  }
}
