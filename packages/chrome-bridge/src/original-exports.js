// Appended by script/import-original.ts to the pinned installed service bundle.
// These are the original engine and command implementations, not reimplementations.
// Host policy/transport/lifecycle belong to the caller, not to Codex's REPL.
// Static bundled documents only: no browser, filesystem fallback or remote overrides.
export function browserDocumentationSource() {
  return Vi;
}

export function selectBrowserDocuments(supportedMembers) {
  const disabledApiMembers = new Set();
  for (const [name, members] of Object.entries(Vi.apiManifest.interfaces))
    for (const member of Object.keys(members))
      if (!supportedMembers.includes(`${name}.${member}`)) disabledApiMembers.add(`${name}.${member}`);
  return kB(Vi.documentManifest, {
    browserType: "extension",
    capabilities: { browser: [], tab: [] },
    disabledApiMembers,
  });
}

export function createBrowserEngine(api, browserId, info, runtime, config) {
  // Tandem's managed image channel currently accepts PNG only. Keep the original
  // screencast/capture implementation; change only its requested encoding.
  hr = "png";
  const context = new Km(api, browserId, info, {
    runtime,
    config,
    commandTiming: _M,
    performanceSpan: CM,
    filesystem: J2,
    elicitationDisplayName: "Tandem browser",
  });
  return {
    context,
    async execute(type, params) {
      const command = WB.find((command) => command.type === type);
      if (!command) throw new Error(`Original browser command is unavailable: ${type}`);
      // The host has already authorized navigation; the original awaits this promise.
      if (type === "navigate_tab_url") return await command(params, context, Promise.resolve());
      return await command(params, context);
    },
    async input(params, action) {
      const run = async (playwright, selector) => {
        const ctx = Object.create(context, { playwright: { value: playwright } });
        const args = { ...params, selector };
        if (action === "press") return await cu(args, ctx);
        if (params.replace === false) {
          await playwright.evaluateOnPlaywrightSelectorWithTarget(params.tab_id, selector, (node, injected) => {
            const input = injected.retarget(node, "follow-label");
            for (const state of ["visible", "enabled", "editable"])
              if (!injected.elementState(input, state).matches) throw new Error(`Element is not ${state}`);
            input.scrollIntoView({ block: "center", inline: "nearest" });
            const focused = injected.focusNode(input, false);
            if (focused !== "done") throw new Error(String(focused));
            if (input.isContentEditable) {
              const range = input.ownerDocument.createRange();
              range.selectNodeContents(input);
              range.collapse(false);
              const selection = input.ownerDocument.defaultView.getSelection();
              selection.removeAllRanges();
              selection.addRange(range);
            } else if (input.selectionStart != null) {
              input.setSelectionRange(input.value.length, input.value.length);
            }
          });
        }
        const result = await im(args, ctx);
        // Original paste ignores empty text; original fill has already selected it.
        if (params.replace !== false && params.value === "")
          await cu({ ...args, value: "Backspace" }, ctx);
        return result;
      };
      if (params.node_id == null)
        return await context.playwright.withBoundPlaywrightSelector(
          params.tab_id, params.selector, async () => true,
          (playwright) => run(playwright, params.selector),
        );
      const node = TI(H(params.tab_id), Yp(params.node_id, "Tandem input"));
      const handle = await nu(context.cdp, node.target, node.frameId, node.loaderId,
        `(() => { const node = globalThis.__browserUseVisibleDomState?.refToElement.get(${JSON.stringify(node.localRef)}); if (!node?.isConnected) throw new Error("DOM node is stale or missing"); return node; })()`,
        { returnByValue: false });
      if (handle.exceptionDetails || !handle.result?.objectId) throw new Error("DOM node is stale or missing");
      let backendNodeId;
      try {
        ({ node: { backendNodeId } } = await context.cdp.callTarget(node.target, "DOM.describeNode", { objectId: handle.result.objectId }));
      } finally {
        await context.playwright.releaseRuntimeObjects(node.target, [handle.result.objectId], {});
      }
      return await context.playwright.withPlaywrightNode(
        { backendNodeId, frameId: node.frameId, target: node.target, oopifFrameChain: [] },
        async (objectId, executionContextId) => {
          const selector = `tandem-live-ref:${params.node_id}`;
          const playwright = Object.create(context.playwright, { boundSelector: { value: {
            selector, objectId, executionContextId, target: node.target, oopifFrameChain: [],
          } } });
          return await run(playwright, selector);
        },
      );
    },
    async cleanup(tabId) {
      await context.clipboard.cleanupPageClipboards();
      await context.cdp.detachTab(tabId);
    },
    dispose() {
      context.removeCloseListener();
      context.removeTabAttachHandler?.();
      context.api.detachTurn = undefined;
      context.ax.dispose();
      context.clipboard.dispose();
      for (const [event, listeners] of Object.entries(context.cdp.listeners))
        for (const listener of [...listeners]) context.cdp.removeListener(event, listener);
      context.cdp.tabAttachHandlers.clear();
      context.cdp.tabCleanupHandlers.clear();
    },
  };
}
