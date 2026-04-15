// Background service worker for Jaat's Assistant
// Handles side panel lifecycle and message routing

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (err) {
    console.error("Failed to open side panel:", err);
  }
});

// Set side panel behavior — open on action click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error("Failed to set panel behavior:", err));

// Listen for messages from content script and relay to side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SCRAPED_DATA") {
    // Store scraped data so the side panel can retrieve it
    chrome.storage.session.set({ scrapedData: message.data })
      .then(() => sendResponse({ success: true }))
      .catch((err) => {
        console.error("Failed to store scraped data:", err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep message channel open for async response
  }

  if (message.type === "TRIGGER_SCRAPE") {
    // Side panel requests a scrape — inject and run content script on the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]) {
        sendResponse({ success: false, error: "No active tab found" });
        return;
      }
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          files: ["content.js"]
        });
        sendResponse({ success: true });
      } catch (err) {
        console.error("Failed to execute content script:", err);
        sendResponse({ success: false, error: err.message });
      }
    });
    return true;
  }
});
