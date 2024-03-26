async function resetUIInTabs() {
    let tabs = await browser.tabs.query({});
    for (let t of tabs) {
	try {
            await browser.tabs.sendMessage(t.id, "restart");
	} catch(e) {
            // Extension can only send messages to tabs with a content script
	}
    }
}
resetUIInTabs();
