# Provenance

Upstream author: OpenAI.
Upstream desktop/plugin version: 26.901.51231.
Source: https://persistent.oaistatic.com/codex-app-prod/linux/deb/latest/chatgpt_arm64.deb
Official download documentation: https://learn.chatgpt.com/docs/linux/linux-app

Copied from the previously extracted `plugins/openai-bundled/plugins/chrome` and `cua_node` directories. The desktop app was not installed or launched. Bundled runtime files are preserved; local browser-service changes are documented below; no credentials, browser profiles, or user configuration are bundled.

Local additions: native Codex plugin/MCP manifests, runtime launcher, this README/provenance, and packaged runtime directory. The inline upstream Stop hook is stored at hooks/hooks.json. The skill bootstrap identifies the plugin-bundled server and removes reliance on global MCP registration.

OpenAI browser code remains proprietary as declared in its upstream manifest. Existing third-party licenses are retained alongside their modules. This local copy is not an official OpenAI standalone distribution.

Local browser-service patch: horizontal and diagonal CUA scrolling uses the existing CDP mouse-wheel branch instead of synthesizing a swipe gesture, to avoid accidental browser history navigation. Pure vertical scrolling retains upstream behavior. Documentation cleanup is mirrored into the service’s embedded documentation. `tests/scroll-dispatch.mjs` checks the shipped scroll method after upstream updates.
