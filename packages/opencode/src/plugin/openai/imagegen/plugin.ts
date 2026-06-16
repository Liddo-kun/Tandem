import type { Hooks, PluginInput, ToolContext } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { ImageGen } from "./imagegen"

// UPSTREAM-DIVERGENCE: Tandem-only OpenAI image generation tool. Visible only when
// an OpenAI credential (API key or ChatGPT OAuth) is resolvable; hidden otherwise.
// Disable with TANDEM_IMAGEGEN=0. Design + verified contract: notes/imagegen.md.

// Append the prompt the image model actually used to the tool output, but only when
// it differs from what the user typed (i.e. the model revised it) — verbatim prompts
// would just be redundant noise. Surfaces the model's editorializing to the agent/TUI;
// the UI shows the same per image. `revised` is aligned with the produced images.
function revisedPromptOutput(revised: Array<string | null>, original: string): string {
  const orig = original.trim()
  const changed = revised
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0 && entry !== orig)
  const unique = [...new Set(changed)]
  if (unique.length === 0) return ""
  if (unique.length === 1) return `\n\nImage prompt used (revised by the model): ${JSON.stringify(unique[0])}`
  return `\n\nImage prompts used (revised by the model):\n${unique.map((entry, index) => `${index + 1}. ${JSON.stringify(entry)}`).join("\n")}`
}

export async function ImagegenPlugin(input: PluginInput): Promise<Hooks> {
  // Option A visibility: contribute the tool only when imagegen is available at
  // construction (opt-out flag + a resolvable credential). The built-in imagegen
  // skill gates on the same `isAvailable()` so the two stay in lockstep.
  // Re-evaluation on later login is deferred (future option B).
  if (!(await ImageGen.isAvailable())) return {}

  return {
    tool: {
      imagegen: tool({
        description: ImageGen.DESCRIPTION,
        args: {
          prompt: tool.schema.string().describe("What to generate, or how to edit the provided image(s). Be specific."),
          // NOTE: the plugin registry validates these Zod args only as a predicate
          // (safeParse().success) and passes the RAW args to execute — Zod `.default()`
          // is never applied. So fields are optional here and defaults are applied in
          // execute below; the defaults are documented in the descriptions for the model.
          quality: tool.schema
            .enum(["low", "medium", "high", "auto"])
            .optional()
            .describe("Image quality (default high). Higher is slower and costlier."),
          size: tool.schema
            .enum(["auto", "1024x1024", "1536x1024", "1024x1536"])
            .optional()
            .describe(
              "Output size (default auto): auto, 1024x1024 (square), 1536x1024 (landscape), or 1024x1536 (portrait).",
            ),
          n: tool.schema
            .number()
            .int()
            .min(1)
            .max(ImageGen.MAX_N)
            .optional()
            .describe(
              `How many images to generate, 1-${ImageGen.MAX_N} (default 1). Generation is slow and costly; keep small.`,
            ),
          image_paths: tool.schema
            .array(tool.schema.string())
            .max(ImageGen.MAX_EDIT_IMAGES)
            .optional()
            .describe("Local image file path(s) to edit. Omit to generate a brand new image."),
          mask_path: tool.schema
            .string()
            .optional()
            .describe("Optional PNG mask (transparent areas mark the edit region); applies to the first image."),
        },
        async execute(args, ctx: ToolContext & { callID?: string }) {
          let live = await ImageGen.resolveCreds()
          if (!live) throw new Error("No OpenAI credentials. Run `opencode auth login` (OpenAI) or set OPENAI_API_KEY.")
          // The OAuth token may have refreshed since construction; refresh + persist if stale.
          if (live.mode === "oauth" && ImageGen.needsRefresh(live)) {
            live = await ImageGen.refreshOAuth(live)
            await input.client.auth
              .set({
                path: { id: "openai" },
                body: {
                  type: "oauth",
                  refresh: live.refresh,
                  access: live.access,
                  expires: live.expires,
                  ...(live.accountId ? { accountId: live.accountId } : {}),
                },
              })
              .catch(() => {})
          }

          // Apply defaults here since the registry does not apply Zod `.default()`.
          const request: ImageGen.Args = {
            prompt: args.prompt,
            quality: args.quality ?? "high",
            size: args.size ?? "auto",
            n: args.n ?? 1,
            image_paths: args.image_paths,
            mask_path: args.mask_path,
          }
          const images = await ImageGen.run(request, live)
          const pngs = images.map((image) => image.png)
          const callID = ctx.callID ?? ctx.messageID
          const saved = await ImageGen.saveImages(pngs, ctx.sessionID, callID)
          const sizeLabel = request.size === "auto" ? "auto size" : request.size
          // The prompt the image model reports it actually used (per image). On OAuth
          // the host model can still adjust wording despite the verbatim instruction,
          // so surface this so the caller sees what was rendered. Aligned with `saved`.
          const revisedPrompts = images.map((image) => image.revisedPrompt ?? null)
          // Return only the saved path(s) as text — the image is NOT attached, so it is
          // not fed into the model's context (a full PNG would balloon context and be
          // re-sent every turn).
          const fileList =
            saved.length === 1
              ? `Saved 1 image (${sizeLabel}):\n${saved[0]}`
              : `Saved ${saved.length} images (${sizeLabel}):\n${saved.join("\n")}`
          const output = `${fileList}${revisedPromptOutput(revisedPrompts, request.prompt)}`
          return {
            title: request.prompt.length > 60 ? `${request.prompt.slice(0, 57)}...` : request.prompt,
            output,
            metadata: {
              paths: saved,
              size: request.size,
              quality: request.quality,
              count: saved.length,
              mode: live.mode,
              revisedPrompts,
            },
          }
        },
      }),
    },
  }
}
