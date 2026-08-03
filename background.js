browser.tabs.onRemoved.addListener(async (tabId) => {
    await browser.storage.local.remove(`vc_tab_${tabId}`);
});
