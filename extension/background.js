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
    handleScrapedData(message.data)
      .then(() => sendResponse({ success: true }))
      .catch((err) => {
        console.error("Failed to store scraped data:", err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep message channel open for async response
  }

  if (message.type === "TRIGGER_SCRAPE") {
    handleTriggerScrape()
      .then(() => sendResponse({ success: true }))
      .catch((err) => {
        console.error("Failed to execute content script:", err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }
});

/**
 * Store scraped data with smart merging.
 * When multiple frames send results (via allFrames), this accumulates real
 * questions and avoids overwriting good data with empty results.
 */
async function handleScrapedData(newData) {
  const existing = await chrome.storage.session.get("scrapedData");
  const prev = existing ? existing.scrapedData : null;

  const newRealQs = (newData.questions || []).filter((q) => q.type !== "full-page");
  const prevRealQs = prev ? (prev.questions || []).filter((q) => q.type !== "full-page") : [];

  let dataToStore;

  if (newRealQs.length > 0 && prevRealQs.length > 0) {
    // Merge questions coming from different frames
    dataToStore = {
      url: newData.url || prev.url,
      title: newData.title || prev.title,
      questions: prev.questions.concat(newData.questions),
      timestamp: newData.timestamp
    };
  } else if (newRealQs.length > 0) {
    dataToStore = newData;
  } else if (prevRealQs.length > 0) {
    // Previous data already has real questions — keep it
    return;
  } else {
    // Neither has real questions — store latest (may be a full-page fallback)
    dataToStore = newData;
  }

  await chrome.storage.session.set({ scrapedData: dataToStore });
}

/**
 * Clear stale data and inject content script into the active tab.
 * Uses allFrames to also scrape inside iframes (e.g., Cisco NetAcad, Canvas).
 */
async function handleTriggerScrape() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) throw new Error("No active tab found");

  // Clear previous scrape data so the side panel detects the fresh results
  await chrome.storage.session.remove("scrapedData");

  await chrome.scripting.executeScript({
    target: { tabId: tabs[0].id, allFrames: true },
    files: ["content.js"]
  });
}
