#!/usr/bin/env python3
"""Dialoge übereinander — und sichtbare Tastaturbedienung.

Der Anlass
----------
Es gibt genau EIN Dialog-Fenster im HTML, und jeder neue Dialog überschrieb
dessen Inhalt. Das traf einen ganz normalen Weg mit drei Klicks:

    ⚙ Einstellungen öffnen → Sprache und Qualität ändern
    → „Wie bekomme ich einen Token?" → lesen → „OK"

Danach war der **komplette Einstellungsdialog zu**, alle Änderungen verloren,
ohne jede Meldung. Dasselbe über Hilfe-Menü und Über-Dialog.

Dazu: `:focus-visible` kam in der ganzen Oberfläche kein einziges Mal vor, und
auf allen Eingabefeldern stand `outline: none`. Wer die App per Tabulator
bedient, sah nicht, wo er steht.

Geprüft wird hier über den echten Weg im Browser, nicht über den Zustand im
Speicher.

Aufruf:  .venv/bin/python scripts/selftest_dialoge.py
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


async def main() -> int:
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1500, "height": 950})
        page = await ctx.new_page()
        seiten_fehler: list = []
        page.on("pageerror", lambda e: seiten_fehler.append(str(e)[:300]))

        await page.add_init_script(MOCK_API_JS)
        await page.goto(f"file://{UI_INDEX.resolve()}", wait_until="domcontentloaded")
        await page.wait_for_timeout(1800)

        # ── 1) Zwei Dialoge übereinander ──────────────────────────────────
        print("\n[1] Der untere Dialog kommt zurück")
        await page.evaluate("""() => {
          window.__restoreGerufen = 0;
          window.__unten = openModal({
            title: 'Unterer Dialog',
            body: '<input id="probe-feld" value="Ausgangswert">',
            footer: '<button id="probe-knopf">Speichern</button>',
          });
        }""")
        await page.wait_for_timeout(300)
        sagen(await page.evaluate("() => !!document.getElementById('probe-feld')"),
              "der untere Dialog steht")

        # Etwas eintippen — genau das ging vorher verloren.
        await page.fill("#probe-feld", "vom Nutzer geändert")

        await page.evaluate("""() => {
          window.__oben = openModal({
            title: 'Oberer Dialog',
            body: '<p id="oben-text">Hilfetext</p>',
            restorePrevious: () => { window.__restoreGerufen++; },
          });
        }""")
        await page.wait_for_timeout(300)
        sagen(await page.evaluate("() => !!document.getElementById('oben-text')"),
              "der obere Dialog liegt darüber")
        sagen(not await page.evaluate("() => !!document.getElementById('probe-feld')"),
              "der untere ist derweil nicht sichtbar")

        await page.evaluate("() => window.__oben.close()")
        await page.wait_for_timeout(300)

        offen = await page.evaluate(
            "() => !document.getElementById('modal-overlay').hidden")
        sagen(offen, "nach dem Schließen ist das Fenster NICHT zu")
        sagen(await page.evaluate("() => !!document.getElementById('probe-feld')"),
              "der untere Dialog ist zurück")
        wert = await page.evaluate("""() => {
          const f = document.getElementById('probe-feld');
          return f ? f.value : null; }""")
        sagen(wert == "vom Nutzer geändert",
              "und was der Nutzer eingetippt hatte, steht noch da", f"→ {wert!r}")
        sagen(await page.evaluate("() => window.__restoreGerufen") == 1,
              "der Rückweg zum Neu-Verdrahten wurde genau einmal gerufen")
        titel = await page.evaluate(
            "() => document.getElementById('modal-title').textContent")
        sagen(titel == "Unterer Dialog", "auch der Titel stimmt wieder", titel)

        # ── 2) Der letzte Dialog schließt wirklich ────────────────────────
        print("\n[2] Der letzte Dialog macht das Fenster zu")
        await page.evaluate("() => window.__unten.close()")
        await page.wait_for_timeout(300)
        sagen(await page.evaluate("() => document.getElementById('modal-overlay').hidden"),
              "das Fenster ist zu")
        sagen(await page.evaluate("() => document.getElementById('modal-body').innerHTML") == "",
              "und aufgeräumt")

        # ── 3) Drei Ebenen ───────────────────────────────────────────────
        print("\n[3] Auch drei Ebenen finden zurück")
        await page.evaluate("""() => {
          window.__a = openModal({ title: 'A', body: '<p id="pa">A</p>' });
          window.__b = openModal({ title: 'B', body: '<p id="pb">B</p>' });
          window.__c = openModal({ title: 'C', body: '<p id="pc">C</p>' });
        }""")
        await page.wait_for_timeout(300)
        await page.evaluate("() => window.__c.close()")
        await page.wait_for_timeout(200)
        sagen(await page.evaluate("() => !!document.getElementById('pb')"), "C zu → B da")
        await page.evaluate("() => window.__b.close()")
        await page.wait_for_timeout(200)
        sagen(await page.evaluate("() => !!document.getElementById('pa')"), "B zu → A da")
        await page.evaluate("() => window.__a.close()")
        await page.wait_for_timeout(200)
        sagen(await page.evaluate("() => document.getElementById('modal-overlay').hidden"),
              "A zu → Fenster zu")

        # ── 4) closeAllModals räumt den ganzen Stapel ─────────────────────
        print("\n[4] „Alles zu“ räumt den ganzen Stapel")
        await page.evaluate("""() => {
          openModal({ title: 'X', body: '<p>X</p>' });
          openModal({ title: 'Y', body: '<p>Y</p>' });
          closeAllModals();
        }""")
        await page.wait_for_timeout(300)
        sagen(await page.evaluate("() => document.getElementById('modal-overlay').hidden"),
              "auf einen Schlag zu")

        # ── 4b) Das ETABLIERTE Schließ-Idiom muss weiter funktionieren ───
        # `openModal({}).close()` steht an 43 Stellen hinter OK- und
        # Abbrechen-Knöpfen. Nach dem Umbau auf den Stapel legte es den offenen
        # Dialog beiseite und holte ihn sofort zurück — jeder dieser Knöpfe war
        # tot. Gemeldet als „Über Reisezoom GPS Studio hat der OK Button keine
        # Funktion". Der Test davor hat es NICHT gefangen, weil er nur die neue
        # Funktion prüfte und nie die bestehende Nutzung.
        print("\n[4b] „openModal({}).close()“ schließt wirklich")
        zu1 = await page.evaluate("""() => {
          openModal({ title: 'Über …', body: '<p>Text</p>',
                      footer: '<button id="ok">OK</button>' });
          openModal({}).close();
          return document.getElementById('modal-overlay').hidden; }""")
        sagen(zu1 is True, "ein einzelner Dialog geht damit zu")

        # Und bei gestapelten Dialogen darf es genau EINE Ebene schließen.
        zu2 = await page.evaluate("""() => {
          openModal({ title: 'A', body: '<p id="sa">A</p>' });
          openModal({ title: 'B', body: '<p id="sb">B</p>' });
          openModal({}).close();
          return { offen: !document.getElementById('modal-overlay').hidden,
                   aDa: !!document.getElementById('sa'),
                   bDa: !!document.getElementById('sb') }; }""")
        sagen(zu2["offen"] and zu2["aDa"] and not zu2["bDa"],
              "bei zwei Ebenen schließt es die obere und legt die untere frei",
              str(zu2))
        await page.evaluate("() => closeAllModals()")
        await page.wait_for_timeout(200)

        # ── 5) Fokus ist sichtbar ────────────────────────────────────────
        print("\n[5] Tastaturbedienung ist sichtbar")
        # Echter Tastatur-Fokus: Der Ring muss sich am berechneten Stil
        # zeigen. Über die Stylesheet-Regeln zu gehen war zu indirekt —
        # entscheidend ist, was am Element ankommt.
        await page.evaluate("""() => {
          const b = document.createElement('button');
          b.id = 'probe-knopf-fokus';
          b.className = 'btn';
          b.textContent = 'Probe';
          document.body.appendChild(b);
        }""")
        await page.focus("#probe-knopf-fokus")
        # Tastatur-Fokus erzwingen: :focus-visible greift nach echtem Tastendruck.
        await page.keyboard.press("Shift+Tab")
        await page.keyboard.press("Tab")
        stil = await page.evaluate("""() => {
          const b = document.getElementById('probe-knopf-fokus');
          if (!b) return null;
          b.focus();
          const cs = getComputedStyle(b);
          const trifft = b.matches(':focus-visible');
          return { breite: cs.outlineWidth, stil: cs.outlineStyle,
                   farbe: cs.outlineColor, fokusSichtbar: trifft };
        }""")
        sagen(stil is not None, "der Probe-Knopf ist da")
        if stil:
            sagen(stil["stil"] == "solid" and stil["breite"] != "0px",
                  "bei Tastatur-Fokus liegt ein sichtbarer Ring an",
                  f"{stil['breite']} {stil['stil']} {stil['farbe']}")
        await page.evaluate(
            "() => { const b = document.getElementById('probe-knopf-fokus'); if (b) b.remove(); }")

        # ── 6) Die beiden erfundenen Farbnamen gibt es jetzt ──────────────
        print("\n[6] Farbnamen ohne Definition")
        for name in ("--panel-bg", "--muted", "--danger-strong", "--accent"):
            wert = await page.evaluate(
                f"() => getComputedStyle(document.documentElement)"
                f".getPropertyValue('{name}').trim()")
            sagen(bool(wert), f"{name} ist definiert", wert or "(leer)")

        sagen(not seiten_fehler, "keine JS-Fehler unterwegs",
              "; ".join(seiten_fehler[:2]))

        await browser.close()

    print("\n" + ("ALLE TESTS OK" if not fehler else f"{fehler} FEHLER"))
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
