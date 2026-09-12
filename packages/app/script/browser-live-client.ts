import { readFile, writeFile } from "node:fs/promises"

const fixture = JSON.parse(await readFile(process.argv[2]!, "utf8"))
const command = process.argv[3] ?? "open"
const browser = async (...args: string[]) => {
  const child = Bun.spawn(
    [
      process.execPath,
      "x",
      "agent-browser",
      "--namespace",
      process.env.CLIENT_BROWSER_NAMESPACE ?? "phase3-client",
      "--session",
      process.env.CLIENT_BROWSER_SESSION ?? "phase3-client",
      ...(process.env.CLIENT_ELECTRON === "1" ? ["--cdp", "9222"] : []),
      ...args,
    ],
    {
      env: {
        ...process.env,
        ...(process.env.CLIENT_ELECTRON === "1"
          ? {}
          : { AGENT_BROWSER_EXECUTABLE_PATH: "/usr/bin/chromium", AGENT_BROWSER_ARGS: "--no-sandbox" }),
        BUN_INSTALL_CACHE_DIR: "/tmp/tandem/tool-cache",
        AGENT_BROWSER_HOME: "/tmp/tandem/agent-browser",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const output = await new Response(child.stdout).text()
  const error = await new Response(child.stderr).text()
  if (await child.exited) throw new Error(error.replaceAll(fixture.password, "[redacted]"))
  return output
}
if (command === "open") {
  const url = new URL(
    process.env.CLIENT_UI_ORIGIN
      ? fixture.ui.replace(new URL(fixture.ui).origin, process.env.CLIENT_UI_ORIGIN)
      : fixture.ui,
  )
  url.searchParams.set("auth_token", Buffer.from(`${fixture.username}:${fixture.password}`).toString("base64"))
  await browser("open", url.href)
  console.log("Opened isolated source app (authentication omitted).")
} else if (command === "ask") {
  const response = await fetch(new URL("ask", fixture.controls), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ capability: process.argv[4] ?? "read" }),
  })
  console.log(await response.text())
} else if (command === "snapshot") {
  console.log(await browser("snapshot", "-i"))
} else if (command === "screenshot") {
  const destination = `${fixture.root}/${process.argv[4] ?? "client"}.png`
  await browser("screenshot", destination)
  console.log(destination)
} else if (command === "click") {
  console.log(await browser("click", process.argv[4]!))
} else if (command === "decide") {
  await browser(
    "wait",
    "--fn",
    `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(process.argv[4])});if(!b||b.disabled)return false;const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`,
  )
  const snapshot = await browser("snapshot", "-i")
  const candidates = snapshot.split("\n").filter((line) => line.trimStart().startsWith(`- button "${process.argv[4]}"`))
  const topLevel = candidates.filter((line) => line.startsWith("- button"))
  const matches = topLevel.length ? topLevel : candidates
  const ref = matches.length === 1 ? /ref=(e\d+)/.exec(matches[0]!)?.[1] : undefined
  if (!ref) throw new Error("Expected exactly one permission decision button")
  console.log(await browser("click", `@${ref}`))
} else if (command === "press") {
  console.log(await browser("press", process.argv[4]!))
} else if (command === "reload") {
  console.log(await browser("reload"))
} else if (command === "select") {
  const snapshot = await browser("snapshot", "-i")
  const matches = snapshot
    .split("\n")
    .filter((line) => line.trimStart().startsWith('- button "') && line.includes(process.argv[4]!))
  const ref = matches.length === 1 ? /ref=(e\d+)/.exec(matches[0]!)?.[1] : undefined
  if (!ref) throw new Error("Expected one named button")
  console.log(await browser("click", `@${ref}`))
} else if (command === "grant-tab") {
  await browser(
    "wait",
    "--fn",
    "[...document.querySelectorAll('[role=tab]')].some(x=>x.textContent.trim()==='Browser grants')",
  )
  const snapshot = await browser("snapshot", "-i")
  const matches = snapshot.split("\n").filter((line) => line.trimStart().startsWith('- tab "Browser grants"'))
  const ref = matches.length === 1 ? /ref=(e\d+)/.exec(matches[0]!)?.[1] : undefined
  if (!ref) throw new Error("Expected browser grants settings tab")
  console.log(await browser("click", `@${ref}`))
} else if (command === "wait") {
  console.log(await browser("wait", "--fn", process.argv[4]!))
} else if (command === "status") {
  console.log(await (await fetch(new URL("status", fixture.controls))).text())
} else if (command === "cancel") {
  console.log(
    await (
      await fetch(new URL("cancel", fixture.controls), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: process.argv[4] }),
      })
    ).text(),
  )
} else if (command === "eval") {
  console.log(await browser("eval", process.argv[4]!))
} else if (command === "evidence") {
  await writeFile(
    `${fixture.root}/client-evidence.json`,
    await browser(
      "eval",
      "JSON.stringify({url:location.origin+location.pathname,platform:navigator.platform,images:[...document.images].map(i=>({src:i.src.startsWith('blob:')?'blob:':i.src,naturalWidth:i.naturalWidth,naturalHeight:i.naturalHeight})),text:document.body.innerText})",
    ),
    { mode: 0o600 },
  )
}
