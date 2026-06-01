# Tandem Android Reliability Investigation

Date: 2026-05-26

Purpose: handoff notes for a fresh session. Jon reported that the Tandem Android app becomes stuck during OpenCode turns. He often has to interrupt with "hello?" or restart the `opencode web` server and the Android app. The question was whether the cause is the OpenCode web server, Android app, separate-device LAN access, Tandem customizations, or upstream OpenCode behavior.

Important instruction from Jon during this investigation: do not make code changes unless explicitly asked. This file was explicitly requested as a handoff document.

## Current Working State

The Tandem repo at `C:\Users\Jon\Tandem` is currently in a merge/conflict state.

Observed with `git status --short --branch`:

```text
## dev...origin/dev [ahead 472]
UU packages/app/src/components/prompt-input.tsx
UU packages/app/src/components/session/session-header.tsx
UU packages/app/src/context/directory-sync.ts
UD packages/app/src/context/global-sdk.tsx
UU packages/app/src/context/sync.tsx
UU packages/app/src/pages/session/message-timeline.tsx
```

There are many staged files from an upstream sync or merge. The conflicted files are in the shared app/session path that the Android APK depends on. This means the local source tree is not a clean baseline for debugging until conflicts are resolved. The installed Android app and running server may have been built from an earlier state.

## Running Server And Device

Running relevant processes showed:

```text
opencode.exe 17272 "C:\Program_Files\opencode.exe" web --hostname 0.0.0.0 --port 4096
opencode.exe 6864 C:\Program_Files\opencode.exe
node.exe 21064 node "C:\Users\Jon\tandem-trace\tandem-trace.mjs" --opencode "C:\Program_Files\opencode.exe"
adb.exe 1996 adb -L tcp:5037 fork-server server --reply-fd 796
```

The web server was listening on `0.0.0.0:4096`.

PC LAN address:

```text
Ethernet 192.168.1.70/24
```

Android device from ADB:

```text
adb-HA28HF30-cGyG7x._adb-tls-connect._tcp device product:TB322FC_PRC model:TB322FC device:TB322FC
```

Android WiFi address:

```text
192.168.1.85/24 on wlan0
```

Focused Android app at the time:

```text
ai.opencode.android.test8/com.devgriffin.whispercode.MainActivity
```

Installed metadata for that side-by-side test app:

```text
package: ai.opencode.android.test8
versionName: 1.2.6
versionCode: 1002006
lastUpdateTime: 2026-05-24 04:27:09
```

The server reported:

```text
Network access: http://192.168.1.70:4096
MaxListenersExceededWarning: Possible EventTarget memory leak detected. 11 event listeners added to [HL]. MaxListeners is undefined. Use events.setMaxListeners() to increase limit
type: "event"
count: 11
```

## Connectivity Checks

From the PC:

```text
GET http://127.0.0.1:4096/global/health
{"healthy":true,"version":"0.0.0-dev-202605211852"}
```

From the PC to its LAN address:

```text
GET http://192.168.1.70:4096/global/health
{"healthy":true,"version":"0.0.0-dev-202605211852"}
```

From the Android device through ADB shell:

```text
adb shell "curl --connect-timeout 3 --max-time 5 -sS http://192.168.1.70:4096/global/health"
{"healthy":true,"version":"0.0.0-dev-202605211852"}
```

The Android device can reach the OpenCode server over WiFi. This makes basic firewall, server binding, and LAN reachability less likely as the root cause.

## Event Stream Checks

The shared app and Android wrapper use the app's server SDK path to connect to the OpenCode server. Important files:

```text
packages/android/src/entry-android.tsx
packages/android/src/bridge.ts
packages/android/src/storage.ts
packages/app/src/context/server.tsx
packages/app/src/context/platform.tsx
packages/app/src/context/server-sdk.tsx
packages/app/src/context/server-sync.tsx
packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts
packages/opencode/src/bus/global.ts
```

The app opens `/global/event`, an SSE stream. The server sends `server.connected` immediately and `server.heartbeat` every 10 seconds.

PC sample:

```text
curl.exe --no-buffer --max-time 25 http://127.0.0.1:4096/global/event
data: {"payload":{"id":"...","type":"server.connected","properties":{}}}
data: {"payload":{"id":"...","type":"server.heartbeat","properties":{}}}
data: {"payload":{"id":"...","type":"server.heartbeat","properties":{}}}
```

LAN sample from PC to `192.168.1.70` also received `server.connected` and `server.heartbeat`.

Android-side sample through ADB shell also received the event stream. During an active turn, Android received a large stream of events, not a dead connection.

Conclusion: the event stream is reachable and active. The stuck behavior is more likely event volume, event parsing, listener buildup, app state handling, or WebView overload than basic network failure.

## Huge Event Payload Finding

During a 15-second Android-side SSE sample:

```text
adb shell "curl --no-buffer --max-time 15 -sS http://192.168.1.70:4096/global/event"
```

The tool output was saved by OpenCode at:

```text
C:\Program_Files\Data\opencode\tool-output\tool_e64c11270001ujzaALlfwAFmfg
```

Summary of that saved output:

```json
{
  "Bytes": 6205874,
  "Events": 255,
  "LargestEventBytes": 6105422,
  "Summary": [
    { "Count": 230, "Name": "message.part.delta" },
    { "Count": 5, "Name": "message.part.updated" },
    { "Count": 5, "Name": "sync:message.part.updated.1" },
    { "Count": 3, "Name": "message.updated" },
    { "Count": 3, "Name": "sync:message.updated.1" },
    { "Count": 2, "Name": "session.status" },
    { "Count": 2, "Name": "session.updated" },
    { "Count": 2, "Name": "sync:session.updated.1" },
    { "Count": 1, "Name": "server.connected" },
    { "Count": 1, "Name": "server.heartbeat" },
    { "Count": 1, "Name": "session.diff" }
  ]
}
```

The largest event was a single `session.diff` event of about 6.1 MB.

That `session.diff` contained:

```json
{
  "Files": 258,
  "TotalPatchBytes": 5705759
}
```

Largest diff entries included:

```text
bun.lock                                           908015 patch bytes
packages/sdk/openapi.json                         645918 patch bytes
packages/sdk/js/src/v2/gen/types.gen.ts           161973 patch bytes
packages/app/src/components/prompt-input.tsx       98714 patch bytes
packages/app/src/pages/layout.tsx                  95825 patch bytes
packages/ui/src/components/message-part.tsx        83340 patch bytes
packages/opencode/src/cli/cmd/tui/routes/session/index.tsx 82893 patch bytes
packages/opencode/test/session/prompt.test.ts      81070 patch bytes
packages/opencode/src/session/prompt.ts            73250 patch bytes
packages/app/src/pages/session/message-timeline.tsx 67642 patch bytes
```

This is the strongest concrete suspect found so far. Even if Tandem's mobile UI later limits review rendering, the Android WebView still has to receive, buffer, parse, and route the huge JSON event first.

## MaxListeners Warning Finding

The warning from the web server is relevant:

```text
MaxListenersExceededWarning: Possible EventTarget memory leak detected. 11 event listeners added to [HL]
type: "event"
count: 11
```

Relevant code:

```text
packages/opencode/src/bus/global.ts
packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts
```

`packages/opencode/src/bus/global.ts` creates a singleton EventEmitter:

```ts
export const GlobalBus = new GlobalBusEmitter()
```

`packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts` adds one `GlobalBus.on("event", handler)` listener per `/global/event` SSE connection and is intended to remove it on disconnect:

```ts
const events = Stream.callback<GlobalBusEvent>((queue) => {
  const handler = (event: GlobalBusEvent) => Queue.offerUnsafe(queue, event)
  return Effect.acquireRelease(
    Effect.sync(() => GlobalBus.on("event", handler)),
    () => Effect.sync(() => GlobalBus.off("event", handler)),
  )
})
```

`count: 11` means the server had at least 11 active listeners on the global event bus. In plain terms, the server believed there were at least 11 active global event subscribers.

Likely explanations:

1. Android/WebView reconnects are opening new `/global/event` streams before old ones fully close.
2. Multiple app or browser windows are connected at once.
3. Background/resume behavior creates duplicate event streams.
4. The server-side SSE cleanup path is not reliably removing `GlobalBus` listeners.

This warning should not be fixed by simply increasing max listeners. Raising the limit would hide the warning but would not fix duplicate streams or excessive event fan-out.

Why this matters: if one `session.diff` event is 6.1 MB and there are many event listeners, every published event is being fanned out to all of them. Even if some are stale connections, they can consume server memory/CPU and make the Android app or server appear stuck.

## Upstream Versus Tandem

The full `session.diff` event behavior appears to be upstream OpenCode behavior, not obviously Tandem-specific.

Read-only check against `upstream/dev` showed upstream also has this pattern in `packages/opencode/src/session/summary.ts`:

```ts
yield* storage.write(["session_diff", input.sessionID], diffs).pipe(Effect.ignore)
yield* bus.publish(Session.Event.Diff, { sessionID: input.sessionID, diff: diffs })
```

And upstream also defines `Session.Event.Diff` with the full diff array in `packages/opencode/src/session/session.ts`:

```ts
Diff: BusEvent.define(
  "session.diff",
  Schema.Struct({
    sessionID: SessionID,
    diff: Schema.Array(Snapshot.FileDiff),
  }),
)
```

This suggests the giant diff event is native to OpenCode's current server design. Tandem's mobile app is more exposed to it because Android WebView is weaker than desktop Chrome and the app also has mobile resume/reconnect behavior.

The listener buildup may be Tandem-specific, upstream-specific, or caused by how Android WebView handles SSE connections. It needs a controlled test.

## Mobile-Specific Existing Mitigation

Tandem already has a mobile review rendering limit:

```text
packages/app/src/utils/mobile-review-limit.ts
MOBILE_REVIEW_FILE_LIMIT = 100
```

This protects rendering large review panels, but it does not prevent the server from sending a huge `session.diff` event over SSE. The app receives and parses the event before UI rendering limits can help.

Relevant shared-app code paths:

```text
packages/app/src/context/server-sdk.tsx
packages/app/src/context/server-sync.tsx
packages/app/src/context/global-sync/event-reducer.ts
packages/app/src/pages/session.tsx
packages/app/src/utils/mobile-review-limit.ts
```

`server-sdk.tsx` has heartbeat/reconnect logic for the SSE stream. It aborts the attempt if no event arrives within 15 seconds and reconnects. This is intended to recover from stale streams, but if cleanup is delayed or not happening, it could contribute to listener buildup.

## Working Hypothesis

Most likely failure chain:

1. Android app opens `/global/event` SSE stream to the OpenCode web server.
2. During active use, especially in a large dirty repo or merge state, the server publishes a large `session.diff` event.
3. Android WebView must receive and parse multi-megabyte JSON on the main web runtime path.
4. The UI stalls or becomes slow enough that Jon thinks the turn is stuck.
5. Android background/resume or manual app/server restarts cause repeated reconnects.
6. Old `/global/event` listeners may remain attached or multiple clients remain connected, causing `MaxListenersExceededWarning` and amplifying the next event burst.

This fits all observed evidence better than pure WiFi failure.

## Things Not Yet Proven

Not proven yet:

1. Whether stale `/global/event` listeners actually remain after Android app close/restart.
2. Whether the listener count drops after the app is force-stopped.
3. Whether official upstream OpenCode web UI on the same Android device gets stuck the same way.
4. Whether the installed `ai.opencode.android.test8` APK contains the same code as current source.
5. Whether Android WebView logs show renderer stalls, ANRs, or out-of-memory events at the exact stuck moment.
6. Whether the 6 MB `session.diff` event alone is enough to reproduce the stall on a clean session.

## Suggested Next Read-Only Diagnostics

If picking this up in a fresh session and still avoiding code changes, start here.

1. Confirm active clients before and after opening Android.

```powershell
Get-NetTCPConnection -LocalPort 4096 | Select-Object State,LocalAddress,LocalPort,RemoteAddress,RemotePort,OwningProcess | Sort-Object State,RemoteAddress,RemotePort | Format-Table -AutoSize
```

2. Force-stop the Android app and see if listeners/connections drop without restarting the server.

```powershell
adb shell am force-stop ai.opencode.android.test8
Get-NetTCPConnection -LocalPort 4096 | Select-Object State,RemoteAddress,RemotePort,OwningProcess | Format-Table -AutoSize
```

3. Reopen the app and watch whether each foreground/background cycle adds another connection or another warning.

```powershell
adb shell monkey -p ai.opencode.android.test8 1
```

4. Capture Android logs during a stuck turn.

```powershell
adb logcat -c
# reproduce stuck behavior
adb logcat -d -t 2000 | Select-String -Pattern 'chromium|crash|ANR|FATAL|OpenCode|opencode|whispercode|Tauri|WebView|Skipped|GC|low memory|renderer'
```

5. Sample `/global/event` during a problem turn and summarize event sizes.

```powershell
curl.exe --silent --no-buffer --max-time 15 http://127.0.0.1:4096/global/event --output C:\Temp\opencode\sse-sample.txt
$text = Get-Content -LiteralPath C:\Temp\opencode\sse-sample.txt -Raw
$lines = @($text -split "`r?`n" | Where-Object { $_.StartsWith('data: ') })
$items = foreach ($line in $lines) { try { ($line.Substring(6) | ConvertFrom-Json) } catch {} }
$items | ForEach-Object { if ($_.payload.type -eq 'sync') { 'sync:' + $_.payload.syncEvent.type } else { $_.payload.type } } | Group-Object | Sort-Object Count -Descending
$lines | Sort-Object Length -Descending | Select-Object -First 10 @{n='Bytes';e={$_.Length}}, @{n='Prefix';e={$_.Substring(0,[Math]::Min(180,$_.Length))}}
```

6. Compare Android against desktop browser using the same server and same session. If desktop stays responsive while Android stalls on the same event burst, focus on Android/WebView payload handling.

7. After repo conflicts are resolved, build a clean APK and retest. Current source is not a clean diagnostic baseline.

## Likely Fix Directions Once Code Changes Are Allowed

Do not start here unless Jon asks for code changes. These are candidate directions only.

1. Do not broadcast full `session.diff` patch content over `/global/event`. Broadcast a small invalidation event or a summary, then let clients fetch the full diff only when needed.

2. For mobile clients, avoid processing `session.diff` events above a safe size or file count. The server could include only counts or a truncated diff for mobile. This needs careful API compatibility thought.

3. Investigate SSE cleanup for `/global/event`. Confirm `GlobalBus.off("event", handler)` runs when Android WebView drops or reconnects. Add temporary logging if needed.

4. Add client-side guardrails in `server-sdk.tsx` so repeated reconnects cannot leave more than one active event stream per app instance.

5. Consider filtering legacy duplicate `sync` events from the app if they are no longer needed by the current shared UI. The Android sample showed both modern events and `sync:*` duplicates.

6. Add instrumentation rather than immediately changing behavior: log event stream open/close with a connection id and current `GlobalBus.listenerCount("event")`.

## Bottom Line

The strongest finding is not basic network failure. The Android device can reach the server and receives SSE events. The strongest concrete suspects are:

1. Huge `session.diff` events, including one observed 6.1 MB event, overwhelming Android WebView.
2. `/global/event` listener buildup, shown by `MaxListenersExceededWarning` at 11 listeners.
3. Android resume/reconnect behavior possibly creating duplicate event streams or delaying cleanup.
4. The current repo conflict state and large dirty merge producing unusually huge diffs that make the issue much easier to trigger.

Any fresh session should start by proving or disproving listener cleanup and giant event payload impact before changing Android UI details.
