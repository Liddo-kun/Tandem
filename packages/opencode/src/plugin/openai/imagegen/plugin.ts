import type { Hooks, PluginInput, ToolContext } from "@opencode-ai/plugin"
import path from "node:path"
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
  if (ImageGen.disabledByFlag()) return {}
  const creds = await ImageGen.resolveCreds().catch(() => undefined)
  if (!creds) return {}

  const apiControls = tool.schema.object({
    quality: tool.schema.enum(ImageGen.QUALITIES).optional().describe("Image quality, default high."),
    width: tool.schema
      .number()
      .int()
      .positive()
      .max(3840)
      .multipleOf(16)
      .describe("Width in pixels. Aspect ratio ≤3:1; total pixels 655360–8294400."),
    height: tool.schema.number().int().positive().max(3840).multipleOf(16).describe("Height in pixels."),
  })
  const controls = creds.mode === "api" ? apiControls : apiControls.omit({ quality: true, width: true, height: true })

  return {
    tool: {
      imagegen: tool({
        description: ImageGen.DESCRIPTION,
        args: {
          prompt: tool.schema.string().describe("What to generate, or how to edit the provided image(s). Be specific."),
          ...controls.shape,
          image_paths: tool.schema
            .array(tool.schema.string())
            .max(ImageGen.MAX_EDIT_IMAGES)
            .optional()
            .describe("Local source/reference images. Describe each image's role in the prompt."),
          mask_path: tool.schema
            .string()
            .optional()
            .describe("Optional PNG mask (transparent areas mark the edit region); applies to the first image."),
          transparent: tool.schema
            .boolean()
            .optional()
            .describe("Native transparent background. Default false (opaque)."),
        },
        async execute(args, ctx: ToolContext & { callID?: string }) {
          let live = await ImageGen.resolveCreds()
          if (!live) throw new Error("No OpenAI credentials. Run `opencode auth login` (OpenAI) or set OPENAI_API_KEY.")
          if (live.mode !== creds.mode)
            throw new Error("OpenAI authentication mode changed. Reload the project to refresh imagegen controls.")
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
          const settings = live.mode === "api" ? apiControls.parse(args) : undefined
          const request: ImageGen.Args = {
            prompt: args.prompt,
            ...(settings ? { ...settings, quality: settings.quality ?? "high" } : {}),
            image_paths: args.image_paths?.map((file) => path.resolve(ctx.directory, file)),
            mask_path: args.mask_path ? path.resolve(ctx.directory, args.mask_path) : undefined,
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
          const actualSize = ImageGen.pngDimensions(png)
          const requestedSize = live.mode === "api" ? `${request.width}x${request.height}` : undefined
          const sizeLabel = actualSize ?? "unknown size"
          const sizeNote =
            requestedSize && actualSize !== undefined && actualSize !== requestedSize
              ? `\n\nNote: requested ${requestedSize}; the backend returned ${actualSize}.`
              : ""
          const qualityNote =
            request.quality && image.reported?.quality && image.reported.quality !== request.quality
              ? `\n\nNote: requested quality ${request.quality}; the backend reported ${image.reported.quality}.`
              : ""
          const modelNote = image.reported?.model ? `\n\nBackend image model/route: ${image.reported.model}.` : ""
          // Masked OAuth edits use a host model; surface any prompt revision it reports.
          const revisedPrompt = image.revisedPrompt ?? null
          // Return only the saved path as text — the image is NOT attached, so it is not fed
          // into the model's context (a full PNG would balloon context and be re-sent every
          // turn). The web UI fetches this relative path via file.read to render a
          // click-to-zoom thumbnail, which never touches the model's context.
          const label = request.transparent ? "Saved transparent image" : "Saved image"
          const qualityLabel = image.reported?.quality ? `; reported quality: ${image.reported.quality}` : ""
          const output = `${label} (${sizeLabel}${qualityLabel}):\n${saved}${sizeNote}${qualityNote}${modelNote}${revisedPromptOutput(revisedPrompt, request.prompt)}`
          return {
            title: request.prompt.length > 60 ? `${request.prompt.slice(0, 57)}...` : request.prompt,
            output,
            metadata: {
              path: saved,
              size: actualSize ?? null,
              ...(live.mode === "api"
                ? {
                    requestedSize,
                    requestedModel: ImageGen.IMAGE_MODEL,
                    requestedQuality: request.quality,
                  }
                : {}),
              reported: image.reported,
              quality: image.reported?.quality ?? null,
              requestId: image.requestId,
              generationId: image.generationId,
              transparent: request.transparent,
              mode: live.mode,
              transport: image.transport ?? "images",
              revisedPrompt,
            },
          }
        },
      }),
    },
  }
}
