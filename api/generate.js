
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Use POST."
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("Gemini API key is missing.");
    return res.status(500).json({
      error: "GEMINI_API_KEY is missing in Vercel."
    });
  }

  try {
    const body = req.body || {};

    const idea = String(
      body.idea ??
      body.businessIdea ??
      body.prompt ??
      body.business ??
      ""
    ).trim();

    if (!idea) {
      return res.status(400).json({
        error: "Enter a business idea first."
      });
    }

    const prompt = `
You are Soloco AI, an expert business-building assistant.

Create a practical, detailed business plan for this idea:

${idea}

Include:
1. Business concept and target customers
2. Products or services and suggested prices
3. Startup costs and a low-budget launch plan
4. Marketing and customer acquisition
5. A step-by-step first 30-day action plan
6. Revenue opportunities and realistic risks

Use clear headings, specific actions, and realistic estimates.
Do not promise guaranteed profits.
`;

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
            {
              parts: [
                { text: prompt }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 4096
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error(
        "Gemini API error:",
        response.status,
        data.error?.message || "Unknown error"
      );

      return res.status(502).json({
        error:
          data.error?.message ||
          `Gemini returned HTTP ${response.status}.`
      });
    }

    const text = (data.candidates?.[0]?.content?.parts || [])
      .map(part => part.text || "")
      .join("\n")
      .trim();

    if (!text) {
      return res.status(502).json({
        error:
          "Gemini returned no text. Check the API response and safety settings."
      });
    }

    return res.status(200).json({
      text,
      plan: text,
      result: text
    });

  } catch (error) {
    console.error("Soloco AI generation failed:", error.message);

    return res.status(500).json({
      error: "The business plan could not be generated. Please try again."
    });
  }
}
