import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { install, restore, status } from "../src/install"
import { HOST_NAME } from "../src/client"

const { values, positionals } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  allowPositionals: true,
  options: {
    root: { type: "string" },
    manifest: { type: "string" },
    binary: { type: "string" },
    id: { type: "string", default: "personal-chromium" },
    label: { type: "string", default: "Personal Chromium" },
  },
})
process.umask(0o077)
const root = resolve(values.root ?? join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share"), "tandem/chrome"))
const command = positionals[0]
if (command === "status") console.log(JSON.stringify(await status(root), null, 2))
else if (command === "restore") console.log(JSON.stringify(await restore(root), null, 2))
else if (command === "install" && values.binary)
  console.log(
    JSON.stringify(
      await install({
        root,
        binary: resolve(values.binary),
        manifest: resolve(
          values.manifest ??
            join(
              process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
              "chromium/NativeMessagingHosts",
              `${HOST_NAME}.json`,
            ),
        ),
        id: values.id!,
        label: values.label!,
      }),
      null,
      2,
    ),
  )
else
  throw new Error(
    "Usage: install.ts install --binary <compiled-host> [--root <private-storage>] [--manifest <registration>] [--id <binding>] [--label <label>] | status --root <storage> | restore --root <storage>",
  )
