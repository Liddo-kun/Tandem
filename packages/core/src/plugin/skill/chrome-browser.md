# Chrome Browser

Use the configured `browser` tool for Chrome interaction. Do not import the
original JavaScript client, install a runtime, change user configuration, or
substitute another control backend. This skill does not replace `webfetch`.

## Bootstrap

1. Call `browser` with `{"action":"browsers"}` and select the configured browser
   appropriate to the user's request. Configured labels are not verified profile
   identity. Do not silently substitute a different requested browser.
2. Call `browser` with `{"action":"documentation","browser":"<selected ID>"}`.
   **Read the complete returned documentation before the first browser action.**
3. Only if output explicitly reports truncation or the document's end marker is
   missing, reread with `offset` and `limit` (character offsets), consuming all
   remaining content. Do not treat a preview, summary, path, or read receipt as
   the complete document. Use smaller chunks if the configured output budget
   truncates them. Then follow the documented discovery/claim/create workflow.

Reuse the full documentation within the same browser connection and model context;
do not reread merely because a new user turn starts. After compaction/pruning,
read it again if its complete text is no longer in context. A genuine disconnect
or changed browser/model capabilities requires a fresh complete read. A stale or
missing tab, an empty tab list, or a failed locator does not mean disconnected.
Keep the browser selection and obtain a current tab using the documented workflow.

## Recovery

Before retries or setup changes, read the relevant named document using
`{"action":"documentation","browser":"<selected ID>","topic":"<name>"}`:
`bootstrap-troubleshooting` for selection, `chrome-troubleshooting` for connection,
or `browser-troubleshooting` for interaction failures. These static reads work
without connecting, claiming tabs, or granting access. Report persistent failures;
never restart production, clear journals, or take over uncertain ownership.
