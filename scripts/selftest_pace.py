"""
Die Verteilungs-Auswahl im echten Browser (v0.9.506).

⚠️ Warum das ein eigener Selbsttest ist: ein Blick auf den Quelltext beweist
nicht, dass die Zahlen unter dem Pausen-Block **ankommen**. Beim ersten Anlauf
hieß der Aufruf `api("animator_pause_info", …)` statt
`api().animator_pause_info(…)` — `api` ist eine Funktion, die das Brücken-Objekt
liefert. Zurück kam stillschweigend das Objekt selbst, `r.ok` war undefined, und
die Zeile blieb einfach leer. Kein Fehler, keine Meldung, nichts. Aufgefallen ist
es erst beim Klicken in der echten App.

⚠️ Und: der Track muss über `loadGlobalGpx()` geladen werden. `currentGpx` lebt
im Modul-Closure; ein `window.currentGpx = …` von außen erreicht es nicht, und
der Test liefe ins Leere, ohne es zu merken.
"""
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from selftest_ui import MOCK_API_JS, UI_INDEX
from selftest_archiv import I18N_MOCK_JS

MOCK = """(() => {
  window.__rzTestAllOpen = true;   // 04.09.2026: Module starten eingeklappt — Prüfstand braucht die Regler sichtbar
  const echt = window.pywebview.api;
  window.__rufe = [];
  window.__pausen = 11;
  const koords = [];
  for (let i = 0; i < 60; i++) koords.push([11 + i * 0.001, 48 + i * 0.001]);
  // 04.09.2026 — der Prüfstand braucht eine ECHTE Sitzung mit persistierendem
  // Projekt: Der Animator aktiviert die Sitzung beim Kartenaufbau noch einmal;
  // kam die Antwort (früher: {ok:true} ohne Projekt) nach dem Umschalten auf
  // „echtes Tempo", überschrieb der Rebind die Wahl mit dem Mock-Stand → „gleichmäßig".
  // So verhält sich der Server: gespeicherte Einstellungen kommen beim nächsten
  // Öffnen zurück.
  window.__mockProj = window.__mockProj || { id: "p_pace", name: "Pace-Test", animator: {} };
  window.pywebview.api = new Proxy({
    session_open_for_track: async () => ({ ok: true, session: { track_hash: "h_pace", gpx_path: "/tmp/test.gpx" },
                                           active_project: window.__mockProj, projects: [window.__mockProj] }),
    project_save_settings: async (...args) => {
      const patch = args[args.length - 1], mod = args[args.length - 2];
      if (typeof mod === "string" && patch && typeof patch === "object") { const pr = window.__mockProj; pr[mod] = Object.assign(pr[mod] || {}, patch); }
      return { ok: true };
    },
    // Ein Track MIT Zeit, damit „echtes Tempo" freigegeben ist.
    animator_load_gpx: async (pfad) => ({
      ok: true, coords: koords, bbox: [11, 48, 11.06, 48.06],
      elevations: koords.map(() => 100), series: null,
      sensor_fields: [], chart_series: [],
      stats: { distance_km: 8.2, duration_s: 5400, ascent_m: 120, descent_m: 118,
               n_points: 60, moving_time_s: 4800, max_speed_kmh: 12 },
    }),
    // ⚠️ Muss mit dabei sein: sonst leitet der Proxy an die echte Brücke
    // weiter, die es im Browser nicht gibt — der Aufruf scheitert still, die
    // Vorschau fällt auf die gerade Verteilung zurück und der Test verglich
    // zweimal dasselbe. Hier eine bewusst SCHIEFE Tabelle (quadratisch), damit
    // ein Unterschied eindeutig erkennbar ist.
    animator_pace_map: async (p) => {
      window.__paceRufe = (window.__paceRufe || 0) + 1;
      if (p && p.pace_mode === "raw") return { ok: true, map: null };
      const n = 200, map = [];
      for (let i = 0; i < n; i++) { const x = i / (n - 1); map.push(x * x); }
      return { ok: true, map };
    },
    animator_pause_info: async (p) => {
      window.__rufe.push(p);
      return { ok: true, gesamt_s: 23220, pausen: window.__pausen,
               stillstand_s: 4740, laengste_s: 1800, anteil: 0.2, hat_zeit: true };
    },
  }, { get: (z, n) => (n in z) ? z[n] : echt[n] });
})();"""

fails = []


def check(name, cond, detail=""):
    print(f"  {'✓' if cond else '✗ FAIL'}  {name}" + (f"   [{detail}]" if detail and not cond else ""))
    if not cond:
        fails.append(name)


async def main():
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        pg = await (await b.new_context(viewport={"width": 1500, "height": 1000})).new_page()
        jsfehler = []
        pg.on("pageerror", lambda e: jsfehler.append(str(e)[:160]))
        for js in (MOCK_API_JS, I18N_MOCK_JS, MOCK):
            await pg.add_init_script(js)
        await pg.goto(f"file://{UI_INDEX.resolve()}", wait_until="domcontentloaded")
        await pg.wait_for_timeout(2500)
        # Seit E1 (v0.9.600) startet die App im Archiv/Projekte — dieser Test
        # prüft den Animator, also erst dorthin wechseln.
        await pg.evaluate("switchMod('animator')")
        await pg.wait_for_timeout(800)

        print("\n━━━ 1. Die Auswahl selbst ━━━")
        opts = await pg.eval_on_selector_all("#anim-pace option", "e=>e.map(x=>x.value)")
        check("drei Modi zur Wahl", opts == ["even", "real", "raw"], str(opts))
        check("die Erklärung steht schon vor der ersten Bedienung",
              bool((await pg.eval_on_selector("#anim-pace-desc", "e=>e.textContent")).strip()))
        check("ohne geladenen Track ist „echtes Tempo“ NICHT gesperrt",
              not await pg.eval_on_selector('#anim-pace option[value=real]', "e=>e.disabled"))
        check("der Pausen-Block ist zunächst versteckt",
              await pg.eval_on_selector("#anim-pause-box", "e=>e.hidden"))

        print("\n━━━ 2. Mit geladenem Track kommen die Zahlen ━━━")
        geladen = await pg.evaluate("window.loadGlobalGpx('/tmp/test.gpx')")
        check("der Track lädt über den offiziellen Weg", geladen is True, str(geladen))
        await pg.wait_for_timeout(1000)

        await pg.select_option("#anim-pace", "real")
        await pg.wait_for_timeout(1000)
        check("der Pausen-Block klappt auf",
              not await pg.eval_on_selector("#anim-pause-box", "e=>e.hidden"))
        check("das Backend wurde wirklich gefragt",
              await pg.evaluate("window.__rufe.length") > 0)
        # ⚠️ Der eigentliche Punkt — hier fiel der falsche Aufruf durch.
        text = (await pg.eval_on_selector("#anim-pause-info", "e=>e.textContent")).strip()
        check("die Zahlen stehen unter dem Block", bool(text), "(leer)")
        check("und es sind die der Tour, nicht Platzhalter", "11" in text, text[:90])
        check("in der Zeile steht kein unersetzter Platzhalter",
              "{" not in text, text[:90])

        print("\n━━━ 3. Die Schwelle wird mitgeschickt ━━━")
        await pg.fill("#anim-pause-min", "5")
        await pg.wait_for_timeout(900)
        letzt = await pg.evaluate("window.__rufe[window.__rufe.length-1]")
        check("„Pause ab 5 Min.“ kommt als 300 Sekunden an",
              letzt and abs(letzt.get("pause_min_s", 0) - 300) < 1, str(letzt))

        print("\n━━━ 4. Ohne Pausen wird das auch gesagt ━━━")
        await pg.evaluate("window.__pausen = 0")
        await pg.fill("#anim-pause-min", "9")
        await pg.wait_for_timeout(1000)
        text = (await pg.eval_on_selector("#anim-pause-info", "e=>e.textContent")).strip()
        check("statt einer leeren Zeile steht ein Satz da", bool(text), "(leer)")

        print("\n━━━ 5a. Die Zeile folgt der Video-Dauer ━━━")
        # ⚠️ Sie rechnet mit der Dauer; ändert man die, muss sie mitwandern.
        await pg.evaluate("window.__pausen = 11")
        await pg.fill("#anim-pause-min", "2")
        await pg.wait_for_timeout(900)
        await pg.select_option("#anim-pause-mode", "show")
        await pg.wait_for_timeout(800)
        vorher = (await pg.eval_on_selector("#anim-pause-info", "e=>e.textContent")).strip()
        await pg.fill("#anim-dur", "600")
        await pg.dispatch_event("#anim-dur", "input")
        await pg.wait_for_timeout(900)
        nachher = (await pg.eval_on_selector("#anim-pause-info", "e=>e.textContent")).strip()
        check("eine längere Dauer ändert die genannten Sekunden",
              vorher != nachher, f"vorher={vorher[-40:]!r} nachher={nachher[-40:]!r}")

        print("\n━━━ 5. „Überspringen“ blendet das Kürzen-Feld aus ━━━")
        await pg.select_option("#anim-pause-mode", "skip")
        await pg.wait_for_timeout(600)
        check("das Feld „kürzen auf“ verschwindet",
              await pg.eval_on_selector("#anim-pause-trim-box", "e=>e.hidden"))

        print("\n━━━ 5b. Der Wechsel wirkt sofort auf die Vorschau ━━━")
        # ⚠️ Das ist der Kern des Ganzen: die Vorschau muss dieselbe Verteilung
        # zeigen wie das spätere Video. Geprüft an der Punktnummer unter der
        # Zeitleiste („Punkt 538 / 800 · 46.7%") — sie kommt aus derselben
        # Umrechnung, die auch den Marker setzt.
        #
        # Zwei Fehler steckten hier: die Tabelle kam als Punkt-INDEX statt als
        # Anteil (der Marker klemmte ab einem Viertel am Ende fest), und beim
        # Zurückschalten auf „wie aufgezeichnet" wurde gar nicht neu gezeichnet.
        async def punkt_bei(modus, anteil=0.5):
            await pg.select_option("#anim-pace", modus)
            await pg.wait_for_timeout(900)
            await pg.evaluate(f"window.__rzTlBar && window.__rzTlBar.setScrubber({anteil})")
            await pg.evaluate("""(() => {
              // Den Scrubber über das offizielle Ereignis setzen, damit die
              // Vorschau mitzieht — sonst prüften wir nur ein Label.
              const el = document.querySelector('.timeline-track-overlay') ||
                         document.querySelector('.timeline-track');
              if (!el) return;
              const r = el.getBoundingClientRect();
              const x = r.left + r.width * 0.5;
              el.dispatchEvent(new MouseEvent('mousedown', {clientX: x, clientY: r.top + r.height/2, bubbles: true}));
              window.dispatchEvent(new MouseEvent('mouseup', {clientX: x, clientY: r.top + r.height/2, bubbles: true}));
            })()""")
            await pg.wait_for_timeout(700)
            return (await pg.eval_on_selector("#tl-status", "e=>e.textContent")).strip()

        # ⚠️ Ohne eigenes Zutun: nach dem Moduswechsel muss sich die Zahl
        # SOFORT ändern, nicht erst wenn man den Scrubber anfasst. Genau das
        # fiel beim Klicken auf: die Karte folgte, die Beschriftung nicht.
        #
        # Der Scrubber muss dafür in der MITTE stehen — am Anfang ist jede
        # Verteilung gleich (Punkt 1 bleibt Punkt 1), da wäre der Test blind.
        async def scrubber_in_die_mitte():
            await pg.evaluate("""(() => {
              const el = document.querySelector('.timeline-track-overlay') ||
                         document.querySelector('.timeline-track');
              if (!el) return;
              const r = el.getBoundingClientRect();
              const x = r.left + r.width * 0.5, y = r.top + r.height / 2;
              el.dispatchEvent(new MouseEvent('mousedown', {clientX: x, clientY: y, bubbles: true}));
              window.dispatchEvent(new MouseEvent('mouseup', {clientX: x, clientY: y, bubbles: true}));
            })()""")
            await pg.wait_for_timeout(600)

        await pg.select_option("#anim-pace", "raw")
        await pg.wait_for_timeout(800)
        await scrubber_in_die_mitte()
        vorher_label = (await pg.eval_on_selector("#tl-status", "e=>e.textContent")).strip()
        await pg.select_option("#anim-pace", "real")
        await pg.wait_for_timeout(1000)
        nachher_label = (await pg.eval_on_selector("#tl-status", "e=>e.textContent")).strip()
        check("die Punktanzeige folgt dem Wechsel ohne weiteres Zutun",
              vorher_label != nachher_label,
              f"vorher={vorher_label!r} nachher={nachher_label!r}")

        roh = await punkt_bei("raw")
        echt = await punkt_bei("real")
        zurueck = await punkt_bei("raw")
        check("„echtes Tempo“ steht an einem anderen Punkt als „wie aufgezeichnet“",
              roh != echt, f"raw={roh!r} real={echt!r}")
        check("und das Zurückschalten wirkt sofort wieder",
              zurueck == roh, f"vorher={roh!r} zurück={zurueck!r}")

        print("\n━━━ 6. Ein Track OHNE Zeit sperrt „echtes Tempo“ ━━━")
        # Vorher bewusst auf „echtes Tempo" stellen — nur dann ist der Rückfall
        # überhaupt gefragt. Stünde „wie aufgezeichnet", bliebe das richtigerweise
        # stehen.
        await pg.select_option("#anim-pace", "real")
        await pg.wait_for_timeout(600)
        await pg.evaluate("""(() => {
          const echt = window.pywebview.api;
          const koords = []; for (let i = 0; i < 30; i++) koords.push([12 + i*0.001, 49 + i*0.001]);
          window.pywebview.api = new Proxy({
            animator_load_gpx: async () => ({ ok: true, coords: koords,
              bbox: [12, 49, 12.03, 49.03], elevations: koords.map(() => 0),
              series: null, sensor_fields: [], chart_series: [],
              // ⚠️ duration_s = 0 → geplante Route ohne Zeitstempel
              stats: { distance_km: 4, duration_s: 0, ascent_m: 0, descent_m: 0,
                       n_points: 30, moving_time_s: 0, max_speed_kmh: 0 } }),
          }, { get: (z, n) => (n in z) ? z[n] : echt[n] });
        })()""")
        await pg.evaluate("window.loadGlobalGpx('/tmp/geplant.gpx')")
        await pg.wait_for_timeout(1200)
        check("„echtes Tempo“ ist jetzt gesperrt",
              await pg.eval_on_selector('#anim-pace option[value=real]', "e=>e.disabled"))
        check("und die Sperre wird begründet",
              len(await pg.eval_on_selector('#anim-pace option[value=real]', "e=>e.textContent")) > 12)
        check("die Wahl fällt auf „gleichmäßig“ zurück",
              await pg.eval_on_selector("#anim-pace", "e=>e.value") == "even")
        check("und der Pausen-Block ist wieder weg",
              await pg.eval_on_selector("#anim-pause-box", "e=>e.hidden"))

        print("\n━━━ 7. Die Einstellungen kommen beim Render an ━━━")
        # ⚠️ Die letzte Lücke: zwischen Bedienelement und Renderer liegt eine
        # Namensübergabe. Stimmt dort ein Schlüssel nicht, rendert die App
        # klaglos mit der Vorgabe weiter — die Vorschau zeigt „echtes Tempo",
        # das Video ist „wie aufgezeichnet", und niemand merkt es.
        # ⚠️ Auch das Laden neu mocken: Abschnitt 6 hat einen Track OHNE Zeit
        # gesetzt, sonst bliebe „echtes Tempo" gesperrt und der Test scheiterte
        # an einer gesperrten Auswahl statt an der Sache.
        await pg.evaluate("""(() => {
          const echt = window.pywebview.api;
          window.__renderParams = null;
          const koords = []; for (let i = 0; i < 60; i++) koords.push([11 + i*0.001, 48 + i*0.001]);
          window.pywebview.api = new Proxy({
            animator_load_gpx: async () => ({ ok: true, coords: koords,
              bbox: [11, 48, 11.06, 48.06], elevations: koords.map(() => 100),
              series: null, sensor_fields: [], chart_series: [],
              stats: { distance_km: 8.2, duration_s: 5400, ascent_m: 120, descent_m: 118,
                       n_points: 60, moving_time_s: 4800, max_speed_kmh: 12 } }),
            // Der Knopf fragt zuerst nach dem Speicherort — ohne diesen Mock
            // kommt der Render nie bis zur Übergabe.
            pick_save_path: async () => "/tmp/rz_test_render.mp4",
            animator_start_render: async (p) => { window.__renderParams = p; return {ok: true}; },
          }, { get: (z, n) => (n in z) ? z[n] : echt[n] });
        })()""")
        await pg.evaluate("window.loadGlobalGpx('/tmp/test.gpx')")
        await pg.wait_for_timeout(900)
        await pg.select_option("#anim-pace", "real")
        await pg.wait_for_timeout(700)
        await pg.select_option("#anim-pause-mode", "skip")
        await pg.fill("#anim-pause-min", "4")
        await pg.wait_for_timeout(700)
        # 03.09.2026 — der Prüfstand fährt den Mapbox-Stil; der Rechtelage-Hinweis
        # vor dem Video-Render (Kartenanbieter-Umbau) ist hier nicht Gegenstand.
        await pg.evaluate("window.__rzRightsAck = true")
        await pg.click("#anim-render")
        await pg.wait_for_timeout(1500)
        prm = await pg.evaluate("window.__renderParams")
        check("der Render wurde überhaupt angestoßen", bool(prm), str(prm)[:60])
        if prm:
            check("die Verteilung kommt an", prm.get("pace_mode") == "real", str(prm.get("pace_mode")))
            check("die Pausen-Behandlung kommt an", prm.get("pause_mode") == "skip", str(prm.get("pause_mode")))
            check("die Schwelle kommt in Sekunden an",
                  abs((prm.get("pause_min_s") or 0) - 240) < 1, str(prm.get("pause_min_s")))
            check("und die Kürzung ist eine Zahl",
                  isinstance(prm.get("pause_trim_s"), (int, float)), str(prm.get("pause_trim_s")))

        check("keine JavaScript-Fehler", not jsfehler, str(jsfehler))
        await b.close()

    print("\n" + ("✅ Verteilungs-Auswahl im Browser bestanden" if not fails
                  else f"❌ {len(fails)} gescheitert: {fails}"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
