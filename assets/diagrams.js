// Draws Mermaid diagrams in course text. app.js loads this file only on pages
// that have a diagram, so other pages never download Mermaid.
// If Mermaid cannot load, the diagram's text version stays on the page.
const MERMAID_URL = "https://cdn.jsdelivr.net/npm/mermaid@12.2.0/dist/mermaid.esm.min.mjs";
// On a narrow screen, keep text readable and let the box scroll sideways.
const MIN_WIDTH = 560;

let mermaidLoad;
let themeWatch;
let drawCount = 0;

function themeVariables() {
  const css = getComputedStyle(document.documentElement);
  const token = (name) => css.getPropertyValue(name).trim();
  return {
    darkMode: document.documentElement.dataset.theme === "dark",
    background: token("--surface"),
    mainBkg: token("--surface"),
    primaryColor: token("--surface"),
    primaryBorderColor: token("--accent"),
    primaryTextColor: token("--ink"),
    secondaryColor: token("--chip-bg"),
    tertiaryColor: token("--bg"),
    lineColor: token("--muted"),
    textColor: token("--ink"),
    fontFamily: token("--body"),
    fontSize: "14px",
  };
}

async function draw(mermaid, boxes) {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: themeVariables(),
  });
  for (const box of boxes) {
    drawCount += 1;
    try {
      const { svg } = await mermaid.render(`diagram-${drawCount}`, box.dataset.source);
      box.innerHTML = svg;
      const drawn = box.querySelector("svg");
      const natural = parseFloat(drawn.style.maxWidth);
      if (natural) {
        drawn.style.minWidth = `${Math.min(natural, MIN_WIDTH)}px`;
      }
    } catch (e) {
      box.textContent = "This diagram could not be drawn.";
      box.classList.add("diagram-error");
    }
  }
}

export async function renderDiagrams(root) {
  const blocks = [...root.querySelectorAll("pre > code.language-mermaid")];
  if (!blocks.length) {
    return;
  }
  let mermaid;
  try {
    mermaidLoad ||= import(MERMAID_URL);
    mermaid = (await mermaidLoad).default;
  } catch (e) {
    mermaidLoad = undefined;
    return;
  }
  const boxes = blocks.map((code) => {
    const box = document.createElement("figure");
    box.className = "diagram";
    box.dataset.source = code.textContent;
    code.parentElement.replaceWith(box);
    return box;
  });
  await draw(mermaid, boxes);

  // theme.js changes data-theme on <html>. Redraw so the colors follow it.
  themeWatch?.disconnect();
  themeWatch = new MutationObserver(() => draw(mermaid, boxes));
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}
