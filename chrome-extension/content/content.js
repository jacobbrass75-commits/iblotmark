// Content script — injected into every page
// Handles:
// 1. Getting selection context (surrounding text)
// 2. Visual highlight feedback
// 3. Keyboard shortcut (Ctrl+Shift+S to save selection)

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_SELECTION_CONTEXT") {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const parentText = container.textContent || "";

      // Get ~200 chars of surrounding context
      const selectedText = selection.toString();
      const startIdx = parentText.indexOf(selectedText);
      const contextStart = Math.max(0, startIdx - 100);
      const contextEnd = Math.min(parentText.length, startIdx + selectedText.length + 100);

      sendResponse({
        surroundingText: parentText.substring(contextStart, contextEnd),
        selectedText,
      });
    } else {
      sendResponse({ surroundingText: "", selectedText: "" });
    }
  }
});

// Keyboard shortcut: Ctrl+Shift+S
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === "S") {
    e.preventDefault();
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) {
      chrome.runtime.sendMessage({
        type: "SAVE_SELECTION",
        text: selection.toString(),
        url: window.location.href,
        title: document.title,
      });

      // Visual feedback — brief highlight flash
      showSaveIndicator();
    }
  }
});

function showSaveIndicator() {
  const indicator = document.createElement("div");
  indicator.textContent = "Saved to ScholarMark";
  indicator.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #D4556B;
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    font-family: Inter, system-ui, sans-serif;
    font-size: 14px;
    font-weight: 500;
    z-index: 999999;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    transition: opacity 0.3s ease;
  `;
  document.body.appendChild(indicator);

  setTimeout(() => {
    indicator.style.opacity = "0";
    setTimeout(() => indicator.remove(), 300);
  }, 2000);
}
