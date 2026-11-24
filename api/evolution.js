export const config = { maxDuration: 60 };

import { readFile } from "node:fs/promises";
import { getGoSoloAccess } from "../lib/billing.js";
import {
  buildEvolutionPrompt,
  collectStaticChecks,
  parseEvolutionReview,
  validateEvolutionSnapshot
} from "../lib/evolution-core.js";

const REVIEW_FILES = [
  "api/build.js",
  "api/operator.js",
  "api/cron/operator.js",
  "lib/billing.js",
  "lib/operator-store.js",
  "supabase/schema.sql",
  "vercel.json",
  "package.json"
];

async function readApprovedSource() {
  const files = await Promise.all(REVIEW_FILES.map(async path => {
    const content = await readFile(new URL("../" + path, import.meta.url), "utf8");
    return { path, content };
  }));
  return validateEvolutionSnapshot(files);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, error: "Use POST." });
  }

  try {
    const access = await getGoSoloAccess(req);
    if (!access?.owner) {
      return res.status(403).json({
        success: false,
        error: "The autonomous evolution lab is restricted to the verified GoSolo owner account."
      });
    }

    const action = String(req.body?.action || "review");
    if (action !== "review") {
      return res.status(400).json({ success: false, error: "Only the read-only review action is enabled in this first release." });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ success: false, error: "GEMINI_API_KEY is not configured in this Vercel environment." });
    }

    const files = await readApprovedSource();
    const staticChecks = collectStaticChecks(files);
    const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: buildEvolutionPrompt(files, staticChecks) }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 3500,
          responseMimeType: "application/json"
        }
      }),
      signal: AbortSignal.timeout(45000)
    });

    const raw = await response.text();
    let payload = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch {}
    if (!response.ok) {
      console.error("GoSolo evolution review model error:", response.status, raw.slice(0, 500));
      return res.status(502).json({
        success: false,
        error: payload?.error?.message || "The code review model request failed."
      });
    }

    const generated = payload?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();
    if (!generated) {
      return res.status(502).json({ success: false, error: "The code review model returned an empty response." });
    }

    const review = parseEvolutionReview(generated);
    return res.status(200).json({
      success: true,
      mode: "read-only",
      appliedChanges: 0,
      filesReviewed: files.map(file => file.path),
      reviewedAt: new Date().toISOString(),
      model,
      staticChecks,
      review,
      notice: "This review only proposes work. It does not edit files, run tests, change production, or deploy."
    });
  } catch (error) {
    console.error("GoSolo evolution review failed:", error);
    const message = error?.name === "AbortError" || error?.name === "TimeoutError"
      ? "The code review timed out. Try again later."
      : error.message || "The evolution review could not be completed.";
    return res.status(500).json({ success: false, error: message });
  }
}
