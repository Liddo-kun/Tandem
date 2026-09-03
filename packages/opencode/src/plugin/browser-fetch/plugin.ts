import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import DESCRIPTION from "./webfetch.txt"
import { readdirSync, unlinkSync } from "node:fs"
import AGENT_PROMPT from "./web-fetcher.md" with { type: "text" }
import { fetchPage, FetchError } from "./cdp-fetch"

// UPSTREAM-DIVERGENCE: Tandem-only browser-backed `webfetch`. Replaces the built-in
// tool of the same name: the page is retrieved through a real Chrome window (see
// cdp-fetch.ts) and handed to the `web-fetcher` subagent along with the caller's
// prompt; only the subagent's distilled answer comes back.
//
// Why a real browser: cdp-fetch drives the user's actual browser profile, so it sees
// what they see — logged-in pages, JS-rendered sites, pages that turn away plain
// HTTP clients. Why a subagent: raw page text lands in the child session and the
// caller gets a paragraph, so a 200KB page costs the caller almost nothing.
//
// The fetch happens HERE, not in the subagent. Letting the subagent issue the
// fetch cost a full model turn (~4.5K tokens, one round trip) whose entire output
// was the command we could have written ourselves; retry-on-failure is
// deterministic and belongs in code. Inside the subagent the same `webfetch` tool
// runs in raw mode (returns the page, no further subagent) for follow-ups it can
// only decide on after seeing the page: a different URL, or `html` for
// markup-only details. That raw mode is also the recursion guard.
//
// Registering under the name `webfetch` shadows the built-in for every agent
// (custom tools are applied after built-ins and win on ID collision), so callers
// keep using `webfetch` unchanged. The subagent itself is contributed through the
// `config` hook so no upstream agent file changes; a user `agent.web-fetcher`
// config entry overrides any of its fields.

const SUBAGENT = "web-fetcher"
const MAX_CONTENT_BYTES = 100_000
const MAX_TIMEOUT = 120
const SHOT_DIR = "/tmp/tandem/webfetch"
// Follow-up fetches the subagent may make per webfetch call. Without a ceiling
// a bad starting URL turned into 68 fetches (46 of them Google searches) and got
// the network's IP put on Google's "unusual traffic" page.
const MAX_FOLLOWUPS = 12
const MAX_SEARCHES = 5
const SEARCH_RE = /^https?:\/\/(?:www\.)?(?:google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com|yandex\.[a-z]+|baidu\.com)\/(?:search|html)?/i

const AGENT = {
  description:
    "Retrieves a single web page through a real browser window and returns only the information the caller asked for. Invoked by the webfetch tool, not directly.",
  mode: "subagent",
  model: "openai/gpt-5.6-sol",
  variant: "medium",
  temperature: 0.1,
  hidden: true,
  prompt: AGENT_PROMPT,
  // `webfetch` (raw mode) plus `read` for the overflow file a long page spills into.
  permission: { "*": "deny", webfetch: "allow", read: "allow" },
} as const

type Fetched = { ok: true; content: string; via: string; file?: string; screenshots?: string[] } | { ok: false; error: string }

function render(page: Awaited<ReturnType<typeof fetchPage>>): string {
  const stateNote =
    page.pageState === "ready-after-wait"
      ? "   (real content arrived after a placeholder page)"
      : page.pageState === "never-ready"
        ? "   (WARNING: page never delivered real content — text below is the placeholder)"
        : ""
  const lines = [`# ${page.title}`, `URL: ${page.url}${stateNote}`]
  if (page.status && page.status >= 400) lines.push(`HTTP ${page.status} — this is the server's error page, not the requested content`)
  if (page.file) lines.push(`Document download (${page.mime}); saved to ${page.file}. Text below is extracted from it.`)
  if (page.screenshots)
    lines.push(
      `Screenshots (top to bottom): ${page.screenshots.join(", ")}` +
        (page.screenshotCut ? ` — page continues ${page.screenshotCut}px below the last one` : ""),
    )
  return `${lines.join("\n")}\n\n${page.text}`
}

// Every fetch leaves PNG slices behind; keep the directory to the newest few
// hundred so a long session does not fill /tmp.
const MAX_SHOTS = 300
function pruneShots() {
  try {
    const files = readdirSync(SHOT_DIR)
      .filter((f) => f.endsWith(".png"))
      .sort()
    for (const f of files.slice(0, Math.max(0, files.length - MAX_SHOTS))) unlinkSync(`${SHOT_DIR}/${f}`)
  } catch {}
}

// Per child session follow-up budget, keyed by session id. Sessions are short
// and never reused, so the map is simply kept bounded.
const budgets = new Map<string, { total: number; searches: number }>()
function spend(sessionID: string, url: string) {
  let b = budgets.get(sessionID)
  if (!b) {
    if (budgets.size > 500) budgets.delete(budgets.keys().next().value!)
    b = { total: 0, searches: 0 }
    budgets.set(sessionID, b)
  }
  const search = SEARCH_RE.test(url)
  if (b.total >= MAX_FOLLOWUPS)
    throw new Error(`follow-up budget for this webfetch call is used up (${MAX_FOLLOWUPS} fetches). Answer from what you already have.`)
  if (search && b.searches >= MAX_SEARCHES)
    throw new Error(`search budget for this webfetch call is used up (${MAX_SEARCHES} searches). Answer from what you already have.`)
  b.total++
  if (search) b.searches++
}

// One fetch with the deterministic retries: a hard timeout gets the maximum
// budget once; a placeholder that never resolves on the desktop is retried on the
// tablet's Chrome, which often gets a different answer from the same site.
async function fetchWithRetries(
  url: string,
  html: boolean,
  timeout: number,
  signal: AbortSignal,
  screenshot: string,
): Promise<Fetched> {
  const attempt = async (android: boolean, t: number) => {
    try {
      return { page: await fetchPage({ url, html, android, timeout: t, signal, screenshot }) }
    } catch (e) {
      return { error: e instanceof FetchError ? e : new FetchError(e instanceof Error ? e.message : String(e), 1) }
    }
  }

  let r = await attempt(false, timeout)
  let via = "desktop Chromium"
  if (r.error?.code === 3 && timeout < MAX_TIMEOUT) r = await attempt(false, MAX_TIMEOUT)
  // A second browser on the same IP will not get past a network-level refusal.
  if (r.page?.pageState === "never-ready") {
    r = await attempt(true, timeout)
    via = "Android Chrome"
  }

  if (signal.aborted) return { ok: false, error: "aborted" }
  if (r.page?.pageState === "blocked")
    return {
      ok: false,
      error: `${new URL(url).hostname} is refusing requests from this network right now (rate limit / "unusual traffic" page). Do not retry it or other searches on that site in this call.`,
    }
  if (r.page?.pageState === "never-ready")
    return {
      ok: false,
      error: "the site never delivered real content; both desktop and Android Chrome only saw a placeholder page",
    }
  if (r.page) return { ok: true, content: render(r.page), via, file: r.page.file, screenshots: r.page.screenshots }
  if (r.error!.code === 3) return { ok: false, error: `timed out after ${MAX_TIMEOUT}s` }
  return { ok: false, error: r.error!.message }
}

export async function BrowserFetchPlugin({ client }: PluginInput): Promise<Hooks> {
  // Opt out (TANDEM_BROWSER_FETCH=0) leaves the built-in HTTP webfetch in place.
  if (process.env.TANDEM_BROWSER_FETCH === "0") return {}
  return {
    config: async (cfg) => {
      cfg.agent ??= {}
      cfg.agent[SUBAGENT] = { ...AGENT, ...cfg.agent[SUBAGENT] }
    },
    tool: {
      webfetch: tool({
        description: DESCRIPTION,
        args: {
          url: tool.schema.string().describe("The URL to fetch content from"),
          // The plugin registry validates these Zod args only as a predicate and passes
          // the raw args to execute, so `.default()` would never apply; defaults are
          // applied in execute and documented for the model here.
          format: tool.schema
            .enum(["text", "markdown", "html"])
            .optional()
            .describe("The format to return the content in (text, markdown, or html). Defaults to markdown."),
          timeout: tool.schema.number().optional().describe("Optional timeout in seconds (max 120)"),
          screenshot: tool.schema
            .boolean()
            .optional()
            .describe(
              "Have the reader look at the rendered page as well as its text, for when the information is visual: " +
                "charts, diagrams, text inside images, layouts, product pages whose specs are pictures.",
            ),
          prompt: tool.schema
            .string()
            .optional()
            .describe(
              "What you want from this page, in a sentence or two, e.g. 'the current price and stock status' " +
                "or 'the changelog entries since v2'. Omit to get the full main content of the page.",
            ),
        },

        async execute(args, context) {
          let host = args.url
          try {
            host = new URL(args.url).hostname
          } catch {
            throw new Error(`Not a valid URL: ${args.url}`)
          }
          context.metadata({ title: host })

          const timeout = Math.min(Math.max(args.timeout ?? 60, 5), MAX_TIMEOUT)
          const format = args.format ?? "markdown"
          if (context.agent === SUBAGENT) spend(context.sessionID, args.url)
          // Every fetch is captured; whether the subagent looks is decided below.
          const shotBase = `${SHOT_DIR}/${Date.now()}-${host.replace(/[^\w.-]+/g, "_")}`
          pruneShots()
          const fetched = await fetchWithRetries(args.url, format === "html", timeout, context.abort, shotBase)
          // A failed fetch is reported straight back; no point spending a
          // subagent turn to say the same thing.
          if (!fetched.ok) throw new Error(`Fetch failed for ${args.url}: ${fetched.error}`)

          // Raw mode for the subagent's own follow-ups (and the recursion guard).
          if (context.agent === SUBAGENT) return fetched.content

          let content = fetched.content
          let note = ""
          if (content.length > MAX_CONTENT_BYTES) {
            note = `\n\n[page content truncated at ${MAX_CONTENT_BYTES / 1000} KB; ${Math.round((content.length - MAX_CONTENT_BYTES) / 1000)} KB omitted]`
            content = content.slice(0, MAX_CONTENT_BYTES)
          }

          const created = (
            await client.session.create({
              body: { parentID: context.sessionID, title: `fetch ${host}` },
            })
          ).data
          if (!created?.id) throw new Error("could not create the web-fetcher session")

          const onAbort = () => void client.session.abort({ path: { id: created.id } })
          context.abort.addEventListener("abort", onAbort, { once: true })

          try {
            const result = (
              await client.session.prompt({
                path: { id: created.id },
                body: {
                  agent: SUBAGENT,
                  parts: [
                    {
                      type: "text",
                      // Opt out of the prompt corrector: this text is generated,
                      // not typed, and the corrector's fallback path for prompts
                      // without a `model` fails and retries for ~70s before giving up.
                      metadata: { tandemCorrectorDisabled: true },
                      text: [
                        `URL: ${args.url}`,
                        `Format: ${format}`,
                        args.prompt
                          ? `What the caller needs: ${args.prompt}`
                          : "No prompt given: return the full main content of the page.",
                        ...(args.screenshot && fetched.screenshots
                          ? [`The caller asked you to look at the page: its ${fetched.screenshots.length} screenshot slice(s) are attached.`]
                          : []),
                        "",
                        `The page has already been fetched (via ${fetched.via}${format === "html" ? ", as HTML" : ""}). Content follows.`,
                        "",
                        "<page>",
                        content + note,
                        "</page>",
                      ].join("\n"),
                    },
                    // Caller asked for a look: attach the slices up front rather
                    // than spending a turn on the subagent `read`ing them.
                    ...(args.screenshot && fetched.screenshots
                      ? fetched.screenshots.map((file) => ({
                          type: "file" as const,
                          mime: "image/png",
                          filename: file.slice(file.lastIndexOf("/") + 1),
                          url: `file://${file}`,
                        }))
                      : []),
                  ],
                },
              })
            ).data

            const parts = result?.parts ?? []
            const answer = (
              parts.findLast((p) => p.type === "text")?.text ??
              parts
                .filter((p) => p.type === "text")
                .map((p) => p.text)
                .join("")
            )?.trim()

            if (!answer) throw new Error(`no answer came back for ${args.url}`)
            // A downloaded document outlives the answer: the caller may want the
            // file itself (read it, convert it, move it out of /tmp).
            const trailer = [
              fetched.file ? `[Downloaded file saved to ${fetched.file}]` : "",
              fetched.screenshots ? `[Screenshots: ${fetched.screenshots.join(", ")}]` : "",
            ]
              .filter(Boolean)
              .join("\n")
            return trailer ? `${answer}\n\n${trailer}` : answer
          } finally {
            context.abort.removeEventListener("abort", onAbort)
          }
        },
      }),
    },
  }
}
