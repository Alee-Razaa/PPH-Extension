// Classic content script (SPEC 6, 25.6). Its only job is to load the ES module graph.
// Every module it reaches must be listed in web_accessible_resources.
(async () => {
  try {
    const { start } = await import(chrome.runtime.getURL('content/main.js'));
    await start();
  } catch (error) {
    console.warn(
      '[PPH Job Radar] content failed to start. If this is a module fetch error, see SPEC 6 on use_dynamic_url.',
      error
    );
  }
})();
