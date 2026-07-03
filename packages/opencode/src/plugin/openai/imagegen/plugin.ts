import type { Hooks, PluginInput, ToolContext } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { ImageGen } from "./imagegen"

// UPSTREAM-DIVERGENCE: Tandem-only OpenAI image generation tool. Visible only when
// an OpenAI credential (API key or ChatGPT OAuth) is resolvable; hidden otherwise.
// Disable with TANDEM_IMAGEGEN=0. Design + verified contract: notes/imagegen.md.

// Append the prompt the image model actually used to the tool output, but only when
// it differs from what the user typed (i.e. the model revised it) — verbatim prompts
// would just be redundant noise. Surfaces the model's editorializing to the agent/TUI;
// the UI shows the same.
function revisedPromptOutput(revised: string | null, original: string): string {
  const used = typeof revised === "string" ? revised.trim() : ""
  if (!used || used === original.trim()) return ""
  return `\n\nImage prompt used (revised by the model): ${JSON.stringify(used)}`
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
              "Output size (default auto): auto, 1024x1024 (square), 1536x1024 (landscape), or 1024x1536 (portrait). Exact size is honored only with an OpenAI API key; with ChatGPT (OAuth) sign-in the backend ignores this and auto-sizes from the prompt, so steer aspect ratio via the prompt instead.",
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
          transparent: tool.schema
            .boolean()
            .optional()
            .describe(
              "Set true for a transparent-background cutout (e.g. a logo, sprite, or product shot to place on another background). Renders the subject on a flat key color and removes it to alpha locally. Best for solid-edged subjects; wispy edges (hair, fur, glass, smoke) may keep a fringe. Default false (opaque).",
            ),
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
            image_paths: args.image_paths,
            mask_path: args.mask_path,
            transparent: args.transparent ?? false,
          }
          const image = await ImageGen.run(request, live)
          const png = image.png
          const callID = ctx.callID ?? ctx.messageID
          // Saves the full-quality PNG and a smaller copy beside it (JPEG when opaque, WebP when
          // transparent so alpha survives), returning the small copy's path. That copy (not the PNG)
          // is what the chat shows and the model reads back, so the heavy PNG stays on disk but out
          // of context. Size reporting below reads the original PNG header.
          const saved = await ImageGen.saveImage(png, ctx.directory, callID, request.transparent)
          // Report the real pixel size read from the PNG, not the requested size: on the
          // ChatGPT/OAuth backend the image_generation tool IGNORES `size` and the host
          // model auto-sizes from the prompt (verified — a landscape prompt yields 1536x1024
          // regardless of the `size` sent). Exact size is honored only on the API-key path.
          const actualSize = ImageGen.pngDimensions(png)
          const fallbackLabel = request.size === "auto" ? "auto size" : request.size
          const sizeLabel = actualSize ?? fallbackLabel
          // Tell the caller when a requested size was dropped so the agent does not retry the
          // same size expecting a different result. Only the OAuth backend silently auto-sizes.
          const sizeIgnored =
            live.mode === "oauth" && request.size !== "auto" && actualSize !== undefined && actualSize !== request.size
          const sizeNote = sizeIgnored
            ? `\n\nNote: requested size ${request.size} was not applied — the ChatGPT (OAuth) image backend auto-sizes from the prompt. Sign in with an OpenAI API key for exact sizes.`
            : ""
          // The prompt the image model reports it actually used. On OAuth the host model can
          // still adjust wording despite the verbatim instruction, so surface what was rendered.
          const revisedPrompt = image.revisedPrompt ?? null
          // Return only the saved path as text — the image is NOT attached, so it is not fed
          // into the model's context (a full PNG would balloon context and be re-sent every
          // turn). The web UI fetches this relative path via file.read to render a
          // click-to-zoom thumbnail, which never touches the model's context.
          const label = request.transparent ? "Saved transparent image" : "Saved image"
          const output = `${label} (${sizeLabel}):\n${saved}${sizeNote}${revisedPromptOutput(revisedPrompt, request.prompt)}`
          return {
            title: request.prompt.length > 60 ? `${request.prompt.slice(0, 57)}...` : request.prompt,
            output,
            metadata: {
              path: saved,
              // Actual rendered size; the requested size is kept separately so a mismatch
              // (OAuth) is inspectable.
              size: actualSize ?? fallbackLabel,
              requestedSize: request.size,
              quality: request.quality,
              transparent: request.transparent,
              mode: live.mode,
              revisedPrompt,
            },
          }
        },
      }),
    },
  }
}
