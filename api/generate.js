
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("GEMINI_API_KEY is unavailable.");
    return res.status(500).json({
      error: "API key unavailable. Check Vercel environment settings."
    });
  }

  try {
    const body = req.body || {};

    const business = String(
      body.business ?? body.idea ?? body.businessIdea ?? ""
    ).trim();

    const skills = String(body.skills ?? "").trim();
    const budget = String(body.budget ?? "0").trim();
    const goal = String(
      body.goal ?? body.prompt ?? ""
    ).trim();

    if (!business && !goal) {
      return res.status(400).json({
        error: "Describe the business you want to operate."
      });
    }

    const prompt = `
You are Soloco AI, an AI business operations assistant.

BUSINESS: ${business || "Suggest a simple online business"}
SKILLS: ${skills || "Not specified"}
STARTUP BUDGET: $${budget}
GOAL: ${goal || "Start and operate with minimal manual work"}

Help BUILD and OPERATE this business, not just plan it.

Return ONLY valid JSON in this format:
{
  "summary": "Short current objective",
  "priorities": [
    {"title": "Task", "reason": "Why it matters"}
  ],
  "tasks": [
    {
      "id": "task-1",
      "title": "Specific action",
      "description": "Useful instructions or draft",
      "category": "marketing",
      "status": "pending",
      "approval_required": false
    }
  ],
  "drafts": [
    {
      "type": "social_post",
      "title": "Draft title",
      "content": "Usable content"
    }
  ],
  "approvals": [
    {
      "action": "Proposed external action",
      "reason": "Why approval is needed",
      "estimated_cost": 0
    }
  ],
  "metrics": ["Metric to track"]
}

RULES:
- Start with actions costing $0.
- Automatically prepare drafts, research, checklists, and priorities.
- Never claim an external action has already happened.
- Never spend money, publish, send messages, place orders,
  or make commitments without explicit user approval.
- External actions must be marked as requiring approval.
- Do not promise income or guaranteed results.
- Maximum 5 priorities, 8 tasks, 3 drafts, 5 approvals.
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
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
            responseMimeType: "application/json",
            maxOutputTokens: 8192
          }
        }),
        signal: AbortSignal.timeout(55000)
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("Gemini API error:", response.status, data);
      return res.status(502).json({
        error: data?.error?.message ||
          `Gemini returned HTTP ${response.status}.`
      });
    }

    const raw = (data.candidates?.[0]?.content?.parts || [])
      .map(part => part.text || "")
      .join("\n")
      .trim();

    if (!raw) {
      return res.status(502).json({
        error: "The AI returned an empty response."
      });
    }

    let operator;

    try {
      operator = JSON.parse(raw);
    } catch {
      return res.status(502).json({
        error: "The AI returned invalid data. Please retry."
      });
    }

    operator.tasks = Array.isArray(operator.tasks)
      ? operator.tasks.slice(0, 8).map((task, i) => ({
          ...task,
          id: String(task.id || `task-${i + 1}`),
          status: "pending"
        }))
      : [];

    operator.priorities = Array.isArray(operator.priorities)
      ? operator.priorities.slice(0, 5)
      : [];

    operator.drafts = Array.isArray(operator.drafts)
      ? operator.drafts.slice(0, 3)
      : [];

    operator.approvals = Array.isArray(operator.approvals)
      ? operator.approvals.slice(0, 5)
      : [];

    operator.metrics = Array.isArray(operator.metrics)
      ? operator.metrics.slice(0, 5)
      : [];

    return res.status(200).json({ operator });

  } catch (error) {
    console.error("Soloco AI error:", error);

    return res.status(500).json({
      error: "Soloco AI could not prepare its operations. Please retry."
    });
  }
}
