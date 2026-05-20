

let updateTimeout = null;

// Dynamically generate the context menu based on your live tabs
function updateContextMenu() {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: "convert-parent",
            title: "Move other tab into Peek",
            contexts: ["page"] 
        });

        chrome.tabs.query({currentWindow: true}, (tabs) => {
            let hasValidTabs = false;
            tabs.forEach(tab => {
                if (!tab.active && tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("edge://") && !tab.url.startsWith("about:")) {
                    hasValidTabs = true;
                    let title = tab.title || tab.url || "New Tab";
                    if (title.length > 40) title = title.substring(0, 40) + '...'; 
                    
                    chrome.contextMenus.create({
                        id: `convert-tab-${tab.id}`,
                        parentId: "convert-parent",
                        title: title,
                        contexts: ["page"]
                    });
                }
            });
            
            if (!hasValidTabs) {
                chrome.contextMenus.create({
                    id: "no-tabs",
                    parentId: "convert-parent",
                    title: "No other valid tabs open",
                    contexts: ["page"],
                    enabled: false
                });
            }
        });
    });
}

function debouncedUpdateContextMenu() {
    clearTimeout(updateTimeout);
    updateTimeout = setTimeout(updateContextMenu, 250);
}

// SECURITY FIX: Centralized garbage collection for temporary session rules
function clearSessionRules(tabId = null) {
    if (tabId !== null) {
        chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] });
    } else {
        // Clear all session rules on startup/install to prevent leakage
        chrome.declarativeNetRequest.getSessionRules((rules) => {
            const ruleIds = rules.map(rule => rule.id);
            if (ruleIds.length > 0) chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ruleIds });
        });
    }
}

chrome.tabs.onCreated.addListener(debouncedUpdateContextMenu);
chrome.tabs.onRemoved.addListener((tabId) => {
    clearSessionRules(tabId); // Scrub the rule when the tab is closed
    debouncedUpdateContextMenu();
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.title || changeInfo.url) debouncedUpdateContextMenu();
});
chrome.tabs.onActivated.addListener(debouncedUpdateContextMenu);

chrome.runtime.onInstalled.addListener(() => {
    clearSessionRules();
    updateContextMenu();
});
chrome.runtime.onStartup.addListener(() => {
    clearSessionRules();
    updateContextMenu();
});

// Handle Context Menu Clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId.startsWith("convert-tab-")) {
        const targetTabId = parseInt(info.menuItemId.replace("convert-tab-", ""));
        
        chrome.tabs.get(targetTabId, (targetTab) => {
            if (targetTab && targetTab.url) {
                chrome.tabs.sendMessage(tab.id, { 
                    action: "openPeekCentered", 
                    url: targetTab.url 
                });
                chrome.tabs.remove(targetTabId);
            }
        });
    }
});

// Primary Message Bus
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    
    // =========================================================
    // SECURITY: Dynamic Session Scoped Header Stripping
    // =========================================================
    if (request.action === "enable_bypass") {
        const tabId = sender.tab.id;
        chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds: [tabId], 
            addRules: [{
                id: tabId, 
                priority: 1,
                action: {
                    type: "modifyHeaders",
                    responseHeaders: [
                        { header: "x-frame-options", operation: "remove" },
                        { header: "frame-options", operation: "remove" },
                        { header: "content-security-policy", operation: "remove" }
                    ]
                },
                condition: {
                    tabIds: [tabId], // brilliant security: scoped only to the active tab!
                    resourceTypes: ["sub_frame"] // Removed xmlhttprequest, narrowed to just iframes!
                }
            }]
        }).then(() => { if (sendResponse) sendResponse({success: true}); });
        return true; 
    }

    if (request.action === "disable_bypass") {
        clearSessionRules(sender.tab.id);
        if (sendResponse) sendResponse({success: true});
        return true;
    }

    // =========================================================
    // Existing Drag-To-Tab Logic
    // =========================================================
    if (request.action === 'peekToTab') {
        chrome.windows.get(sender.tab.windowId, {populate: true}, (win) => {
            const tabs = win.tabs;
            let targetIndex = Math.round((request.dropX / request.screenWidth) * tabs.length);
            
            chrome.tabs.create({ 
                url: request.url, 
                index: targetIndex, 
                windowId: sender.tab.windowId,
                active: true
            });
        });
    }
});