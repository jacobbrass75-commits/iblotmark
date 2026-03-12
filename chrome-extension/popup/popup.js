// Popup logic — handles login state and project selection

document.addEventListener("DOMContentLoaded", async () => {
  const loginView = document.getElementById("login-view");
  const mainView = document.getElementById("main-view");
  const loginForm = document.getElementById("login-form");
  const loginError = document.getElementById("login-error");
  const userInfo = document.getElementById("user-info");
  const projectSelect = document.getElementById("project-select");
  const openAppBtn = document.getElementById("open-app");
  const logoutBtn = document.getElementById("logout-btn");

  // Check if logged in
  const { sm_token, sm_user } = await chrome.storage.local.get(["sm_token", "sm_user"]);

  if (sm_token && sm_user) {
    showMainView(sm_user);
  } else {
    showLoginView();
  }

  function showLoginView() {
    loginView.style.display = "block";
    mainView.style.display = "none";
  }

  function showMainView(user) {
    loginView.style.display = "none";
    mainView.style.display = "block";
    userInfo.textContent = `${user.username || user.email}${user.tier ? ` (${user.tier})` : ""}`;
    loadProjects();
  }

  async function loadProjects() {
    const response = await chrome.runtime.sendMessage({ type: "GET_PROJECTS" });
    if (response.success) {
      projectSelect.innerHTML = '<option value="">Select project...</option>';
      response.projects.forEach((p) => {
        const option = document.createElement("option");
        option.value = p.id;
        option.textContent = p.name;
        projectSelect.appendChild(option);
      });

      // Restore last selected project
      const { sm_project } = await chrome.storage.local.get("sm_project");
      if (sm_project) {
        projectSelect.value = sm_project;
      }
    }
  }

  projectSelect.addEventListener("change", () => {
    chrome.storage.local.set({ sm_project: projectSelect.value });
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    loginError.textContent = "";
    const response = await chrome.runtime.sendMessage({
      type: "LOGIN",
      email,
      password,
    });

    if (response.success) {
      showMainView(response.user);
    } else {
      loginError.textContent = response.error;
    }
  });

  openAppBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: "http://localhost:5001" });
  });

  logoutBtn.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "LOGOUT" });
    showLoginView();
  });
});
