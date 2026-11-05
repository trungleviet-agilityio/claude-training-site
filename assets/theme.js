// Sets the theme before the first paint, so a dark-theme reader never sees a light flash.
// It loads as a blocking script in <head>, and it needs no sign-in or Firebase.
// A saved choice wins. With no saved choice, the page follows the device.
(function () {
  var STORAGE_KEY = "claude-training-theme";
  var root = document.documentElement;
  var deviceDark = window.matchMedia("(prefers-color-scheme: dark)");

  function savedTheme() {
    try {
      var theme = window.localStorage.getItem(STORAGE_KEY);
      return theme === "light" || theme === "dark" ? theme : null;
    } catch (e) {
      return null;
    }
  }

  function save(theme) {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) {
      /* The choice still applies to this page. */
    }
  }

  function preferredTheme() {
    return savedTheme() || (deviceDark.matches ? "dark" : "light");
  }

  function apply(theme) {
    root.dataset.theme = theme;
    var button = document.getElementById("theme-toggle");
    if (button) {
      button.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
    }
  }

  apply(preferredTheme());

  document.addEventListener("DOMContentLoaded", function () {
    apply(root.dataset.theme);
    document.getElementById("theme-toggle").addEventListener("click", function () {
      var next = root.dataset.theme === "dark" ? "light" : "dark";
      save(next);
      apply(next);
    });
  });

  deviceDark.addEventListener("change", function () {
    if (!savedTheme()) {
      apply(preferredTheme());
    }
  });

  // Another tab changed the theme.
  window.addEventListener("storage", function (event) {
    if (event.key === STORAGE_KEY || event.key === null) {
      apply(preferredTheme());
    }
  });

  // The Back button can restore a page from memory without running this script.
  window.addEventListener("pageshow", function (event) {
    if (event.persisted) {
      apply(preferredTheme());
    }
  });
})();
