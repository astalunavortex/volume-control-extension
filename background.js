browser.tabs.onRemoved.addListener(async (tabId) => {
	await browser.storage.local.remove(`vc_tab_${tabId}`);
});

browser.runtime.onStartup.addListener(cleanupDeadTabs);
browser.runtime.onInstalled.addListener(cleanupDeadTabs);
browser.runtime.onReplaced.addListener(cleanupDeadTabs);

async function cleanupDeadTabs() {
	const allStorage = await browser.storage.local.get();
	const allKeys = Object.keys(allStorage).filter(k => k.startsWith('vc_tab_'))
	const tabIds = allKeys.map(k => parseInt(k.replace('vc_tab_', '')))

	const tabs = await browser.tabs.query({});
	const aliveIds = new Set(tabs.map(t => t.id));

	const deadKeys = allKeys.filter((_, i) => !aliveIds.has(tabIds[i]));
	if (deadKeys.length > 0) {
		await browser.storage.local.remove(deadKeys);
	}
}
