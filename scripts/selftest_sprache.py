"""
Die Oberfläche auf Spanisch — im echten Browser (v0.9.508).

⚠️ Warum das nötig ist: `check_i18n.py` prüft, dass die Schlüssel in allen drei
Dateien stehen. Es prüft NICHT, ob der Code sie auch benutzt. Genau das war der
Fehler des spanischen Nutzers: die Schlüssel existierten, der Renderer griff
aber auf einprogrammierte deutsche Texte zurück.

Hier laden wir die Oberfläche mit spanischen Strings und schauen nach, was
tatsächlich im DOM steht.
"""
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from selftest_ui import MOCK_API_JS, UI_INDEX

_ES = json.loads((ROOT / "i18n" / "es.json").read_text(encoding="utf-8"))
I18N_ES = (
    "(() => { const s = " + json.dumps(_ES, ensure_ascii=False) + ";"
    " window.__rzI18n = { ok: true, strings: s, active: \"es\","
    " requested: \"es\", system_locale: \"es\", available: [\"es\"] }; })();"
)

fails = []


def check(name, cond, detail=""):
    print(f"  {'✓' if cond else '✗ FAIL'}  {name}" + (f"   [{detail}]" if detail and not cond else ""))
    if not cond:
        fails.append(name)


# Wörter, die auf Spanisch NIRGENDS in der Oberfläche stehen dürfen.
DEUTSCHE_VERRAETER = [
    "Zurückgelegt", "Höhenprofil", "Bergauf", "Bergab", "Strecke",
    "Rückgängig", "Wiederherstellen", "Keyframe gelöscht", "Track Dateien",
    "US-Westküste", "Mitteleuropa", "Alle Dateien",
]


async def main():
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        pg = await (await b.new_context(viewport={"width": 1500, "height": 950})).new_page()
        jsfehler = []
        pg.on("pageerror", lambda e: jsfehler.append(str(e)[:160]))
        await pg.add_init_script(MOCK_API_JS)
        await pg.add_init_script(I18N_ES)
        # ⚠️ Der Standard-Mock kennt `i18n_get_strings` nicht — ohne diese
        # Ergänzung läuft die Oberfläche auf den eingebauten Fallbacks (also
        # deutsch) und der Test prüfte nichts.
        await pg.add_init_script(
            "(() => { const echt = window.pywebview.api;"
            " window.pywebview.api = new Proxy({"
            "   i18n_get_strings: async () => window.__rzI18n,"
            " }, { get: (z, n) => (n in z) ? z[n] : echt[n] }); })();")
        await pg.goto(f"file://{UI_INDEX.resolve()}", wait_until="domcontentloaded")
        await pg.wait_for_timeout(2600)

        print("\n━━━ 1. Die Übersetzung ist überhaupt aktiv ━━━")
        check("i18n meldet Spanisch",
              await pg.evaluate("(window.i18nMeta && i18nMeta().active) || ''") == "es")
        check("t() liefert Spanisch",
              await pg.evaluate('t("animator.statsfield.dist_done", "X")') == "Recorrido")

        print("\n━━━ 2. Die neuen Schlüssel sind wirklich verdrahtet ━━━")
        # Datei-Filter (wird beim Laden von gpx-bar.js gebaut)
        filt = await pg.evaluate("(window.TRACK_PICK_FILTER || [])[0] || ''")
        check("der Track-Dateifilter ist spanisch", "Archivos de track" in filt, filt)
        check("und die Endungen blieben stehen", "*.gpx" in filt, filt)

        # Zeitzonen im Geotagger — beim Modul-Aufbau erzeugt
        await pg.evaluate("""(() => {
          const btn = document.querySelector('[data-mod="geotagger"]');
          if (btn) btn.click();
        })()""")
        await pg.wait_for_timeout(1500)
        # Die Zeitzonen-Auswahl sitzt im Zeitversatz-Dialog (Knopf „gt-off-edit"),
        # nicht in der Seitenleiste — erst öffnen.
        await pg.evaluate("document.getElementById('gt-off-edit')?.click()")
        await pg.wait_for_timeout(900)
        tz = await pg.eval_on_selector_all("#md-offset-tz option", "e=>e.map(x=>x.textContent)")
        tz_text = " | ".join(tz)
        if tz:
            check("die Zeitzonen-Hinweise sind spanisch",
                  "Costa oeste" in tz_text or "Europa Central" in tz_text, tz_text[:120])
            check("„UTC“ selbst blieb unangetastet", "UTC" in tz_text)
        else:
            check("Zeitzonen-Auswahl gefunden", False, "kein #gt-tz")

        # ⚠️ Dialog wieder zu — ein offenes Modal legt sich über die
        # Modul-Leiste und alle folgenden Klicks laufen in einen Timeout.
        await pg.evaluate("try { window.openModal({}).close(); } catch (e) {}")
        await pg.wait_for_timeout(500)

        print("\n━━━ 3. Kein deutsches Wort im sichtbaren Text ━━━")
        # Durch alle Module klicken und den sichtbaren Text einsammeln.
        module = await pg.eval_on_selector_all("[data-mod]", "e=>e.map(x=>x.dataset.mod)")
        gesehen = []
        for mod in module:
            try:
                await pg.click(f'[data-mod="{mod}"]')
                await pg.wait_for_timeout(700)
                txt = await pg.evaluate("document.body.innerText")
                gesehen.append((mod, txt))
            except Exception as e:
                print(f"    (Modul {mod} übersprungen: {str(e)[:60]})")
        check("alle Module ließen sich öffnen", len(gesehen) >= 6, str(len(gesehen)))
        for wort in DEUTSCHE_VERRAETER:
            treffer = [m for m, t in gesehen if wort in t]
            check(f"„{wort}“ steht nirgends", not treffer, str(treffer))

        print("\n━━━ 3b. Die Kopfleiste verträgt lange Namen ━━━")
        # ⚠️ Die Kopfleiste ist auf 56 px festgelegt. Spanische und englische
        # Modulnamen sind länger als die deutschen; brach einer um, schob die
        # zweite Zeile den Namen aus der Leiste — sichtbar blieb „de viaje"
        # statt „Ruta de viaje". Beim Test in der echten App aufgefallen.
        masse = await pg.evaluate("""(() => {
          const bar = document.querySelector(".topbar");
          const h = bar ? bar.getBoundingClientRect().height : 0;
          const namen = Array.from(document.querySelectorAll(".mod-name"));
          return {
            barH: Math.round(h),
            ueber: namen.filter(e => {
              const r = e.getBoundingClientRect(), b = bar.getBoundingClientRect();
              return r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5;
            }).map(e => e.textContent.trim()),
            mehrzeilig: namen.filter(e => e.getBoundingClientRect().height > 20)
                             .map(e => e.textContent.trim()),
            texte: namen.map(e => e.textContent.trim()),
          };
        })()""")
        check("die Modulnamen sind da", len(masse["texte"]) >= 6, str(masse["texte"]))
        check("kein Name ragt aus der Kopfleiste", not masse["ueber"], str(masse["ueber"]))
        check("kein Name bricht auf zwei Zeilen um", not masse["mehrzeilig"], str(masse["mehrzeilig"]))
        check("„Ruta de viaje“ steht vollständig da",
              any("Ruta de viaje" in x for x in masse["texte"]), str(masse["texte"]))

        # ⚠️ Die Knöpfe rechts (Einstellungen!) dürfen nie aus dem Fenster
        # geschoben werden — sie sind der einzige Weg zu Sprache und Token.
        # Genau das passierte, als die Namen einzeilig und damit breiter wurden.
        rechts = await pg.evaluate("""(() => {
          const a = document.querySelector(".topbar-actions");
          if (!a) return null;
          const r = a.getBoundingClientRect();
          return { rechtsKante: Math.round(r.right), fenster: Math.round(window.innerWidth),
                   breite: Math.round(r.width) };
        })()""")
        check("die Knöpfe rechts existieren", bool(rechts), str(rechts))
        if rechts:
            check("und liegen vollständig im Fenster",
                  rechts["rechtsKante"] <= rechts["fenster"] + 1 and rechts["breite"] > 0,
                  str(rechts))
        # Alle Module müssen erreichbar sein — notfalls kompakt, aber nicht
        # abgeschnitten hinter den Nachbarn.
        sichtbar = await pg.evaluate("""(() => {
          const w = document.getElementById("module-tabs");
          if (!w) return null;
          return { ueberlauf: w.scrollWidth - w.clientWidth,
                   kompakt: w.className, anzahl: w.querySelectorAll(".mod-btn").length };
        })()""")
        check("die Modulleiste läuft nicht über",
              sichtbar and sichtbar["ueberlauf"] <= 1, str(sichtbar))

        print("\n━━━ 4. Der Erste-Schritte-Guide ━━━")
        await pg.evaluate("window.openQuickstart && window.openQuickstart('animator')")
        await pg.wait_for_timeout(900)
        qs = await pg.evaluate("document.body.innerText")
        check("der Guide ist spanisch",
              "vídeo" in qs.lower() or "cámara" in qs.lower(), qs[:120])
        check("und nicht mehr deutsch", "Kamera fliegt" not in qs)

        check("keine JavaScript-Fehler", not jsfehler, str(jsfehler[:2]))
        await b.close()

    print("\n" + ("✅ Oberfläche auf Spanisch bestanden" if not fails
                  else f"❌ {len(fails)} gescheitert: {fails}"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
