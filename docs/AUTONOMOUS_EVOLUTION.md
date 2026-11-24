# GoSolo Autonomous Evolution Core

## First milestone: read-only self-review

The first release adds an `evolution-review` action to the existing `POST /api/operator` endpoint, avoiding an additional Vercel Serverless Function on the Hobby plan. It is restricted to the verified GoSolo owner account and reviews a fixed allowlist of application source files from the deployed build.

The review combines deterministic checks with an LLM review. It returns findings, risk levels, proposed change descriptions, and required tests. It does not accept arbitrary filesystem paths, expose environment-variable values, edit files, run generated code, change billing rules, or deploy.

## Request

Send an authenticated POST request to `/api/operator` with a valid Supabase bearer token:

```json
{ "action": "evolution-review" }
```

The endpoint uses the existing `GEMINI_API_KEY` and optional `GEMINI_MODEL` Vercel environment variables. The current default model matches the existing GoSolo build endpoint.

## Evolution stages

1. **Observe:** inspect a fixed source allowlist and runtime configuration presence (never secret values).
2. **Analyze:** combine deterministic checks with model-assisted review.
3. **Propose:** produce a prioritized change plan and required test list.
4. **Validate:** future milestone; run tests in an isolated environment against a temporary branch.
5. **Approve:** require explicit owner approval before any repository write.
6. **Deploy:** future milestone; deploy only a reviewed commit, then verify health and preserve rollback capability.

## Non-negotiable controls

- No self-modification of this reviewer, authentication, billing, approval, or secret-handling controls.
- No direct production writes from model output.
- No arbitrary command execution or filesystem path supplied by the model.
- No secret values in prompts or responses.
- Every code change must be attributable to a commit and independently testable.
- Failed validation must stop the release; rollback must remain available.

## Current limitations

The endpoint is a first milestone, not a self-learning model. It does not train or alter the underlying Gemini/GPT model, persist review history, open pull requests, run tests, or deploy. Those are separate milestones requiring their own permissions and validation.
