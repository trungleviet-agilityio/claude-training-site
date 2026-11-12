// Signs the user in, loads the page's content from Firestore, and syncs progress.
import { FIREBASE_SDK_VERSION, firebaseConfig } from "./firebase-config.js";

const body = document.body;
const isPublic = body.dataset.public === "true";
const pageDoc = body.dataset.doc;
const isMentorPage = pageDoc === "mentor";
const base = document.getElementById("main-nav").dataset.base;
const progress = window.ClaudeTrainingProgress;

const SESSION_COUNT = 15;
const SAVE_DELAY_MS = 1000;
const MAX_TICKS = 500;
const SYNC_PREFIX = "claude-training-sync:";
const LOCAL_VERSION = "local";

const $ = (id) => document.getElementById(id);
const VIEWS = ["view-loading", "view-signin", "view-check-email", "view-not-listed", "view-error", "main"];

function show(id) {
  VIEWS.forEach((view) => {
    $(view).hidden = view !== id;
  });
}

// A deploy writes content and shells in two steps. A difference means the second step
// failed, or the browser still holds an old shell. An old shell may have no warning
// element, and this check must never stop the page from loading.
function checkVersion(contentVersion) {
  const shellVersion = body.dataset.version;
  const warning = $("version-warning");
  if (!warning) {
    return;
  }
  warning.hidden = shellVersion === LOCAL_VERSION || contentVersion === shellVersion;
  warning.textContent = warning.hidden
    ? ""
    : `Course text is version ${contentVersion || "unknown"}. Refresh this page. If this stays, tell your mentor.`;
}

// Diagrams are optional: if they fail, the page still works and shows their text.
function drawDiagrams(root) {
  if (!root.querySelector("code.language-mermaid")) {
    return;
  }
  import(`./diagrams.js?v=${body.dataset.version}`)
    .then((diagrams) => diagrams.renderDiagrams(root))
    .catch(() => {});
}

function showError(text) {
  $("error-message").textContent = text;
  show("view-error");
}

function storage(action, key, value) {
  try {
    return window.localStorage[action](SYNC_PREFIX + key, value);
  } catch (e) {
    return null;
  }
}

const AUTH_MESSAGES = {
  "auth/popup-blocked": "Your browser blocked the sign-in window. Allow pop-ups, or use your email.",
  "auth/popup-closed-by-user": "The sign-in window closed before you finished. Please try again.",
  "auth/cancelled-popup-request": "The sign-in window closed before you finished. Please try again.",
  "auth/operation-not-supported-in-this-environment": "Open this page in Safari or Chrome, not inside another app.",
  "auth/web-storage-unsupported": "Open this page in Safari or Chrome, not inside another app.",
  "auth/invalid-credential": "That email or password is not correct.",
  "auth/wrong-password": "That email or password is not correct.", // pragma: allowlist secret
  "auth/user-not-found": "That email or password is not correct.",
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/email-already-in-use": "This email already has an account. Sign in instead.",
  "auth/weak-password": "Use at least 8 characters.", // pragma: allowlist secret
  "auth/too-many-requests": "Too many attempts. Please wait a few minutes and try again.",
  "auth/network-request-failed": "We could not reach the sign-in service. Check your connection and try again.",
};

function authMessage(error) {
  return AUTH_MESSAGES[error.code] || "We could not complete that. Please try again.";
}

function setAuthMessage(text) {
  $("auth-message").textContent = text || "";
  $("auth-message").hidden = !text;
}

const FORM_MODES = {
  signin: {
    heading: "Sign in",
    subheading: "Welcome back. Continue where you stopped.",
    submit: "Sign in",
    switchText: "New here?",
    switchLabel: "Create an account",
    next: "signup",
  },
  signup: {
    heading: "Create your account",
    subheading: "We will send a link to check your email.",
    submit: "Create account",
    switchText: "Already have an account?",
    switchLabel: "Sign in",
    next: "signin",
  },
  reset: {
    heading: "Reset your password",
    subheading: "We will send a reset link to your email.",
    submit: "Send reset link",
    switchText: "Remembered it?",
    switchLabel: "Back to sign in",
    next: "signin",
  },
};

let formMode = "signin";

function setFormMode(mode) {
  formMode = mode;
  const copy = FORM_MODES[mode];
  $("auth-heading").textContent = copy.heading;
  $("auth-subheading").textContent = copy.subheading;
  $("auth-submit").textContent = copy.submit;
  $("auth-submit-icon").style.display = mode === "signin" ? "" : "none";
  $("switch-text").textContent = copy.switchText;
  $("switch-mode").textContent = copy.switchLabel;
  $("google-block").hidden = mode === "reset";
  $("password-field").hidden = mode === "reset";
  $("to-reset").hidden = mode !== "signin";
  $("password-hint").hidden = mode !== "signup";
  $("auth-password").autocomplete = mode === "signup" ? "new-password" : "current-password";
  setAuthMessage("");
}

async function start() {
  const url = (name) => `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-${name}.js`;
  const [{ initializeApp }, auth, store] = await Promise.all([
    import(url("app")),
    import(url("auth")),
    import(url("firestore-lite")),
  ]);
  const app = initializeApp(firebaseConfig);
  const a = auth.getAuth(app);
  const db = store.getFirestore(app);

  let saveTimer = null;
  let syncUser = null;

  const progressRef = (user) => store.doc(db, "progress", user.uid);

  async function saveProgress() {
    if (!syncUser) {
      return;
    }
    saveTimer = null;
    try {
      await store.setDoc(progressRef(syncUser), {
        email: syncUser.email.toLowerCase(),
        name: (syncUser.displayName || "").slice(0, 200),
        ticks: progress.keys().slice(0, MAX_TICKS),
        updatedAt: store.serverTimestamp(),
      });
      storage("removeItem", "dirty");
      $("sync-status").textContent = "";
    } catch (e) {
      $("sync-status").textContent = "Not synced yet";
    }
  }

  document.addEventListener("claude-training:change", () => {
    storage("setItem", "dirty", "1");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveProgress, SAVE_DELAY_MS);
  });

  async function syncProgress(user) {
    syncUser = user;
    const snapshot = await store.getDoc(progressRef(user));
    const remote = snapshot.exists() ? snapshot.data().ticks : [];
    if (storage("getItem", `synced:${user.uid}`) !== "1") {
      // First sign-in on this browser: keep ticks from both places.
      progress.setKeys([...new Set([...remote, ...progress.keys()])]);
      storage("setItem", `synced:${user.uid}`, "1");
      await saveProgress();
    } else if (storage("getItem", "dirty") === "1") {
      await saveProgress();
    } else {
      progress.setKeys(remote);
    }
  }

  async function renderMentor() {
    const status = $("mentor-status");
    let snapshot;
    try {
      snapshot = await store.getDocs(store.collection(db, "progress"));
    } catch (e) {
      status.textContent = "This page is for mentors only.";
      return;
    }
    const students = snapshot.docs
      .map((item) => item.data())
      .sort((x, y) => x.email.localeCompare(y.email));
    status.textContent = students.length
      ? `${students.length} people have saved progress.`
      : "No student has saved progress yet.";
    if (!students.length) {
      return;
    }
    const table = $("mentor-table");
    table.textContent = "";
    const cell = (row, tag, text, label) => {
      const element = document.createElement(tag);
      element.textContent = text;
      if (label) {
        element.setAttribute("aria-label", label);
      }
      row.appendChild(element);
    };
    const sessions = Array.from({ length: SESSION_COUNT }, (_, i) => String(i + 1).padStart(2, "0"));
    const head = document.createElement("tr");
    ["Student", "Done", "Last saved", ...sessions].forEach((text) => cell(head, "th", text));
    table.appendChild(head);
    students.forEach((student) => {
      const row = document.createElement("tr");
      const ticks = new Set(student.ticks);
      const done = sessions.filter((number) => ticks.has(`done:session-${number}`));
      cell(row, "td", student.name ? `${student.name} (${student.email})` : student.email);
      cell(row, "td", `${done.length} of ${SESSION_COUNT}`);
      cell(row, "td", student.updatedAt ? student.updatedAt.toDate().toLocaleDateString() : "");
      sessions.forEach((number) => {
        const isDone = done.includes(number);
        cell(row, "td", isDone ? "✓" : "", `Session ${number}: ${isDone ? "done" : "not done"}`);
      });
      table.appendChild(row);
    });
    $("mentor-wrap").hidden = false;
  }

  function setMenuOpen(open) {
    $("account-menu").hidden = !open;
    $("account-button").setAttribute("aria-expanded", String(open));
  }

  $("account-button").addEventListener("click", () => setMenuOpen($("account-menu").hidden));
  const navGroup = document.querySelector(".nav-group");
  document.addEventListener("click", (event) => {
    if (!$("account").contains(event.target)) {
      setMenuOpen(false);
    }
    if (!navGroup.contains(event.target)) {
      navGroup.open = false;
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }
    if (!$("account-menu").hidden) {
      setMenuOpen(false);
      $("account-button").focus();
    }
    if (navGroup.open) {
      navGroup.open = false;
      navGroup.querySelector("summary").focus();
    }
  });

  function setAccount(user) {
    setMenuOpen(false);
    $("account").hidden = !user;
    $("account-email").textContent = user ? user.email : "";
  }

  function addMentorLink() {
    const nav = $("main-nav");
    if (nav.querySelector("[data-mentor-link]")) {
      return;
    }
    const link = document.createElement("a");
    link.href = `${base}mentor.html`;
    link.textContent = "Mentor";
    link.dataset.mentorLink = "true";
    if (isMentorPage) {
      link.setAttribute("aria-current", "page");
    }
    nav.appendChild(link);
  }

  async function route() {
    const user = a.currentUser;
    setAccount(user);
    if (isPublic) {
      $("delete-data").hidden = !user;
      show("main");
      if (!user) {
        return;
      }
    } else if (!user) {
      $("main-nav").hidden = true;
      show("view-signin");
      return;
    } else {
      show("view-loading");
    }
    if (!user.emailVerified) {
      if (!isPublic) {
        $("check-email-address").textContent = user.email;
        show("view-check-email");
      }
      return;
    }
    try {
      const roster = await store.getDoc(store.doc(db, "roster", user.email.toLowerCase()));
      if (!roster.exists()) {
        if (!isPublic) {
          $("not-listed-address").textContent = user.email;
          show("view-not-listed");
        }
        return;
      }
      $("main-nav").hidden = false;
      if (roster.data().role === "mentor") {
        addMentorLink();
      }
      if (isPublic) {
        return;
      }
      await syncProgress(user);
      if (isMentorPage) {
        show("main");
        await renderMentor();
        return;
      }
      const page = await store.getDoc(store.doc(db, "pages", pageDoc));
      if (!page.exists()) {
        showError("This page is not available yet. Please tell your mentor.");
        return;
      }
      $("main").innerHTML = page.data().html;
      document.title = page.data().title;
      checkVersion(page.data().version);
      progress.init();
      show("main");
      drawDiagrams($("main"));
    } catch (e) {
      if (!isPublic) {
        showError("We could not load this page. Check your connection and try again.");
      }
    }
  }

  async function runAuth(action) {
    setAuthMessage("");
    try {
      await action();
    } catch (e) {
      setAuthMessage(authMessage(e));
    }
  }

  setFormMode("signin");

  $("google-sign-in").addEventListener("click", () =>
    runAuth(() => auth.signInWithPopup(a, new auth.GoogleAuthProvider()))
  );

  $("to-reset").addEventListener("click", () => setFormMode("reset"));
  $("switch-mode").addEventListener("click", () => setFormMode(FORM_MODES[formMode].next));

  $("auth-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const email = $("auth-email").value.trim();
    const password = $("auth-password").value;
    runAuth(async () => {
      if (formMode === "reset") {
        await auth.sendPasswordResetEmail(a, email);
        setAuthMessage("If this email has an account, a reset link is on its way.");
      } else if (formMode === "signup") {
        if (password.length < 8) {
          setAuthMessage("Use at least 8 characters.");
          return;
        }
        const created = await auth.createUserWithEmailAndPassword(a, email, password);
        await auth.sendEmailVerification(created.user);
      } else {
        await auth.signInWithEmailAndPassword(a, email, password);
      }
    });
  });

  $("email-confirmed").addEventListener("click", async () => {
    await a.currentUser.reload();
    if (a.currentUser.emailVerified) {
      // The saved token still says "not verified" until it is refreshed.
      await a.currentUser.getIdToken(true);
      route();
    } else {
      $("check-email-message").textContent = "We do not see the confirmation yet. Open the link in the email first.";
      $("check-email-message").hidden = false;
    }
  });

  $("email-resend").addEventListener("click", async () => {
    try {
      await auth.sendEmailVerification(a.currentUser);
      $("check-email-message").textContent = "We sent another link.";
    } catch (e) {
      $("check-email-message").textContent = authMessage(e);
    }
    $("check-email-message").hidden = false;
  });

  $("not-listed-retry").addEventListener("click", route);
  $("error-retry").addEventListener("click", route);

  $("sign-out").addEventListener("click", async () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      await saveProgress();
    }
    syncUser = null;
    progress.clear();
    try {
      Object.keys(window.localStorage)
        .filter((key) => key.startsWith(SYNC_PREFIX))
        .forEach((key) => window.localStorage.removeItem(key));
    } catch (e) {
      /* No storage: nothing to clear. */
    }
    await auth.signOut(a);
  });

  const deleteButton = $("delete-my-data");
  if (deleteButton) {
    deleteButton.addEventListener("click", async () => {
      const status = $("delete-status");
      if (!window.confirm("Delete your saved progress and your account? This cannot be undone.")) {
        return;
      }
      const user = a.currentUser;
      try {
        await store.deleteDoc(progressRef(user));
        progress.clear();
        await auth.deleteUser(user);
      } catch (e) {
        status.textContent =
          e.code === "auth/requires-recent-login"
            ? "Your progress is deleted. To delete the account too, sign out, sign in again, and press this button."
            : "We could not delete your data. Please try again or tell your mentor.";
      }
    });
  }

  auth.onAuthStateChanged(a, route);
}

start().catch(() => {
  show("view-error");
  $("error-message").textContent = "We could not load the sign-in service. Check your connection and try again.";
  $("error-retry").addEventListener("click", () => window.location.reload());
});
