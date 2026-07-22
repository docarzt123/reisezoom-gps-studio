# Test-Protokoll — vor jedem Release

Läuft **vor jedem Release** durch. Zwei Teile:

- **Teil A — automatische Gates** (`./scripts/release_check.sh`): schnell, deterministisch, blockiert bei Fehler.
- **Teil B — manuelle Sichtprüfung** (Pflicht-Checkliste): fängt genau das, was Automatik nicht sieht — ob der Track am Bildschirm **sichtbar** ist, ob die Vorschau dem Render entspricht (WYSIWYG).

> **Warum beides?** Der v0.9.469-Bug („Track wird nicht gezeichnet") ist durch alle automatischen Tests durchgerutscht: Daten luden, Layer/Kamera/Farbe stimmten — nur die Vorschau-Linie hatte 1 Punkt und war unsichtbar. Headless lässt sich die Mapbox-Vorschau nicht zuverlässig befüllen (Token/WebGL/Timing). **Gefangen hätte den Bug nur ein Mensch, der einen Track lädt und hinschaut.** Deshalb ist Teil B kein „nice to have", sondern Release-Gate.

---

## Teil A — Automatische Gates

```bash
cd Reisezoom-GPS-Studio
./scripts/release_check.sh          # schnell (Sekunden–1 Min)
./scripts/release_check.sh --full   # zusätzlich echte Video-Renders (langsam, braucht Token)
```

Grün = alle Gates bestanden. Exit ≠ 0 = Release blockiert.

| # | Gate | Prüft |
|---|------|-------|
| 1 | JS-Syntax | `node --check` auf allen `ui/js/*.js` + `modules/*/ui/module.js` |
| 2 | Python-Syntax | `py_compile` auf `app.py`, `core/*.py`, `scripts/*.py` |
| 3 | i18n-Konsistenz | DE/EN/ES deckungsgleich, keine fehlenden Keys (`check_i18n.py`) |
| 4 | Fix-Invarianten | kritische Regressions-Guards noch im Code (z. B. Track-Sichtbarkeits-Fallback) |
| 5 | UI-Smoke | alle Module laden headless, 0 pageerrors (`selftest_ui.py`) |
| 6 | UI-Tiefentest | jeder Regler/Akkordeon/Undo, 0 pageerrors (`selftest_deep.py`) |
| 7 | Track-Sichtbarkeit | `preview-track`-Quelle ≥ 2 Punkte — *best effort*, SKIPt wenn headless nicht befüllbar (`selftest_track_visible.py`) |
| 8 | Echte Renders | nur mit `--full`: rendert echte Videos über `core/animator.py` (`selftest_renders.py`) |

Gate 7 ist **selbst-kalibrierend**: kann die Umgebung die Vorschau nicht befüllen, meldet es SKIP + Manuell-Hinweis (kein falsches Grün). Deshalb ersetzt es **nicht** Teil B.

---

## Teil B — Manuelle Sichtprüfung (PFLICHT)

In der frisch gebauten `.app` (nicht Dev-Modus). Einen echten Track laden. Jede Zeile abhaken:

### B1 · Track-Sichtbarkeit — **wichtigster Punkt**
- [ ] **Animator:** Track laden → Linie ist **sofort sichtbar** auf der Karte
- [ ] Animator: „Ganzer Track" **AN** → ganze Linie sichtbar
- [ ] Animator: „Ganzer Track" **AUS** → Linie ab Scrubber-Position sichtbar (nicht verschwunden)
- [ ] Animator: Scrubber ganz nach links → Track bleibt sichtbar (nicht auf 1 Punkt kollabiert)
- [ ] **Tour-Map:** selben Track laden → Linie sichtbar (bleibt sichtbar, verschwindet nicht nach 1 s)
- [ ] **Höhen-Animator:** Track laden → Höhenprofil-Kurve sichtbar
- [ ] **Geotagger:** Track laden → Track auf Karte sichtbar

### B2 · Probelauf / Vorschau
- [ ] Animator: **Probelauf startet** und die Kamera bewegt sich (nicht „nichts passiert")
- [ ] Tour-Map: Standbild-Vorschau zeigt Track + Pins
- [ ] Höhen-Animator: Probelauf animiert die Kurve

### B3 · WYSIWYG (Vorschau = Render)
- [ ] Ein kurzes Video rendern → Track/Kamera/Overlays sehen aus **wie in der Vorschau**
- [ ] Stats-Box / Overlays an derselben Position wie in der Vorschau

### B4 · Grundfunktionen
- [ ] Modul-Wechsel (Animator ↔ Tour-Map ↔ Höhe ↔ Geotagger) → Track bleibt geladen
- [ ] Projekt/Session wechseln → richtige Einstellungen laden
- [ ] App neu starten → letzter Zustand kommt sauber zurück
- [ ] „Erste Schritte" öffnen → **„Ganzes Handbuch"**-Button öffnet das Handbuch
- [ ] Handbuch: **Sprache DE/EN/ES** umschalten funktioniert

### B5 · Multi-Track
- [ ] (aktuell versteckt — nur prüfen wenn wieder aktiviert) zweiter Track hinzufügbar + sichtbar

> Findet ein Punkt einen Fehler → **kein Release.** Fix, dann Teil A + B erneut.

---

## Workflow-Einordnung

```
Backup → Code-Änderung → Doku (CHANGELOG/USER/DEV) → Version-Bump
      → ./scripts/release_check.sh   (Teil A grün)
      → ./build.sh                   (frische .app)
      → Teil B manuell in der .app   (alle Häkchen)
      → Marc: „passt / release"
      → git tag + push (+ ggf. deploy_release.sh)
```

**Ohne grünen Teil A UND vollständigen Teil B wird nicht getaggt/deployed.**
