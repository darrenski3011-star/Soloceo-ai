export default async function handler(req, res) {
if (req.method !== "POST") {
res.setHeader("Allow", "POST");
return res.status(405).json({
error: "Use POST."
});
}

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
console.error("GEMINI_API_KEY is missing.");
return res.status(500).json({
error: "AI is not configured. Add GEMINI_API_KEY in Vercel."
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
error: "Keep your business idea and skills under 500 characters each."
});
}

const prompt = `
You are Soloco AI, an expert business-building assistant.

Create a detailed, realistic, step-by-step business plan using the information below.

BUSINESS IDEA:
${business.trim()}

USER SKILLS:
${skills.trim()}

STARTUP BUDGET:
${String(budget || "As close to $0 as possible").slice(0, 100)}

PRIMARY GOAL:
${String(goal || "Build a profitable, sustainable business").slice(0, 200)}

YOUR MISSION:
Help this user turn their idea into an operating business.

IMPORTANT RULES:

- Respect the user's actual budget.
- Prioritize free tools and methods when money is limited.
- Never assume the user has money to spend on advertising.
- Recommend specific tools, platforms, and practical actions.
- Explain technical steps in plain English.
- Do not promise profits or guaranteed results.
- Clearly label estimates and assumptions.
- Never claim that you created accounts, launched websites,
  contacted customers, or performed actions you did not perform.
- Focus on getting the first paying customer as quickly and
  realistically as possible.

FORMAT THE PLAN WITH THESE SECTIONS:

1. BUSINESS OVERVIEW
   Explain the business, the problem it solves, and why customers
   might pay for it.

2. PRODUCTS AND SERVICES
   Recommend the best initial offer, what it includes, and realistic
   pricing options.

3. IDEAL CUSTOMERS
   Identify specific customer types and where to find them.

4. STARTUP COSTS
   Break down necessary expenses. Separate free options from paid
   upgrades. Stay within the stated budget.

5. TOOLS AND TECHNOLOGY
   Recommend specific tools, including free options, and explain
   exactly what each one does.

6. FIRST CUSTOMER STRATEGY
   Give a practical step-by-step method for finding the first paying
   customer without relying on paid advertising.

7. READY-TO-USE MARKETING
   Write three complete marketing messages the user can copy and use.

8. SALES SCRIPT
   Provide a natural sales conversation, responses to common
   objections, and a follow-up message.

9. DAILY OPERATIONS
   Explain the daily tasks required to run the business.

10. AUTOMATION
    Identify tasks that can be automated, the tools required, and any
    costs or technical limitations.

11. 30-DAY ACTION PLAN
    Break the plan into weekly milestones and specific daily actions
    where useful.

12. FINANCIAL SCENARIOS
    Show conservative, moderate, and optimistic revenue examples
    based on explicit assumptions. Account for expenses and distinguish
    revenue from profit. Do not present projections as guarantees.

13. GROWTH PLAN
    Explain how to reinvest initial earnings and expand gradually.

14. NEXT ACTION
    Finish with the single most important action the user should take
    today.

Make the result specific, useful, organized, and actionable.
Avoid generic motivational filler.
Return the complete plan as plain text with clear headings.
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
{
role: "user",
parts: [{ text: prompt }]
}
],
generationConfig: {
temperature: 0.7,
maxOutputTokens: 6000
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
  console.error("Gemini returned invalid JSON.");
  return res.status(502).json({
    error: "The AI service returned an invalid response. Try again."
  });
}

if (!response.ok) {
  const status = response.status;
  const message =
    data?.error?.message || "Unknown Gemini API error.";

  console.error("Gemini API error:", {
    status,
    message
  });

  if (status === 400) {
    return res.status(502).json({
      error: "Gemini rejected the request. Check the API configuration."
    });
  }

  if (status === 401 || status === 403) {
    return res.status(502).json({
      error: "Gemini API authentication failed. Check your API key and permissions."
    });
  }

  if (status === 404) {
    return res.status(502).json({
      error: "The Gemini model endpoint was not found. Check the model name and API access."
    });
  }

  if (status === 429) {
    return res.status(429).json({
      error: "The AI usage limit has been reached. Try again later."
    });
  }

  return res.status(502).json({
    error: "The AI service encountered an error. Try again shortly."
  });
}

const candidate = data?.candidates?.[0];

const plan = candidate?.content?.parts
  ?.map(part => part.text || "")
  .join("\n")
  .trim();

if (!plan) {
  console.error("Gemini returned no plan:", {
    blockReason: data?.promptFeedback?.blockReason,
    finishReason: candidate?.finishReason
  });

  return res.status(502).json({
    error: "The AI could not generate a business plan. Try again."
  });
}

return res.status(200).json({
  plan,
  success: true
});

} catch (error) {
console.error("Gemini connection error:", {
name: error?.name,
message: error?.message
});

if (
  error?.name === "TimeoutError" ||
  error?.name === "AbortError"
) {
  return res.status(504).json({
    error: "The AI took too long to respond. Please try again."
  });
}

return res.status(502).json({
  error: "Could not connect to the AI service. Check your connection and try again."
});

}
  }
