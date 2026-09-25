const modal = document.getElementById("moneyModal");
const landing = document.getElementById("landingView");
const auth = document.getElementById("authView");
const onboarding = document.getElementById("onboardingView");
const app = document.getElementById("appView");
let authMode = "login";
let onboardingStep = 1;
const themeToggle = document.getElementById("themeToggle");
let paymentSessionId = null;
let paymentMethod = "card";
const supportedCurrencies = ["USD", "EUR", "GBP", "NGN", "CAD", "AUD", "JPY", "CHF", "AED"];
const formatNaira = (amount) => `₦${Number(amount).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatCurrency = (amount, currency = "USD") => {
  const normalized = String(currency || "USD").toUpperCase();
  const safeCurrency = supportedCurrencies.includes(normalized) ? normalized : "USD";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: safeCurrency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount || 0));
};
const apiBase = window.location.port === "3000" ? "" : "http://localhost:3000";
const apiFetch = (url, options = {}) => fetch(`${apiBase}${url}`, { ...options, credentials: "include" });
let currentUser = null;

function setTheme(dark) {
  document.body.classList.toggle("dark-theme", dark);
  if (themeToggle) {
    themeToggle.setAttribute("aria-pressed", String(dark));
    themeToggle.querySelector("span").textContent = dark
      ? "Light mode"
      : "Dark mode";
    themeToggle
      .querySelector("i")
      .setAttribute("data-lucide", dark ? "sun" : "moon");
    lucide.createIcons();
  }
}

setTheme(localStorage.getItem("theme") === "dark");
themeToggle?.addEventListener("click", () => {
  const dark = !document.body.classList.contains("dark-theme");
  localStorage.setItem("theme", dark ? "dark" : "light");
  setTheme(dark);
});

function showScreen(screen) {
  [landing, auth, onboarding, app].forEach((view) =>
    view.classList.remove("show", "active-screen"),
  );
  if (screen === "landing") landing.classList.add("show");
  if (screen === "auth") auth.classList.add("show");
  if (screen === "onboarding") onboarding.classList.add("show");
  if (screen === "app") {
    app.classList.add("active-screen");
    openView("dashboard");
  }
}

function setAuthMode(mode) {
  authMode = mode;
  const copy = {
    login: [
      "Welcome back",
      "Log in to your account",
      "Your financial picture, all in one place.",
      "Log in",
    ],
    signup: [
      "Start with the basics",
      "Create your account",
      "A better plan starts with a few simple questions.",
      "Create account",
    ],
    verify: [
      "Almost there",
      "Verify your email",
      "Enter the code shown in your verification email.",
      "Verify email",
    ],
    forgot: [
      "Account recovery",
      "Reset your password",
      "We will create a one-time reset code for your account.",
      "Send reset code",
    ],
    reset: [
      "New credentials",
      "Choose a new password",
      "Enter the reset code and your new password.",
      "Reset password",
    ],
    "2fa": [
      "Extra security",
      "Enter your authentication code",
      "Use your authenticator app to finish signing in.",
      "Verify code",
    ],
  }[mode];
  const codeMode = ["verify", "reset", "2fa"].includes(mode);
  const passwordMode = ["login", "signup", "reset"].includes(mode);
  document.getElementById("authEyebrow").textContent = copy[0];
  document.getElementById("authTitle").textContent = copy[1];
  document.getElementById("authText").textContent = copy[2];
  document.getElementById("authSubmit").innerHTML = `${copy[3]} <span>→</span>`;
  document.getElementById("passwordField").style.display = passwordMode
    ? "grid"
    : "none";
  document.getElementById("passwordField").querySelector("input").required =
    passwordMode;
  document.getElementById("codeField").style.display = codeMode
    ? "grid"
    : "none";
  document.getElementById("codeField").querySelector("input").required =
    codeMode;
  document.getElementById("nameFields").style.display =
    mode === "signup" ? "grid" : "none";
  document.getElementById("referralField").style.display =
    mode === "signup" ? "grid" : "none";
  document.querySelectorAll("#nameFields input").forEach((input) => {
    input.required = mode === "signup";
  });
  document.getElementById("forgotPassword").style.display =
    mode === "login" ? "block" : "none";
  document.getElementById("switchAuth").style.display = [
    "login",
    "signup",
  ].includes(mode)
    ? "block"
    : "none";
  document.getElementById("switchAuth").innerHTML =
    mode === "signup"
      ? "Already have an account? <b>Log in</b>"
      : "New here? <b>Create an account</b>";
}

document.querySelectorAll("[data-auth]").forEach((button) =>
  button.addEventListener("click", () => {
    setAuthMode(button.dataset.auth);
    showScreen("auth");
  }),
);
document
  .querySelector('[data-show="landing"]')
  .addEventListener("click", () => showScreen("landing"));
document
  .getElementById("switchAuth")
  .addEventListener("click", () =>
    setAuthMode(authMode === "login" ? "signup" : "login"),
  );
document
  .getElementById("forgotPassword")
  .addEventListener("click", () => setAuthMode("forgot"));
document
  .getElementById("authForm")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const status = document.getElementById("authStatus");
    const submit = document.getElementById("authSubmit");
    status.textContent = "";
    submit.disabled = true;
    try {
      const endpoints = {
        login: "/api/auth/login",
        signup: "/api/auth/signup",
        verify: "/api/auth/verify-email",
        forgot: "/api/auth/forgot-password",
        reset: "/api/auth/reset-password",
        "2fa": "/api/auth/2fa/verify",
      };
      const body = Object.fromEntries(form.entries());
      const response = await apiFetch(endpoints[authMode], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json"))
        throw new Error(
          "Account access requires the app server. Open http://localhost:3000 after running node server.js.",
        );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Authentication failed.");
      if (result.needsVerification || authMode === "signup") {
        status.textContent = result.verificationCode
          ? `Development verification code: ${result.verificationCode}`
          : result.message;
        setAuthMode("verify");
        document.querySelector('[name="email"]').value = body.email;
      } else if (result.needsTwoFactor) {
        document.querySelector('[name="challengeToken"]').value =
          result.challengeToken;
        setAuthMode("2fa");
      } else if (authMode === "verify") {
        updateProfile(result.user);
        showScreen("onboarding");
      } else if (authMode === "forgot") {
        status.textContent = result.resetCode
          ? `Development reset code: ${result.resetCode}`
          : result.message;
        setAuthMode("reset");
        document.querySelector('[name="email"]').value = body.email;
      } else if (authMode === "reset") setAuthMode("login");
      else {
        updateProfile(result.user);
        showScreen("app");
        renderTransactions();
        renderAccount();
      }
    } catch (error) {
      status.textContent =
        error.message === "Failed to fetch"
          ? 'Start the app with "node server.js", then open http://localhost:3000.'
          : error.message;
    } finally {
      submit.disabled = false;
    }
  });
function updateProfile(user) {
  if (!user) return;
  currentUser = user;
  const firstName = user.firstName || user.name?.split(" ")[0] || "Min";
  const lastName =
    user.lastName || user.name?.split(" ").slice(1).join(" ") || "Chen";
  const initials = `${(firstName || "").charAt(0) || "M"}${(lastName || "").charAt(0) || "C"}`.toUpperCase();
  document.getElementById("profileName").textContent = `${firstName} ${lastName}`;
  document.getElementById("profileEmail").textContent = user.email;
  document.getElementById("profileEmailValue").textContent = user.email;
  document.getElementById("profileFirstName").textContent = firstName;
  document.getElementById("profileLastName").textContent = lastName;
  document.getElementById("profileReferralCode").textContent = user.referralCode || "Not available";
  document.getElementById("firstNameInput").value = firstName;
  document.getElementById("lastNameInput").value = lastName;
  document.getElementById("emailInput").value = user.email;
  const accountDetails = user.accountDetails || {};
  document.getElementById("phoneInput").value = accountDetails.phone || "";
  document.getElementById("countryInput").value = accountDetails.country || "";
  document.getElementById("addressInput").value = accountDetails.address || "";
  document.getElementById("cityInput").value = accountDetails.city || "";
  document.getElementById("postalCodeInput").value = accountDetails.postalCode || "";
  const avatarEl = document.getElementById("profileAvatar");
  const avatarPreview = document.getElementById("profileAvatarPreview");
  const sidebarAvatar = document.getElementById("sidebarProfileAvatar");
  const sidebarName = document.getElementById("sidebarProfileName");
  const avatarUrl = user.avatar || "";
  if (sidebarName) sidebarName.textContent = `${firstName} ${lastName}`;
  if (avatarUrl) {
    const applyAvatar = (element) => {
      element.style.backgroundImage = `url(${avatarUrl})`;
      element.style.backgroundSize = "cover";
      element.style.backgroundPosition = "center";
      element.textContent = "";
    };
    applyAvatar(avatarEl);
    applyAvatar(avatarPreview);
    if (sidebarAvatar) applyAvatar(sidebarAvatar);
  } else {
    const clearAvatar = (element) => {
      element.style.backgroundImage = "";
      element.textContent = initials;
    };
    clearAvatar(avatarEl);
    clearAvatar(avatarPreview);
    if (sidebarAvatar) clearAvatar(sidebarAvatar);
  }
}
const profileForm = document.getElementById("profileForm");
const editProfileButton = document.getElementById("editProfileButton");
const cancelEditProfileButton = document.getElementById("cancelEditProfile");
const avatarInput = document.getElementById("avatarInput");
let avatarDataUrl = "";
avatarInput?.addEventListener("change", (event) => {
  const [file] = event.target.files || [];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    avatarDataUrl = String(reader.result || "");
    const preview = document.getElementById("profileAvatarPreview");
    preview.style.backgroundImage = `url(${avatarDataUrl})`;
    preview.style.backgroundSize = "cover";
    preview.style.backgroundPosition = "center";
    preview.textContent = "";
  };
  reader.readAsDataURL(file);
});
function toggleProfileEditor(show) {
  profileForm.hidden = !show;
  editProfileButton.textContent = show ? "Hide editor" : "Edit profile";
}
editProfileButton.addEventListener("click", () => {
  toggleProfileEditor(profileForm.hidden);
});
cancelEditProfileButton.addEventListener("click", () => toggleProfileEditor(false));
profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const existingAvatar = document.getElementById("profileAvatar").style.backgroundImage;
  const nextAvatar = avatarDataUrl || (existingAvatar ? existingAvatar.slice(5, -2) : "");
  const payload = {
    firstName: document.getElementById("firstNameInput").value.trim(),
    lastName: document.getElementById("lastNameInput").value.trim(),
    email: document.getElementById("emailInput").value.trim(),
    avatar: nextAvatar,
    accountDetails: {
      phone: document.getElementById("phoneInput").value.trim(),
      country: document.getElementById("countryInput").value.trim(),
      address: document.getElementById("addressInput").value.trim(),
      city: document.getElementById("cityInput").value.trim(),
      postalCode: document.getElementById("postalCodeInput").value.trim(),
    },
  };
  if (!payload.firstName || !payload.lastName || !payload.email || Object.values(payload.accountDetails).some((value) => !value)) {
    alert("Complete all account details before saving.");
    return;
  }
  const response = await apiFetch("/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) {
    alert(result.error || "Unable to update profile.");
    return;
  }
  avatarDataUrl = "";
  avatarInput.value = "";
  updateProfile(result.user);
  toggleProfileEditor(false);
  document.getElementById("accountDetailsNotice").hidden = true;
});
document.getElementById("logoutButton").addEventListener("click", async () => {
  await apiFetch("/api/auth/logout", { method: "POST" });
  showScreen("landing");
  setAuthMode("login");
});

const onboardingCopy = [
  [
    "What are you investing for?",
    "This helps us shape a plan around what matters to you.",
  ],
  [
    "How long can you stay invested?",
    "Time gives your money room to work through the market cycle.",
  ],
  [
    "How comfortable are you with risk?",
    "There is no right answer. We will find the right fit for you.",
  ],
];
const onboardingChoices = [
  [
    ["Retirement", "Build future freedom"],
    ["Home", "Prepare for a place of your own"],
    ["Education", "Invest in what's next"],
    ["Wealth", "Grow your possibilities"],
  ],
  [
    ["Under 3 years", "I may need this money soon"],
    ["3–7 years", "I have some flexibility"],
    ["8–15 years", "I am investing for the long view"],
    ["15+ years", "I am here for future freedom"],
  ],
  [
    ["Cautious", "Protect what I have"],
    ["Balanced", "A thoughtful middle ground"],
    ["Adventurous", "I can handle some swings"],
    ["Growth-focused", "I am comfortable with volatility"],
  ],
];
function renderOnboarding() {
  const copy = onboardingCopy[onboardingStep - 1];
  document.getElementById("stepNumber").textContent = onboardingStep;
  document.getElementById("stepProgress").style.width =
    `${onboardingStep * 33.33}%`;
  document.getElementById("onboardingTitle").textContent = copy[0];
  document.getElementById("onboardingText").textContent = copy[1];
  document.getElementById("choiceGrid").innerHTML = onboardingChoices[
    onboardingStep - 1
  ]
    .map(
      ([title, detail]) =>
        `<button data-choice="${title}"><i data-lucide="${onboardingStep === 1 ? "target" : onboardingStep === 2 ? "clock-3" : "gauge"}"></i><b>${title}</b><small>${detail}</small></button>`,
    )
    .join("");
  document.querySelectorAll("#choiceGrid button").forEach((choice) =>
    choice.addEventListener("click", () => {
      document
        .querySelectorAll("#choiceGrid button")
        .forEach((item) => item.classList.remove("selected"));
      choice.classList.add("selected");
    }),
  );
  lucide.createIcons();
}
document.getElementById("nextStep").addEventListener("click", () => {
  if (onboardingStep < 3) {
    onboardingStep += 1;
    renderOnboarding();
  } else {
    showScreen("app");
    renderAccount();
    renderTransactions();
  }
});

function openView(view) {
  document
    .querySelectorAll("[data-panel]")
    .forEach((panel) =>
      panel.classList.toggle("active", panel.dataset.panel === view),
    );
  document
    .querySelectorAll(".nav-item")
    .forEach((item) =>
      item.classList.toggle("active", item.dataset.view === view),
    );
  const title = view.charAt(0).toUpperCase() + view.slice(1);
  const crumb = document.querySelector(".crumb strong");
  if (crumb) {
    crumb.textContent = title === "Dashboard" ? "Overview" : title;
  }
}

document.querySelectorAll("[data-nav-target]").forEach((button) => {
  button.addEventListener("click", () => openView(button.dataset.navTarget));
});
const searchInput = document.getElementById("searchInput");
const searchClear = document.getElementById("searchClear");
const searchResults = document.getElementById("searchResults");
const searchablePanels = [
  ...document.querySelectorAll(".view-panel, .view-content"),
].map((panel) => ({
  view: panel.dataset.panel,
  title: panel.querySelector("h1")?.textContent || "Overview",
  text: panel.textContent.toLowerCase(),
}));
function renderSearchResults() {
  const query = searchInput.value.trim().toLowerCase();
  searchClear.classList.toggle("show", Boolean(query));
  if (!query) {
    searchResults.classList.remove("show");
    searchResults.innerHTML = "";
    return;
  }
  const matches = searchablePanels.filter((panel) =>
    panel.text.includes(query),
  );
  searchResults.innerHTML = matches.length
    ? matches
        .map(
          (panel) =>
            `<button class="search-result" type="button" data-search-view="${panel.view}" role="option"><strong>${panel.title}</strong><span>Open section</span></button>`,
        )
        .join("")
    : '<p class="empty-state">No matching sections.</p>';
  searchResults.classList.add("show");
  searchResults.querySelectorAll("[data-search-view]").forEach((result) =>
    result.addEventListener("click", () => {
      openView(result.dataset.searchView);
      searchResults.classList.remove("show");
      searchInput.blur();
    }),
  );
}
searchInput.addEventListener("input", renderSearchResults);
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    searchResults.classList.remove("show");
    searchInput.blur();
  }
});
searchClear.addEventListener("click", () => {
  searchInput.value = "";
  renderSearchResults();
  searchInput.focus();
});
document.addEventListener("click", (event) => {
  if (!document.getElementById("globalSearch").contains(event.target))
    searchResults.classList.remove("show");
});
document.querySelectorAll(".nav-item").forEach((item) =>
  item.addEventListener("click", () => {
    openView(item.dataset.view);
    if (item.dataset.view === "activity") renderTransactions();
  }),
);
const settingsButton = document.querySelector(
  '.top-actions .icon-button[aria-label="Settings"]',
);
settingsButton?.addEventListener("click", () => openView("settings"));
const profileTrigger = document.querySelector(".profile");
profileTrigger?.addEventListener("click", () => openView("profile"));
profileTrigger?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openView("profile");
  }
});

let transactionType = "deposit";
let selectedCurrency = "USD";
const moneyAmountInput = document.getElementById("moneyAmount");
const currencySelect = document.getElementById("currencySelect");
if (currencySelect) {
  currencySelect.addEventListener("change", () => {
    selectedCurrency = currencySelect.value;
  });
}
document.querySelectorAll(".open-modal").forEach((button) =>
  button.addEventListener("click", () => {
    transactionType = button.dataset.transactionType || "deposit";
    if (transactionType === "deposit" && (!currentUser || !hasCompleteAccountDetails(currentUser))) {
      modal.classList.remove("show");
      openView("profile");
      toggleProfileEditor(true);
      document.getElementById("accountDetailsNotice").hidden = false;
      document.getElementById("profileForm").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    selectedCurrency = currencySelect?.value || "USD";
    document.getElementById("moneyModalTitle").textContent =
      transactionType === "deposit"
        ? "Add money to your portfolio"
        : "Withdraw from your portfolio";
    document.getElementById("moneyModalText").textContent =
      transactionType === "deposit"
        ? "Choose an amount and currency to make a one-time contribution. Your request will be reviewed and tracked in Activity."
        : "Choose an amount to move to your linked bank account. Your request will be reviewed and tracked in Activity.";
    document.getElementById("moneyStatus").textContent = "";
    document.getElementById("depositAmountStep").style.display = "block";
    document.getElementById("paymentStep").classList.remove("show");
    document.getElementById("paymentSuccess").classList.remove("show");
    document.getElementById("confirmDeposit").textContent = transactionType === "deposit" ? "Continue to payment" : "Submit request";
    setPaymentMethod("card");
    modal.classList.add("show");
  }),
);
function hasCompleteAccountDetails(user) {
  const details = user?.accountDetails || {};
  return [details.phone, details.country, details.address, details.city, details.postalCode].every(Boolean);
}
document.querySelector(".close")?.addEventListener("click", () => modal.classList.remove("show"));
modal.addEventListener("click", (event) => {
  if (event.target === modal) modal.classList.remove("show");
});
document.getElementById("confirmDeposit").addEventListener("click", async () => {
    const button = document.getElementById("confirmDeposit");
    const status = document.getElementById("moneyStatus");
    button.disabled = true;
    try {
      if (transactionType !== "deposit") {
        const response = await apiFetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          type: transactionType,
          amount: document.getElementById("moneyAmount").value,
        }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Request failed.");
        status.textContent = result.notification;
        button.textContent = "Submitted";
        renderTransactions();
        setTimeout(() => { modal.classList.remove("show"); button.textContent = "Submit request"; }, 700);
        return;
      }
      const response = await apiFetch("/api/payments/initialize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: document.getElementById("moneyAmount").value, currency: selectedCurrency }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not start payment.");
      paymentSessionId = result.paymentSessionId;
      document.getElementById("gatewayAmount").textContent = formatCurrency(result.amount, result.currency || selectedCurrency);
      document.getElementById("depositAmountStep").style.display = "none";
      document.getElementById("paymentStep").classList.add("show");
      status.textContent = "Choose a payment method to continue.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
function setPaymentMethod(nextMethod) {
  paymentMethod = nextMethod;
  document.querySelectorAll("[data-payment-method]").forEach((item) => { const selected = item.dataset.paymentMethod === nextMethod; item.classList.toggle("selected", selected); item.setAttribute("aria-checked", String(selected)); });
  document.getElementById("cardDetails").style.display = nextMethod === "card" ? "grid" : "none";
}
document.querySelectorAll("[data-payment-method]").forEach((method) => method.addEventListener("click", () => setPaymentMethod(method.dataset.paymentMethod)));
document.getElementById("backToAmount").addEventListener("click", () => { document.getElementById("paymentStep").classList.remove("show"); document.getElementById("depositAmountStep").style.display = "block"; document.getElementById("moneyStatus").textContent = ""; });
document.getElementById("confirmPayment").addEventListener("click", async () => {
  const button = document.getElementById("confirmPayment");
  const status = document.getElementById("moneyStatus");
  button.disabled = true;
  try {
    let cardDetails;
    if (paymentMethod === "card") {
      const cardholderName = document.getElementById("cardholderName").value.trim();
      const cardNumber = document.getElementById("cardNumber").value.replace(/\D/g, "");
      const cardExpiry = document.getElementById("cardExpiry").value.trim();
      const cardCvv = document.getElementById("cardCvv").value.trim();
      if (!cardholderName || cardNumber.length < 12 || cardNumber.length > 19 || !/^\d{2}\/\d{2}$/.test(cardExpiry) || !/^\d{3,4}$/.test(cardCvv)) {
        throw new Error("Enter a valid cardholder name, card number, expiry date, and CVV.");
      }
      cardDetails = { cardholderName, last4: cardNumber.slice(-4), expiry: cardExpiry };
    }
    const response = await apiFetch("/api/payments/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentSessionId, paymentMethod, currency: selectedCurrency, cardDetails }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Payment could not be verified.");
    document.getElementById("paymentStep").classList.remove("show");
    document.getElementById("paymentSuccess").classList.add("show");
    document.getElementById("successAmount").textContent = formatCurrency(result.transaction.amount, result.transaction.currency || selectedCurrency);
    document.getElementById("successTransactionId").textContent = result.transaction.id;
    status.textContent = "";
    renderAccount();
    renderTransactions();
  } catch (error) { status.textContent = error.message; } finally { button.disabled = false; }
});
document.getElementById("closeSuccess").addEventListener("click", () => { modal.classList.remove("show"); document.getElementById("paymentSuccess").classList.remove("show"); });
function resetDashboardAmounts() {
  document.getElementById("portfolioBalance").textContent = "$0.00";
  document.getElementById("contributedBalance").textContent = "$0.00";
  document.getElementById("availableCash").textContent = "₦0.00";
}
function updateAccount(account) {
  const safeAccount = account || { balance: 0, contributed: 0, availableCash: 0 };
  document.getElementById("portfolioBalance").textContent = `$${safeAccount.balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  document.getElementById("contributedBalance").textContent = `$${safeAccount.contributed.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  document.getElementById("availableCash").textContent = formatNaira(safeAccount.availableCash);
}
async function renderAccount() {
  const response = await apiFetch("/api/account");
  if (!response.ok) {
    resetDashboardAmounts();
    return;
  }
  const { account } = await response.json();
  updateAccount(account);
}
async function renderTransactions() {
  const response = await apiFetch("/api/transactions");
  if (!response.ok) return;
  const { transactions } = await response.json();
  const list = document.getElementById("transactionList");
  document.getElementById("notificationCount").textContent =
    transactions.filter((item) => item.status === "pending").length;
  list.innerHTML = transactions.length
    ? transactions
        .map(
          (item) =>
            `<div class="transaction"><div class="transaction-icon ${item.type === "deposit" ? "deposit" : "withdrawal"}"><i data-lucide="${item.type === "deposit" ? "arrow-down-left" : "arrow-up-right"}"></i></div><div><b>${item.description}</b><small>${item.id}</small></div><strong>${item.type === "deposit" ? "+" : "-"}${formatCurrency(item.amount, item.currency || "USD")}</strong><span>${new Date(item.createdAt).toLocaleDateString()}</span><em>${item.status}</em></div>`,
        )
        .join("")
    : '<p class="empty-state">Your deposit and withdrawal requests will appear here.</p>';
  lucide.createIcons();
}
document.querySelectorAll(".period").forEach((period) =>
  period.addEventListener("click", () => {
    document.querySelector(".period.selected").classList.remove("selected");
    period.classList.add("selected");
  }),
);
document
  .querySelectorAll(".portfolio-option .outline-button")
  .forEach((button) =>
    button.addEventListener("click", () => {
      document
        .querySelectorAll(".portfolio-option")
        .forEach((item) => item.classList.remove("selected-portfolio"));
      button.closest(".portfolio-option").classList.add("selected-portfolio");
      button.textContent = "Selected";
    }),
  );

async function restoreSession() {
  const response = await apiFetch("/api/auth/me");
  if (!response.ok) {
    showScreen("landing");
    return;
  }
  const { user } = await response.json();
  updateProfile(user);
  showScreen("app");
  renderAccount();
  renderTransactions();
}

restoreSession().catch(() => showScreen("landing"));
lucide.createIcons();
