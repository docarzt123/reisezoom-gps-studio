#!/usr/bin/env python3
"""Reiseroute: Stationen sortieren + Enter springt zur Adresse (v0.9.538).

Marc: „mach die reiseroute so, dass man die einzelnen ziele anfassen und hoch
und runterschieben kann … und wenn man ein ziel eingibt und enter drückt, soll
die karte dorthin springen."

Headless im echten Browser mit gemockter Brücke: echte index.html, echtes
module.js. Geprüft wird der Weg, den ein Nutzer geht — ziehen, tippen, Enter.

Aufruf:  .venv/bin/python scripts/selftest_reiseroute_stationen.py
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "scripts"))

from selftest_ui import MOCK_API_JS, UI_INDEX   # noqa: E402

fehler = 0


def sagen(ok: bool, text: str, zusatz: str = "") -> None:
    global fehler
    print(f"  [{'OK  ' if ok else 'FAIL'}] {text}" + (f"  {zusatz}" if zusatz else ""))
    if not ok:
        fehler += 1


EXTRA_MOCK = r"""
(() => {
  window.__geocodeRufe = [];
  window.__flyTo = [];
  // Kamera-Flüge mitschreiben — egal welche Kartenbibliothek und welcher Scope.
  const patch = (lib) => {
    try {
      if (lib && lib.Map && lib.Map.prototype && !lib.Map.prototype.__flyPatched) {
        lib.Map.prototype.__flyPatched = true;
        const orig = lib.Map.prototype.flyTo;
        lib.Map.prototype.flyTo = function (opts) {
          try { window.__flyTo.push({ center: opts && opts.center, zoom: opts && opts.zoom }); } catch (_) {}
          try { return orig.apply(this, arguments); } catch (_) { return this; }
        };
      }
    } catch (_) {}
  };
  const iv = setInterval(() => { patch(window.mapboxgl); patch(window.maplibregl); }, 50);
  setTimeout(() => clearInterval(iv), 8000);

  const warte = setInterval(() => {
    if (!window.pywebview || !window.pywebview.api) return;
    clearInterval(warte);
    const echt = window.pywebview.api;
    window.pywebview.api = new Proxy(echt, {
      get(t, prop) {
        if (prop === "settings_set" || prop === "session_update_project_settings") {
          return async (...a) => {
            try {
              const patch = a[a.length - 1] || {};
              const wps = (patch.reiseroute && patch.reiseroute.route_wps) || patch.route_wps;
              if (wps) window.__gespeicherteWps = wps.map(w => w.text);
            } catch (_) {}
            return Reflect.get(t, prop).apply(t, a);
          };
        }
        if (prop === "route_geocode") {
          return async (q, limit) => {
            window.__geocodeRufe.push(q);
            if (String(q).toLowerCase().includes("gibtsnicht")) return { ok: true, results: [] };
            return { ok: true, results: [{ name: "Treffer: " + q, lon: 11.5, lat: 48.1 }] };
          };
        }
        return Reflect.get(t, prop);
      },
    });
  }, 20);
})();
"""


async def main() -> int:
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1500, "height": 950})
        page = await ctx.new_page()
        seiten_fehler: list = []
        page.on("pageerror", lambda e: seiten_fehler.append(str(e)[:300]))
        await page.add_init_script(MOCK_API_JS)
        await page.add_init_script(EXTRA_MOCK)
        await page.goto(f"file://{UI_INDEX.resolve()}", wait_until="domcontentloaded")
        await page.wait_for_timeout(1800)

        tab = await page.query_selector('[data-mod="reiseroute"]')
        if not tab:
            sagen(False, "Reiseroute-Reiter gefunden")
            await browser.close()
            return 1
        await tab.click()
        await page.wait_for_timeout(1500)

        n = await page.eval_on_selector_all(".route-wp", "e => e.length")
        sagen(n >= 2, "die Stationsliste steht", f"{n} Stationen")
        sagen(await page.eval_on_selector_all(".route-wp-handle", "e => e.length") == n,
              "jede Station hat einen Zieh-Griff")

        # ── 1. Drei Stationen mit Namen füllen ───────────────────────────────
        print("\n[1] Stationen benennen")
        await page.click("#route-add-wp")
        await page.wait_for_timeout(300)
        n = await page.eval_on_selector_all(".route-wp", "e => e.length")
        sagen(n == 3, "dritte Station hinzugefügt", str(n))
        for i, name in enumerate(["Alpha", "Beta", "Gamma"]):
            await page.fill(f'.route-wp-input[data-i="{i}"]', name)
        werte = await page.eval_on_selector_all(".route-wp-input", "e => e.map(x => x.value)")
        sagen(werte == ["Alpha", "Beta", "Gamma"], "Reihenfolge Alpha/Beta/Gamma", str(werte))
        rollen = await page.eval_on_selector_all(".route-wp-role", "e => e.map(x => x.textContent)")
        sagen(rollen[0] != rollen[1] and rollen[0] == "Start", "erste Station ist der Start", str(rollen))

        # ── 2. Ziehen: letzte Station nach ganz oben ─────────────────────────
        print("\n[2] Station mit dem Griff nach oben ziehen")
        griff = await page.query_selector('.route-wp-handle[data-i="2"]')
        ziel = await page.query_selector('.route-wp[data-i="0"]')
        gb = await griff.bounding_box(); zb = await ziel.bounding_box()
        await page.mouse.move(gb["x"] + gb["width"] / 2, gb["y"] + gb["height"] / 2)
        await page.mouse.down()
        await page.mouse.move(zb["x"] + zb["width"] / 2, zb["y"] + 4, steps=12)
        await page.mouse.up()
        await page.wait_for_timeout(400)
        werte = await page.eval_on_selector_all(".route-wp-input", "e => e.map(x => x.value)")
        sagen(werte == ["Gamma", "Alpha", "Beta"], "Gamma steht jetzt oben", str(werte))
        rollen = await page.eval_on_selector_all(".route-wp-role", "e => e.map(x => x.textContent)")
        sagen(rollen[0] == "Start" and rollen[2] == "Ziel",
              "Rollen wandern mit (Gamma = Start, Beta = Ziel)", str(rollen))
        await page.wait_for_timeout(700)   # Speichern ist entprellt
        gespeichert = await page.evaluate("() => window.__gespeicherteWps || []")
        sagen(gespeichert == ["Gamma", "Alpha", "Beta"], "die neue Reihenfolge wird gespeichert", str(gespeichert))

        # ── 3. Enter springt zur Adresse ─────────────────────────────────────
        print("\n[3] Enter im Eingabefeld")
        await page.evaluate("() => { window.__flyTo = []; window.__geocodeRufe = []; }")
        await page.fill('.route-wp-input[data-i="1"]', "Innsbruck")
        await page.focus('.route-wp-input[data-i="1"]')
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(900)
        rufe = await page.evaluate("() => window.__geocodeRufe")
        sagen(rufe == ["Innsbruck"], "die Adresse wird gesucht", str(rufe))
        fly = await page.evaluate("() => window.__flyTo")
        sagen(len(fly) >= 1 and abs((fly[-1]["center"] or [0, 0])[0] - 11.5) < 0.001,
              "die Karte fliegt zum Treffer", str(fly[-1:]))
        aufgeloest = await page.eval_on_selector('.route-wp-resolved[data-i="1"]', "e => e.textContent")
        sagen("Innsbruck" in aufgeloest, "der Treffer steht unter dem Feld", aufgeloest)

        # ── 4. Koordinaten direkt + nicht gefunden ───────────────────────────
        print("\n[4] Koordinaten und Fehlschlag")
        await page.evaluate("() => { window.__flyTo = []; window.__geocodeRufe = []; }")
        await page.fill('.route-wp-input[data-i="1"]', "47.05, 13.59")
        await page.focus('.route-wp-input[data-i="1"]')
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(700)
        rufe = await page.evaluate("() => window.__geocodeRufe")
        fly = await page.evaluate("() => window.__flyTo")
        sagen(rufe == [] and len(fly) >= 1, "„lat, lon“ fliegt ohne Adress-Suche", f"geo={rufe} fly={len(fly)}")
        sagen(abs((fly[-1]["center"] or [0, 0])[1] - 47.05) < 0.001, "und zwar an die eingegebene Stelle", str(fly[-1:]))
        await page.evaluate("() => { window.__flyTo = []; }")
        await page.fill('.route-wp-input[data-i="1"]', "Gibtsnicht")
        await page.focus('.route-wp-input[data-i="1"]')
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(700)
        status = await page.eval_on_selector("#route-status", "e => e.textContent")
        fly = await page.evaluate("() => window.__flyTo")
        sagen(len(fly) == 0 and "nicht gefunden" in status.lower(),
              "nicht gefunden: kein Flug, klare Meldung", f"{status!r} fly={len(fly)}")

        sagen(not seiten_fehler, "keine JS-Fehler unterwegs", "; ".join(seiten_fehler[:2]))
        await browser.close()
    print("\n" + ("ALLE TESTS OK" if not fehler else f"{fehler} FEHLER"))
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
