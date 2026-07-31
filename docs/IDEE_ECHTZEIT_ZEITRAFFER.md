# Idee: Echtzeit-Animation mit Beschleunigungsfaktor

**Status:** Prototyp gebaut, dann **zurückgerollt**. Kein Code mehr im Repo.
**Datum:** 2026-07-31
**Basis-Commit:** `184e81d` (v0.9.485)
**Patch zum Wiederanwenden:** `docs/patches/echtzeit-zeitraffer-v1.patch`

## Warum dieses Dokument existiert

Marc hat die Idee im **schulferien.eu-Chat** gepostet (Chat-Verwechslung). Der Chat hat sie
umgesetzt, statt zurückzufragen. Nach Marcs Stopp wurden alle Änderungen rückgängig gemacht.
Dieses Dokument hält Idee, Analyse und Prototyp fest, damit der GPS-Studio-Chat nicht bei
null anfängt — **die Denkarbeit war brauchbar, nur der Ort war falsch.**

Es wurde **nichts** gebaut, committet, getaggt oder deployed. Die installierte `.app` war
und ist unberührt.

## Die Idee (Marc, wörtlich)

> Noch eine Idee:
>
> Der Track bzw. das Video ist aktuell schön mit Intro, Animation und Hold in Sekunden
> einzustellen. Es wäre aber theoretisch auch möglich, dass Echtzeit mit eine
> Beschleunigungsfaktor animiert wird. Ich kann dann immer noch den Track in
> Geschwindigkeit mal X animieren lassen. Also einen 6 Stunden Track in 100facher
> Geschwindigkeit animieren lassen. Dann dauert die Animation wohl 3,6 Minuten. Ist auch
> nur ein Beispiel. Eher mal 200 oder mehr.

## Der zentrale Befund — warum das mehr ist als ein Dreisatz

Die naheliegende Umsetzung wäre: Trackdauer ÷ Faktor rechnen und in `duration_s` schreiben.
**Das reicht nicht**, und der Grund ist der eigentliche Wert dieser Analyse:

Der Animator bildet Frames **punktproportional** auf den Track ab, nicht zeitproportional.
In `core/animator.py`:

```python
coords_per_frame = _trim_n / max(1, anim_frames)
rel = int(anim_frame * coords_per_frame)
```

Jeder Frame rückt also um dieselbe **Anzahl GPS-Punkte** weiter — unabhängig davon, wie viel
Zeit zwischen diesen Punkten vergangen ist. Konsequenzen bei einem echten Track:

- **Eine 45-Minuten-Mittagspause verschwindet.** Der Logger schreibt beim Stillstand kaum
  Punkte, also überspringt die Animation die Pause in Sekundenbruchteilen.
- **Eine schnelle Autobahn-Etappe wird künstlich gedehnt**, weil dort dicht geloggt wird.
- Ein Label „×200" wäre damit **schlicht falsch** — die Animation zeigt keine
  200-fach beschleunigte Realität, sondern eine gleichmäßig abgelaufene Punktliste.

Ein ehrlicher Beschleunigungsfaktor braucht deshalb zwingend, dass der Marker der
**Zeitachse** (`elapsed_s`) folgt statt der Punktliste. Genau das macht der Prototyp.

## Was der Prototyp gemacht hat

Vier Dateien, ~160 Zeilen echte Änderung.

### 1. `core/animator.py`

Zwei neue Config-Felder:

```python
speed_mode: str = "fixed"      # "fixed" (wie bisher) | "realtime"
speed_factor: float = 100.0
```

Und eine neue Abbildung Frame → Punkt, direkt nach `coords_per_frame`:

```python
def _rel_idx(anim_frame: int) -> int:
    """Punkt-Offset relativ zu _start_idx für einen Frame der Anim-Phase."""
    if _elapsed_rel:
        p = min(1.0, max(0.0, anim_frame / max(1, anim_frames)))
        ziel = p * _elapsed_rel[-1]
        return min(bisect.bisect_left(_elapsed_rel, ziel), _trim_n - 1)
    return int(anim_frame * coords_per_frame)
```

`_elapsed_rel` ist die auf den Trim-Bereich normierte Zeitachse. Zwei Absicherungen sind
drin und sollten bei einem Neuanlauf erhalten bleiben:

- **Monotonie erzwingen.** GPS-Uhrensprünge und Ausreißer erzeugen rückwärts laufende
  Zeitstempel; `bisect` liefert dann Unsinn. Der Prototyp zieht die Liste monoton.
- **Automatischer Rückfall.** Track ohne Zeitstempel oder mit < 0,5 s Spanne → `fixed`,
  mit Logeintrag. Der Modus darf nie hart scheitern.

Beide Nutzungsstellen von `coords_per_frame` wurden auf `_rel_idx()` umgestellt — die
Kamera-Keyframes **und** der Marker. `bisect` ist in `animator.py` bereits importiert (Z. 11).

### 2. `app.py`

Die zwei Felder aus den UI-Params an `AnimatorConfig` durchgereicht (~Z. 2042).

### 3. `modules/animator/ui/module.js`

- Auswahl „Feste Dauer" / „Echtzeit im Zeitraffer" plus Faktor-Regler (10–2000).
- `_speedSync()` rechnet Trackzeit ÷ Faktor, schreibt das Ergebnis in `duration_s`,
  sperrt das Dauer-Feld und zeigt im Klartext: „6 h 12 min Trackzeit ÷ 200 ≈ 1 min 52 s".
- `_speedRealtimeIdx()` spiegelt `_rel_idx()` **exakt** in JS (binäre Suche über
  `_ovSeries.cumTimeS`), damit Vorschau und Render nicht auseinanderlaufen.
- `anim-dur` max von 60 auf 3600 erhöht — sonst deckelt die UI lange Tracks bei
  niedrigem Faktor.

### 4. `i18n/de.json`, `en.json`, `es.json`

Fünf neue Keys je Sprache.

## Offene Punkte — das ist ungetestet

Der Prototyp ist **syntaktisch geprüft, aber nie in der App gelaufen**. Wer ihn wieder
aufgreift, sollte diese Punkte zuerst klären:

1. **`_ovSeries.cumTimeS` ist eine Annahme.** Der JS-Teil setzt voraus, dass dieses Array
   dieselbe Indizierung wie `currentCoords` hat. Das wurde **nicht verifiziert**. Stimmt es
   nicht, läuft die Vorschau gegenüber dem Render versetzt.
2. **`duration_s` ist `int`.** Bei sehr hohen Faktoren rundet die Dauer grob; bei sehr
   niedrigen entstehen Videos jenseits von 3600 s. Grenzen bewusst setzen.
3. **Konflikt mit gespeicherten Settings.** `_speedSync()` überschreibt `duration_s`
   automatisch. Wie sich das mit `bindSetting`-Persistenz und dem Undo-Snapshot verträgt,
   ist offen — möglicher Reiz-Punkt für „meine Einstellung springt zurück"-Bugs.
4. **Tour-Map-Spiegelung fehlt.** Laut Projektregel müssen Animator und Tour-Map bei
   Kamera-/Render-Logik synchron bleiben. `core/tourmap.py` wurde **nicht** angefasst.
5. **Interaktion mit Intro/Hold** ist ungeprüft — die sind weiter in Sekunden, nur die
   Anim-Phase folgt der Trackzeit. Vermutlich richtig so, aber ungetestet.
6. **Ein echter Track mit Pause fehlt als Testfall.** Der Testtrack im Prototyp war zu
   gleichmäßig, um den Unterschied zwischen punkt- und zeitproportional sichtbar zu machen.
   Ohne so einen Track lässt sich das Feature nicht ehrlich abnehmen.

## Gotcha für i18n — kostete beim Revert die meiste Diff-Fläche

Die drei JSON-Dateien wurden mit `json.dump(..., sort_keys=True)` geschrieben. Das hat die
Dateien **komplett neu sortiert**: 2763 geänderte Zeilen pro Datei statt 5 neuer Keys —
über 8000 Zeilen Diff-Rauschen für 15 Übersetzungen.

**Merke:** i18n-JSONs immer positionsgenau ergänzen (gezielter Edit), niemals per
`json.dump` neu schreiben. Sonst ist jeder Review und jedes `git diff` unbrauchbar.

## Wiederanwenden

```bash
cd /Users/docarzt/Claude-Masterblaster/Reisezoom-GPS-Studio
git apply --check docs/patches/echtzeit-zeitraffer-v1.patch   # erst prüfen
git apply docs/patches/echtzeit-zeitraffer-v1.patch
```

Der Patch enthält **nur** `app.py`, `core/animator.py` und `modules/animator/ui/module.js` —
die i18n-Dateien bewusst nicht (siehe Gotcha oben). Die fünf Keys je Sprache müssen von Hand
ergänzt werden:

| Key | Deutsch |
|---|---|
| `animator.field.speed_mode` | Tempo der Animation |
| `animator.speed.fixed` | Feste Dauer (oben eingestellt) |
| `animator.speed.realtime` | Echtzeit im Zeitraffer |
| `animator.field.speed_factor` | Beschleunigung |
| `animator.speed.notime` | Dieser Track hat keine Zeitstempel — es bleibt bei der festen Dauer. |

Der JS-Code ruft `t()` durchgehend mit Fallback-Text auf, funktioniert also auch ohne die
Keys — dann eben einsprachig deutsch.

## Empfehlung

Die Idee ist gut und der Kernbefund (punkt- statt zeitproportional) gilt unabhängig davon,
ob der Prototyp weiterverwendet wird. Der Patch ist ein **Startpunkt, keine
abnahmefähige Version** — Punkt 1 und 6 der offenen Liste sollten vor allem anderen geklärt
werden.

Ein Nebeneffekt ist erwähnenswert: Wenn der Marker der Zeitachse folgt, wird der bestehende
Modus im Rückblick als das erkennbar, was er ist — eine gleichmäßige Punkt-Abspielung. Das
ist für viele Tracks völlig in Ordnung und soll Default bleiben.
