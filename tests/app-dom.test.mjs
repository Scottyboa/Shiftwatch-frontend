import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { JSDOM } from "jsdom";
import yaml from "js-yaml";

test("the production page initializes the repo config and renders a responsive year", async () => {
  const root = new URL("../", import.meta.url);
  const [html, defaultConfig] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("config/default-config.yaml", root), "utf8"),
  ]);
  const dom = new JSDOM(html, {
    url: "https://example.test/shiftwatch/",
    pretendToBeVisual: true,
  });

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperties(globalThis, {
    location: { configurable: true, value: dom.window.location },
    navigator: { configurable: true, value: dom.window.navigator },
  });
  globalThis.jsyaml = yaml;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => defaultConfig,
  });
  let copiedText = "";
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: {
      readText: async () => defaultConfig,
      writeText: async (value) => {
        copiedText = value;
      },
    },
  });

  await import(`../src/app.js?dom-test=${Date.now()}`);
  document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(
    document.querySelectorAll(".month-card").length,
    12,
    document.querySelector("#status-message").textContent,
  );
  assert.equal(document.querySelectorAll(".state-extra").length >= 2, true);
  assert.equal(document.querySelectorAll(".state-excluded").length >= 3, true);
  assert.equal(document.querySelectorAll(".period-row").length, 2);
  assert.equal(document.querySelector("#subject-text").textContent, "Shiftwatch changes");
  assert.equal(document.querySelector("#editor-section").classList.contains("is-disabled"), false);
  assert.match(document.querySelector("#config-source").textContent, /default-config\.yaml/u);

  document.querySelector('[data-date="2026-11-02"]').click();
  document.querySelector('[data-date="2026-11-03"]').click();
  document.querySelector("#add-exclusion").click();
  assert.equal(document.querySelector('[data-date="2026-11-02"]').classList.contains("state-excluded"), true);
  assert.equal(document.querySelector("#exclude-count").textContent, "5");

  document.querySelector("#copy-command").click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(copiedText, /^SHIFTWATCH-CALENDAR-COMMAND-V1\nPAYLOAD-BEGIN\n/u);

  dom.window.close();
});
