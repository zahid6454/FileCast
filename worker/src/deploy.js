// Admin-triggered rebuild. The Worker holds the GitHub PAT (Worker secret) and
// dispatches / polls the deploy.yml workflow server-side so the token never
// reaches the browser.

import { json, error } from "./utils/http.js";
import { requireAdmin } from "./middleware.js";

const UA = "FileCast-Worker";

function ghHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_PAT}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": UA,
  };
}

// POST /api/admin/deploy — dispatch the workflow, return a run id to poll.
export async function triggerDeploy(request, env) {
  const guard = await requireAdmin(request, env);
  if (guard) return guard;
  if (!env.GITHUB_PAT) return error(500, "Deploy not configured (missing GITHUB_PAT)");

  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const workflow = env.GITHUB_WORKFLOW || "deploy.yml";
  const dispatchedAt = new Date().toISOString();

  const dispatch = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: { ...ghHeaders(env), "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "master" }),
    },
  );
  if (dispatch.status !== 204) {
    const detail = await dispatch.text();
    return error(502, "Workflow dispatch failed", { status: dispatch.status, detail });
  }

  // The dispatch API returns no run id, so find the most recent run created for
  // this workflow at/after our dispatch time.
  let runId = null;
  for (let attempt = 0; attempt < 5 && !runId; attempt++) {
    await sleep(1500);
    const runsRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=5`,
      { headers: ghHeaders(env) },
    );
    if (!runsRes.ok) continue;
    const runs = await runsRes.json();
    const match = (runs.workflow_runs || []).find(
      (r) => new Date(r.created_at).getTime() >= new Date(dispatchedAt).getTime() - 5000,
    );
    if (match) runId = match.id;
  }

  return json({ ok: true, run_id: runId, dispatched_at: dispatchedAt });
}

// GET /api/admin/deploy/:run_id — proxy the run status.
export async function deployStatus(request, env) {
  const guard = await requireAdmin(request, env);
  if (guard) return guard;
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const runId = request.params.run_id;
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}`,
    { headers: ghHeaders(env) },
  );
  if (!res.ok) return error(502, "Failed to fetch run status", { status: res.status });
  const run = await res.json();
  return json({
    run_id: run.id,
    status: run.status, // queued | in_progress | completed
    conclusion: run.conclusion, // success | failure | null
    html_url: run.html_url,
    updated_at: run.updated_at,
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
