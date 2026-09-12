/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeOpencodeContent from "./skill/customize-opencode.md" with { type: "text" }
// UPSTREAM-DIVERGENCE: opt-in Tandem browser guidance, shared by both session paths.
import chromeBrowserContent from "./skill/chrome-browser.md" with { type: "text" }

export const CustomizeOpencodeContent = customizeOpencodeContent
export const ChromeBrowser = {
  name: "chrome-browser",
  description:
    "Use when controlling explicitly configured Chromium tabs with the browser tool: discovery, claims, inspection, native input, screenshots and handoff. Not for webfetch or browser installation.",
  content: chromeBrowserContent,
}

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      if (process.env.TANDEM_CHROME_CONNECTIONS) {
        draft.source(
          SkillV2.EmbeddedSource.make({
            type: "embedded",
            skill: SkillV2.Info.make({ ...ChromeBrowser, location: AbsolutePath.make("/builtin/chrome-browser.md") }),
          }),
        )
      }
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "customize-opencode",
            description:
              "Use ONLY when the user is editing or creating opencode's own configuration: opencode.json, opencode.jsonc, files under .opencode/, or files under ~/.config/opencode/. Also use when creating or fixing opencode agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring opencode itself.",
            location: AbsolutePath.make("/builtin/customize-opencode.md"),
            content: CustomizeOpencodeContent,
          }),
        }),
      )
    })
  }),
})
