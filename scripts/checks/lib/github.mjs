// Minimal GitHub REST client for the weekly check. Needs only the workflow's GITHUB_TOKEN with
// issues: write, contents: read, actions: read. Reads also work without a token on a public repo.

export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function createGitHub({ token, repo, fetchImpl = fetch, apiUrl = "https://api.github.com" }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? "")) throw new Error(`invalid repo "${repo}", expected owner/name`);

  async function request(method, pathOrUrl, body) {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${apiUrl}${pathOrUrl}`;
    const headers = {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "fertility-tracker-weekly-check",
    };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) throw new GitHubError(`${method} ${url.replace(apiUrl, "")} -> ${res.status} ${data?.message ?? ""}`.trim(), res.status);
    return { data, headers: res.headers };
  }

  // Follows rel="next" links. If maxPages runs out first, the returned array has `truncated = true`.
  async function paginate(path, maxPages = 30) {
    const out = [];
    let url = path;
    for (let page = 0; url && page < maxPages; page++) {
      const { data, headers } = await request("GET", url);
      const items = Array.isArray(data) ? data : data?.workflow_runs ?? data?.items ?? [];
      out.push(...items);
      url = headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
    }
    out.truncated = !!url;
    return out;
  }

  const r = `/repos/${repo}`;
  return {
    repo,
    canWrite: !!token,
    request,
    paginate,

    // Issues (not PRs) updated since `since`, any state, plus every open issue (for the untriaged backlog).
    async listIssuesForReport(since) {
      const recent = await paginate(`${r}/issues?state=all&since=${encodeURIComponent(since)}&per_page=100&sort=updated&direction=desc`);
      const open = await paginate(`${r}/issues?state=open&per_page=100`);
      const byNumber = new Map();
      for (const i of [...recent, ...open]) if (!i.pull_request) byNumber.set(i.number, i);
      const issues = [...byNumber.values()];
      issues.truncated = recent.truncated || open.truncated;
      return issues;
    },

    async listWorkflowRuns(workflowFile, perPage = 15) {
      const { data } = await request("GET", `${r}/actions/workflows/${encodeURIComponent(workflowFile)}/runs?per_page=${perPage}`);
      return data?.workflow_runs ?? [];
    },

    // Create any label from `defs` ({ name: {color, description} }) that the repo lacks. Issue templates
    // silently drop labels that do not exist, so this keeps auto-labelling working.
    async ensureLabels(defs) {
      const existing = new Set((await paginate(`${r}/labels?per_page=100`)).map((l) => l.name.toLowerCase()));
      const created = [];
      for (const [name, def] of Object.entries(defs ?? {})) {
        if (existing.has(name.toLowerCase())) continue;
        await request("POST", `${r}/labels`, { name, color: def.color ?? "ededed", description: (def.description ?? "").slice(0, 100) });
        created.push(name);
      }
      return created;
    },

    // Machine summary of the newest weekly-check issue (any state), or null. Only maintainers and the
    // workflow can apply this label (the issue forms never do), so its body is our own output.
    async previousSummary(label, titleRe) {
      const issues = (await paginate(`${r}/issues?state=all&labels=${encodeURIComponent(label)}&per_page=20&sort=created&direction=desc`, 1)).filter((i) => !i.pull_request && titleRe.test(i.title));
      for (const issue of issues) {
        const block = issue.body?.match(/```json\n([\s\S]*?)\n```/)?.[1];
        try {
          const summary = JSON.parse(block);
          if (summary?.schema?.startsWith("fertility-tracker/weekly-check@")) return { number: issue.number, ...summary };
        } catch {}
      }
      return null;
    },

    /**
     * Keep exactly one open weekly-check issue: update today's if it exists (reopening it if someone closed
     * it), otherwise create it, then close every other open issue with the label and a report title.
     */
    async publishReport({ title, body, label, titleRe }) {
      const open = (await paginate(`${r}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100`)).filter((i) => !i.pull_request && titleRe.test(i.title));
      let issue = open.find((i) => i.title === title);
      if (!issue) {
        const recent = await paginate(`${r}/issues?state=closed&labels=${encodeURIComponent(label)}&per_page=30&sort=created&direction=desc`, 1);
        issue = recent.find((i) => !i.pull_request && i.title === title);
      }
      let created = false;
      if (issue) {
        issue = (await request("PATCH", `${r}/issues/${issue.number}`, { body, state: "open" })).data;
      } else {
        issue = (await request("POST", `${r}/issues`, { title, body, labels: [label] })).data;
        created = true;
      }
      const closed = [];
      for (const old of open) {
        if (old.number === issue.number) continue;
        await request("POST", `${r}/issues/${old.number}/comments`, { body: `Superseded by #${issue.number}.` });
        await request("PATCH", `${r}/issues/${old.number}`, { state: "closed", state_reason: "completed" });
        closed.push(old.number);
      }
      return { number: issue.number, url: issue.html_url, created, closed };
    },
  };
}
