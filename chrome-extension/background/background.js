// Service worker — handles:
// 1. Context menu: "Save to ScholarMark" on text selection
// 2. Token management: stores/retrieves JWT from chrome.storage.local
// 3. API calls to ScholarMark backend

const API_BASE = "http://localhost:5001"; // Changed to production URL later

// Create context menu on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "save-to-scholarmark",
    title: "Save to ScholarMark",
    contexts: ["selection"]
  });
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "save-to-scholarmark" && info.selectionText) {
    const token = await getToken();
    if (!token) {
      // Open popup to prompt login
      chrome.action.openPopup();
      return;
    }

    // Get page metadata
    const pageUrl = tab.url;
    const pageTitle = tab.title;

    // Send to content script to get more context
    chrome.tabs.sendMessage(tab.id, {
      type: "GET_SELECTION_CONTEXT",
    }, async (response) => {
      const annotation = {
        highlightedText: info.selectionText,
        pageUrl,
        pageTitle,
        context: response?.surroundingText || "",
        timestamp: new Date().toISOString(),
      };

      await saveAnnotation(annotation, token);
    });
  }
});

async function getToken() {
  const result = await chrome.storage.local.get("sm_token");
  return result.sm_token || null;
}

async function saveAnnotation(annotation, token) {
  try {
    // Include selected project if one is set
    const { sm_project } = await chrome.storage.local.get("sm_project");
    if (sm_project) {
      annotation.projectId = sm_project;
    }

    const response = await fetch(`${API_BASE}/api/extension/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(annotation),
    });

    if (response.ok) {
      // Notify user
      chrome.notifications?.create({
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: "ScholarMark",
        message: "Highlight saved to your project!",
      });
    } else if (response.status === 401) {
      // Token expired
      await chrome.storage.local.remove("sm_token");
      chrome.action.openPopup();
    }
  } catch (error) {
    console.error("Failed to save annotation:", error);
  }
}

// Listen for messages from popup/content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "LOGIN") {
    handleLogin(message.email, message.password).then(sendResponse);
    return true; // async response
  }
  if (message.type === "LOGOUT") {
    chrome.storage.local.remove("sm_token");
    sendResponse({ success: true });
  }
  if (message.type === "GET_PROJECTS") {
    getProjects().then(sendResponse);
    return true;
  }
  if (message.type === "SAVE_SELECTION") {
    handleSaveSelection(message).then(sendResponse);
    return true;
  }
});

async function handleLogin(email, password) {
  try {
    const response = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (response.ok) {
      const data = await response.json();
      await chrome.storage.local.set({ sm_token: data.token, sm_user: data.user });
      return { success: true, user: data.user };
    }
    return { success: false, error: "Invalid credentials" };
  } catch (error) {
    return { success: false, error: "Connection failed" };
  }
}

async function getProjects() {
  const token = await getToken();
  if (!token) return { success: false, error: "Not logged in" };

  try {
    const response = await fetch(`${API_BASE}/api/projects`, {
      headers: { "Authorization": `Bearer ${token}` },
    });

    if (response.ok) {
      const projects = await response.json();
      return { success: true, projects };
    }
    return { success: false, error: "Failed to fetch projects" };
  } catch (error) {
    return { success: false, error: "Connection failed" };
  }
}

async function handleSaveSelection(message) {
  const token = await getToken();
  if (!token) return { success: false, error: "Not logged in" };

  const { sm_project } = await chrome.storage.local.get("sm_project");

  const annotation = {
    highlightedText: message.text,
    pageUrl: message.url,
    pageTitle: message.title,
    context: "",
    projectId: sm_project || undefined,
    timestamp: new Date().toISOString(),
  };

  try {
    const response = await fetch(`${API_BASE}/api/extension/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(annotation),
    });

    if (response.ok) {
      return { success: true };
    } else if (response.status === 401) {
      await chrome.storage.local.remove("sm_token");
      return { success: false, error: "Token expired" };
    }
    return { success: false, error: "Save failed" };
  } catch (error) {
    return { success: false, error: "Connection failed" };
  }
}
