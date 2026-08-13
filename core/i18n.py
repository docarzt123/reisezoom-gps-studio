"""
Lokalisierung. Lädt JSON-Sprachfiles aus i18n/, erkennt System-Sprache.

Strings sind flach (key → value), z.B. `t("button.pick_gpx")`.
Fallback-Kette: gewünschte Sprache → Englisch → Schlüsselname.

Verfügbare Sprachen werden aus dem `i18n/`-Verzeichnis gelesen (jede `.json`
darin ist eine Sprache). Aktuell: de, en, es.
"""
from __future__ import annotations

import json
import locale
import subprocess
import sys
from pathlib import Path
from typing import Optional


# Default-Sprache (Fallback wenn weder gewählte noch System-Sprache erkannt)
DEFAULT_LANG = "en"

# Cache geladener Sprachfiles
_cache: dict[str, dict] = {}
_i18n_dir: Optional[Path] = None


def set_i18n_dir(path: Path) -> None:
    """Wird beim App-Start aufgerufen — sagt der Lib wo die JSON-Files liegen."""
    global _i18n_dir
    _i18n_dir = Path(path)


def get_i18n_dir() -> Optional[Path]:
    return _i18n_dir


def available_locales() -> list[dict]:
    """Liste aller verfügbaren Sprachen mit Label.
    Format: [{"code": "de", "label": "Deutsch", "native_label": "Deutsch"}, …]
    """
    if _i18n_dir is None or not _i18n_dir.exists():
        return []
    out = []
    for f in sorted(_i18n_dir.glob("*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            meta = data.get("_meta") or {}
            out.append({
                "code": f.stem,
                "label": meta.get("label_en") or f.stem,
                "native_label": meta.get("label_native") or meta.get("label_en") or f.stem,
            })
        except Exception:
            continue
    return out


def detect_system_locale() -> str:
    """Erkennt die Systemsprache auf macOS/Linux/Windows.

    macOS: `defaults read -g AppleLanguages` liefert eine sortierte Liste der
    User-bevorzugten Sprachen, z.B. ['de-DE', 'en-US', …]. Wir nehmen die erste.
    """
    code: Optional[str] = None

    if sys.platform == "darwin":
        try:
            r = subprocess.run(
                ["defaults", "read", "-g", "AppleLanguages"],
                capture_output=True, text=True, timeout=3,
            )
            if r.returncode == 0 and r.stdout:
                # Output ist ein Apple-Plist-Array — wir greppen das erste Sprach-Tag
                import re
                m = re.search(r'"?([a-z]{2})(?:[-_][A-Za-z0-9]+)?"?', r.stdout)
                if m:
                    code = m.group(1).lower()
        except Exception:
            pass

    if code is None:
        try:
            loc = locale.getlocale()[0] or locale.getdefaultlocale()[0]
            if loc:
                code = loc.split("_")[0].split("-")[0].lower()
        except Exception:
            pass

    if code is None:
        code = DEFAULT_LANG

    # Auf verfügbare Sprachen mappen
    avail = {x["code"] for x in available_locales()}
    if code in avail:
        return code
    if DEFAULT_LANG in avail:
        return DEFAULT_LANG
    return next(iter(avail), DEFAULT_LANG)


def load(code: str) -> dict:
    """Lädt ein Sprachfile (cached). Bei Fehler: leeres Dict."""
    if code in _cache:
        return _cache[code]
    if _i18n_dir is None:
        return {}
    p = _i18n_dir / f"{code}.json"
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        _cache[code] = data
        return data
    except Exception:
        return {}


def uebersetzer(code: str):
    """t(key, fallback) für die Backend-Renderer (v0.9.507).

    Videos, Standbilder und Web-Exporte müssen in der App-Sprache beschriftet
    sein — bis v0.9.506 waren die Overlay-Beschriftungen deutsch einprogrammiert,
    und ein spanischer Nutzer bekam Videos mit „ZURÜCKGELEGT" und „HÖHENPROFIL",
    während die Vorschau korrekt Spanisch zeigte.

    ⚠️ Bewusst dieselben Schlüssel wie die Oberfläche (z. B.
    `animator.statsfield.dist_done`): Vorschau und Render müssen wortgleich
    sein, sonst sieht der Render „falsch" aus, obwohl er nur anders übersetzt.
    """
    strings = get_strings(resolve(code or "auto"))

    def t(key: str, fallback: str = "") -> str:
        v = strings.get(key)
        return v if isinstance(v, str) and v else fallback
    return t


def resolve(code: str) -> str:
    """Übersetzt 'auto' zur tatsächlichen System-Sprache."""
    if code == "auto" or not code:
        return detect_system_locale()
    return code


def get_strings(code: str) -> dict:
    """Liefert das vollständige Strings-Dict für die UI.
    Wenn Schlüssel im gewählten Sprachfile fehlen, werden sie aus DEFAULT_LANG ergänzt."""
    base = load(DEFAULT_LANG) or {}
    user = load(code) if code != DEFAULT_LANG else base
    # Tiefes Merge (nur 2 Ebenen — wir haben keine tieferen Verschachtelungen)
    out = {}
    for k, v in base.items():
        if isinstance(v, dict):
            merged = dict(v)
            if isinstance(user.get(k), dict):
                merged.update(user[k])
            out[k] = merged
        else:
            out[k] = user.get(k, v)
    # User-only Keys (die in der Default-Sprache fehlen)
    for k, v in user.items():
        if k not in out:
            out[k] = v
    return out
