// The browser keeps a copy of the ticks, so pages stay fast and a failed save loses
// nothing. Every storage call must tolerate private windows and blocked site data.
(function () {
  var PREFIX = "claude-training:";

  function read(key) {
    try {
      return window.localStorage.getItem(PREFIX + key);
    } catch (e) {
      return null;
    }
  }

  function write(key, on) {
    try {
      if (on) {
        window.localStorage.setItem(PREFIX + key, "1");
      } else {
        window.localStorage.removeItem(PREFIX + key);
      }
    } catch (e) {
      /* The checkbox still works for this visit. */
    }
  }

  function keys() {
    var found = [];
    try {
      for (var i = 0; i < window.localStorage.length; i += 1) {
        var name = window.localStorage.key(i);
        if (name.indexOf(PREFIX) === 0) {
          found.push(name.slice(PREFIX.length));
        }
      }
    } catch (e) {
      /* No storage: nothing to report. */
    }
    return found;
  }

  function clear() {
    keys().forEach(function (key) {
      write(key, false);
    });
  }

  function setKeys(list) {
    clear();
    list.forEach(function (key) {
      write(key, true);
    });
  }

  function changed(key, on) {
    write(key, on);
    document.dispatchEvent(new Event("claude-training:change"));
  }

  var page = document.body.getAttribute("data-page") || "";

  // Keys use the item's text, so adding an item never moves a saved tick.
  // "S03 ..." rows on the progress page are the same fact as "Mark complete".
  function keyFor(box) {
    var text = box.closest("li, tr").textContent.trim();
    var session = page === "progress" && text.match(/^S(\d\d) /);
    return session ? "done:session-" + session[1] : "check:" + page + ":" + text;
  }

  function setText(selector, text) {
    var element = document.querySelector(selector);
    if (element) {
      element.textContent = text;
    }
  }

  function refreshLedger() {
    var rows = Array.prototype.slice.call(document.querySelectorAll("[data-session]"));
    if (!rows.length) {
      return;
    }
    var open = [];
    rows.forEach(function (row) {
      var isDone = read("done:" + row.getAttribute("data-session")) === "1";
      row.classList.toggle("is-done", isDone);
      if (!isDone) {
        open.push(row);
      }
    });
    var count = rows.length - open.length;
    setText("[data-stat-done]", count + " of " + rows.length);

    var next = open[0];
    var action = document.querySelector("[data-continue]");
    if (action) {
      action.textContent = next
        ? (count ? "Continue" : "Start") + ": Session " + next.querySelector(".num").textContent
        : "Review the schedule";
      action.setAttribute("href", next ? next.getAttribute("href") : "schedule.html");
    }

    var checkpoint = open.filter(function (row) {
      return row.querySelector(".tag-cp");
    })[0];
    setText("[data-stat-checkpoint]", checkpoint ? checkpoint.querySelector(".tag-cp").textContent : "Done");
    setText(
      "[data-stat-checkpoint-note]",
      checkpoint
        ? "next checkpoint, after Session " + checkpoint.querySelector(".num").textContent
        : "all checkpoints reached"
    );
  }

  // Runs after app.js has put the page's content into <main>.
  function init() {
    document.querySelectorAll(".content input[type=checkbox]").forEach(function (box) {
      var key = keyFor(box);
      box.checked = read(key) === "1";
      box.addEventListener("change", function () {
        changed(key, box.checked);
      });
    });

    var done = document.querySelector("[data-mark-done]");
    if (done) {
      var doneKey = "done:" + done.getAttribute("data-mark-done");
      done.checked = read(doneKey) === "1";
      done.addEventListener("change", function () {
        changed(doneKey, done.checked);
      });
    }
    refreshLedger();
  }

  // The Back button can restore this page from memory without running the script.
  window.addEventListener("pageshow", refreshLedger);

  window.ClaudeTrainingProgress = { init: init, keys: keys, setKeys: setKeys, clear: clear };
})();
