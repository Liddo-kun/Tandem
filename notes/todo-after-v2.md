# Todo after v2 implementation

Follow-up work deferred from the [v2 port](archive/v2-port.md).

## Subagents

- [ ] Evaluate v2's subagent features and architecture with Jon after hands-on use. Review cancellation, cleanup, history/resumption and follow-up ergonomics against the old Tandem behavior.
- [ ] Reimplement the enhancements Jon still wants using v2's architecture and extension points.
- [ ] Review Codex's multi-agent instructions (below) with Jon for features worth adding to Tandem's subagents, such as forking a chosen number of turns (`fork_turns`), messaging a running agent without starting a turn (`send_message`), concurrency slots and agents spawning their own agents.

  Captured verbatim from a live trace of Codex CLI 0.160.1 on GPT-6 Astra (2026-10-06, `/tmp/tandem/v2/codex-0.160.1-compaction-requests.jsonl`). Codex sends them as two `developer` messages after the skills list and before `<environment_context>`, and sends them again after a compaction. "4 available concurrency slots" depends on Codex's settings.

  ```text
<multi_agent_role>You are `/root`, the primary agent in a team of agents collaborating to fulfill the user's goals.

At the start of your turn, you are the active agent.
You can spawn sub-agents to handle subtasks, and those sub-agents can spawn their own sub-agents.
All agents in the team, including the agents that you can assign tasks to, are equally intelligent and capable, and have access to the same set of tools.

You can use `spawn_agent` to create a new agent, `followup_task` to give an existing agent a new task and trigger a turn, and `send_message` to pass a message to a running agent without triggering a turn.
`send_message` calls may be read by a human, so ensure they are legible. Always put proper spaces between words and/or numbers.
Child agents can also spawn their own sub-agents.
You can decide how much context you want to propagate to your sub-agents with the `fork_turns` parameter.

You will receive messages in the analysis channel in the form:
```
Message Type: MESSAGE | FINAL_ANSWER
Task name: <recipient>
Sender: <author>
Payload:
<payload text>
```
They may be addressed as to=/root

Note that collaboration tools cannot be called from inside `functions.exec`. Call `spawn_agent`, `send_message`, `followup_task`, `wait_agent`, `interrupt_agent`, and `list_agents` only as direct tool calls using the recipient shown in their tool definitions, such as `to=functions.collaboration.spawn_agent`, since they are intentionally absent from the `functions.exec` `tools.*` namespace. Available tools in `functions.exec` are explicitly described with a `tools` namespace in the developer message.

All agents share the same directory. In detail:
- All agents have access to the same container and filesystem as you.
- All agents use the same current working directory.
- As a result, edits made by one agent are immediately visible to all other agents.

When calling `wait_agent`, prefer longer waits (minutes) to avoid busy polling.

There are 4 available concurrency slots, meaning that up to 4 agents can be active at once, including you.

Full-history forks (`fork_turns` omitted or `"all"`) inherit the parent model and reasoning effort and do not accept overrides. Only set `model` or `reasoning_effort` when explicitly requested by the user, applicable `AGENTS.md` instructions, or skill instructions; when doing so, set `fork_turns` to `"none"` or a positive integer string.</multi_agent_role>
  ```

  ```text
<multi_agent_mode>Any earlier instruction enabling proactive multi-agent delegation no longer applies. Do not spawn sub-agents unless the user or applicable AGENTS.md/skill instructions explicitly ask for sub-agents, delegation, or parallel agent work.</multi_agent_mode>
  ```

## iOS

Jon has no iPhone and has never tested Tandem on iOS.

- [ ] Adapt the existing iOS wrapper's imports/dependencies to v2 using the working Android/shared integration.
- [ ] Wire iOS platform support, native storage and `createBrowserDraftStore`; adapt the native bridge as needed.
- [ ] Build and verify on an actual iOS device when one is available.

## Interactive Chrome bridge

The Codex-desktop-plugin import lives in `packages/chrome-bridge`. At the assessed v2 revision,
upstream's `browser` drives a separate Electron profile and is desktop-only. Reassess its capabilities
and extension points before porting the integration. Browser-backed webfetch remains in the initial port.

- [ ] Register the bridge tool, bootstrap skill and documentation action as a v2 plugin, avoiding a name collision with upstream's `browser` namespace. Reuse the engine adapter, native host, journals, aliases, PNG checks and visible-controls behavior.
- [ ] Integrate runner lifecycle and awaited cleanup through available hooks; assess whether a narrow core hook is necessary.
- [ ] Port per-capability/origin permissions, ask-by-default behavior and request-local dismissal/cancellation. Check public APIs first and bring required permission/schema/client extensions to Jon.
- [ ] Port private expiring screenshots, transient provider hydration and bounded UI display. Reuse upstream media infrastructure where it preserves the required ownership and expiry behavior.
- [ ] Port browser-grant settings and the bounded browser-tool summary renderer.
- [ ] Regenerate shared contracts only where needed and verify real browser workflows and cleanup.

## Queued prompt editing

- [ ] Look for bugs in queued prompt editing and resending.

## Android swipe lock

- [ ] Reproduce Jon's original horizontal tab-strip swipe failure using only native touch input, then verify a fix in Tandem Dev. It happened before WebView debugging was enabled and may relate to the composer's cursor magnifier; its cause remains unconfirmed.
- The later chat-wide lock had a real Chromium `TouchActionFilter` counter imbalance: a finger swipe started with one touch already counted, incremented to two, and ended at one. The page supplied `AUTO`, but the filter retained `NONE`, blocking scrolling while taps worked. An Android touch-cancel did not recover it.
- **Diagnostic contamination found 2026-10-09:** on a freshly restarted development app (WebView 153.0.8010.36), native swipes had balanced counts and reset touch action. A CDP `Input.synthesizeScrollGesture` timed out, and the next native swipe produced two increments and one decrement; subsequent native swipes retained the extra touch. Earlier debugger-generated swipes therefore could have caused the chat-wide lock. Do not treat that trace as proof of the original user-triggered bug or add a scrolling workaround based on it. After restarting development again, native composer cursor swipes and subsequent chat swipes had balanced counts. Scratch evidence: `/tmp/tandem/v2/{dev-baseline,dev-after-cdp,dev-after-cdp-second,native-cursor,native-post-cursor}-trace.json`.

## Webfetch concurrency

- [ ] Jon will compare v1 and v2 browser-fetch concurrency. v2 serializes each whole fetch process-wide
  (`serialized()` in `packages/core/src/plugin/tandem/browser-fetch/cdp-fetch.ts`, no recorded reason;
  its timeout excludes time spent waiting in line). v1 serialized only the browser launch
  (`/home/jon/code/Tandem/packages/opencode/src/plugin/browser-fetch/cdp-fetch.ts`).

## After the switch-over

- [ ] Retire Tandem v1 when Jon no longer needs it: `~/.local/bin/tandem-v1-server`,
  `/usr/local/bin/tandem-v1`, the Tandem v1 app (`ai.opencode.android.v1`) and `~/.local/share/tandem-v1/`
  (about 6 GB including the September database backup). Jon decides when.
