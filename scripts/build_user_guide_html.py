#!/usr/bin/env python3
"""Generiert eine schick formatierte HTML-Version des USER_GUIDE.md.

- Eingebettetes Dark-Theme-CSS passend zur App-Optik.
- Single-File-HTML (keine externen Dependencies, kein JS) — kann im Browser
  oder einem WKWebView-Fenster geöffnet werden.
- Minimal-MD-Parser inline (keine `markdown`-pip-Dependency nötig):
  Headings (#-######), Paragraphs, Bold/Italic/Inline-Code, Code-Blocks
  (```), Listen (ordered + bullet), Blockquotes, Links, Horizontale Linien.

Aufruf manuell oder über build.sh:
    python3 scripts/build_user_guide_html.py
"""
from __future__ import annotations

import html as _html
import re
import sys
from pathlib import Path

# Windows-Default-Console-Encoding ist cp1252 → print(✅) crasht.
# UTF-8 erzwingen damit das Script auf allen CI-Plattformen läuft.
try:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except Exception:
    pass


ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "USER_GUIDE.md"
DST = ROOT / "docs" / "USER_GUIDE.html"


# ── Minimal-Markdown-Parser ────────────────────────────────────────────────
# Reicht für USER_GUIDE.md: Headings, Paragraphs, Code, Listen, Links.
# Wenn wir später eine richtige `markdown`-Library wollen: hier austauschen.

def _inline(s: str) -> str:
    """Inline-Markdown in einem Zeilen-Schnipsel zu HTML."""
    # Erst Code (damit darin enthaltene * / _ nicht als italic interpretiert werden)
    parts: list[str] = []
    i = 0
    code_re = re.compile(r"`([^`]+)`")
    for m in code_re.finditer(s):
        parts.append(_inline_no_code(s[i:m.start()]))
        parts.append("<code>" + _html.escape(m.group(1)) + "</code>")
        i = m.end()
    parts.append(_inline_no_code(s[i:]))
    return "".join(parts)


def _inline_no_code(s: str) -> str:
    """Inline-Replacements OHNE Code-Handling (das hat _inline schon gemacht)."""
    s = _html.escape(s)
    # Whitelist: sichere Inline-HTML-Tags aus der Quelle wieder durchlassen
    # (sonst erscheinen <kbd>/<br> wörtlich als Text). v0.9.253
    s = s.replace("&lt;kbd&gt;", "<kbd>").replace("&lt;/kbd&gt;", "</kbd>")
    s = (s.replace("&lt;br&gt;", "<br>")
          .replace("&lt;br/&gt;", "<br>")
          .replace("&lt;br /&gt;", "<br>"))
    # Links: [text](url)
    s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)",
               lambda m: f'<a href="{m.group(2)}" target="_blank" rel="noopener">{m.group(1)}</a>', s)
    # Bold: **text**  oder __text__
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"__([^_]+)__", r"<strong>\1</strong>", s)
    # Italic: *text* oder _text_  (vorsichtig — nur wenn um Worte rum)
    s = re.sub(r"(?<![*\w])\*([^*\n]+)\*(?!\w)", r"<em>\1</em>", s)
    s = re.sub(r"(?<![_\w])_([^_\n]+)_(?!\w)", r"<em>\1</em>", s)
    return s


def md_to_html(md: str) -> str:
    """Konvertiert Markdown-Text zu HTML-Body. Einfacher Block-Parser."""
    out: list[str] = []
    lines = md.split("\n")
    i = 0
    in_list: str | None = None     # "ul" | "ol" | None
    in_code = False
    code_lang = ""
    code_lines: list[str] = []

    def close_list():
        nonlocal in_list
        if in_list:
            out.append(f"</{in_list}>")
            in_list = None

    while i < len(lines):
        raw = lines[i]
        line = raw.rstrip()

        # Code-Block Marker
        if line.startswith("```"):
            if in_code:
                # Block schließen
                lang_class = f' class="lang-{code_lang}"' if code_lang else ""
                code_html = _html.escape("\n".join(code_lines))
                out.append(f'<pre><code{lang_class}>{code_html}</code></pre>')
                code_lines = []
                code_lang = ""
                in_code = False
            else:
                close_list()
                in_code = True
                code_lang = line[3:].strip()
            i += 1
            continue
        if in_code:
            code_lines.append(raw)
            i += 1
            continue

        # Headings
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            close_list()
            level = len(m.group(1))
            text = _inline(m.group(2).strip())
            # Anchor-ID aus dem Heading-Text (kebab-case)
            anchor = re.sub(r"[^a-z0-9]+", "-", m.group(2).lower()).strip("-")
            out.append(f'<h{level} id="{anchor}">{text}</h{level}>')
            i += 1
            continue

        # Horizontal Rule
        if re.match(r"^---+\s*$", line) or re.match(r"^___+\s*$", line):
            close_list()
            out.append("<hr>")
            i += 1
            continue

        # Blockquote
        if line.startswith(">"):
            close_list()
            text = _inline(re.sub(r"^>\s?", "", line))
            out.append(f"<blockquote>{text}</blockquote>")
            i += 1
            continue

        # Listen
        list_m = re.match(r"^(\s*)([-*]|\d+\.)\s+(.*)$", line)
        if list_m:
            indent, marker, text = list_m.groups()
            tag = "ol" if marker.endswith(".") else "ul"
            if in_list != tag:
                close_list()
                out.append(f"<{tag}>")
                in_list = tag
            out.append(f"<li>{_inline(text)}</li>")
            i += 1
            continue

        # Leerzeile schließt offene Listen
        if not line:
            close_list()
            i += 1
            continue

        # GFM-Tabelle: Header-Zeile mit | , nächste Zeile = Trenn-Zeile
        # (enthält - und | , z.B. |---|---|). v0.9.253
        if "|" in line and i + 1 < len(lines):
            _sep = lines[i + 1].strip()
            if "|" in _sep and "-" in _sep and re.match(r"^[\s:|-]+$", _sep):
                def _cells(row: str) -> list[str]:
                    row = row.strip()
                    if row.startswith("|"):
                        row = row[1:]
                    if row.endswith("|"):
                        row = row[:-1]
                    return [c.strip() for c in row.split("|")]
                close_list()
                header = _cells(line)
                i += 2  # Header + Trenn-Zeile überspringen
                body_rows: list[list[str]] = []
                while i < len(lines) and lines[i].strip() and "|" in lines[i]:
                    body_rows.append(_cells(lines[i]))
                    i += 1
                _thead = "".join(f"<th>{_inline(c)}</th>" for c in header)
                _tbody = ""
                for r in body_rows:
                    _tbody += "<tr>" + "".join(f"<td>{_inline(c)}</td>" for c in r) + "</tr>"
                out.append(f"<table><thead><tr>{_thead}</tr></thead><tbody>{_tbody}</tbody></table>")
                continue

        # Default: Paragraph (mehrere Folge-Zeilen zu einem <p>)
        close_list()
        para = [line]
        j = i + 1
        while j < len(lines):
            nxt = lines[j].rstrip()
            if not nxt:
                break
            if nxt.startswith(("#", ">", "```", "---", "___")):
                break
            if re.match(r"^(\s*)([-*]|\d+\.)\s+", nxt):
                break
            if "|" in nxt:   # v0.9.253 — Tabelle nicht in den Absatz ziehen
                break
            para.append(nxt)
            j += 1
        out.append(f"<p>{_inline(' '.join(para))}</p>")
        i = j

    close_list()
    if in_code:
        # Unclosed code block — close gracefully
        code_html = _html.escape("\n".join(code_lines))
        out.append(f"<pre><code>{code_html}</code></pre>")

    return "\n".join(out)


# ── Schicke HTML-Wrapper-Vorlage ───────────────────────────────────────────

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} — Reisezoom GPS Studio</title>
<style>
  :root {{
    --bg-1: #0e1117;
    --bg-2: #161b22;
    --bg-3: #21262d;
    --border: #30363d;
    --text: #c9d1d9;
    --text-dim: #8b949e;
    --text-muted: #6e7681;
    --accent: #ff6b35;
    --accent-dim: #d65a2a;
    --link: #58a6ff;
  }}
  * {{ box-sizing: border-box; }}
  html, body {{ margin: 0; padding: 0; background: var(--bg-1); color: var(--text); }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", Roboto,
                 "Helvetica Neue", Arial, sans-serif;
    font-size: 15px;
    line-height: 1.65;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }}
  .layout {{
    max-width: 880px;
    margin: 0 auto;
    padding: 32px 36px 80px;
  }}
  .header {{
    display: flex;
    align-items: center;
    gap: 14px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 28px;
  }}
  .header-icon {{
    width: 44px;
    height: 44px;
    border-radius: 10px;
    filter: drop-shadow(0 2px 6px rgba(0,0,0,0.4));
  }}
  .header-title {{ font-size: 18px; font-weight: 600; }}
  .header-sub {{ font-size: 12px; color: var(--text-muted); margin-top: 2px; letter-spacing: 0.3px; }}

  h1, h2, h3, h4, h5, h6 {{
    color: #f0f6fc;
    font-weight: 600;
    line-height: 1.25;
    margin: 1.6em 0 0.5em;
    scroll-margin-top: 24px;
  }}
  h1 {{ font-size: 28px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }}
  h2 {{ font-size: 22px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }}
  h3 {{ font-size: 18px; }}
  h4 {{ font-size: 16px; color: var(--text); }}
  h5 {{ font-size: 14px; color: var(--text); }}

  p {{ margin: 0.8em 0; }}
  a {{ color: var(--link); text-decoration: none; }}
  a:hover {{ text-decoration: underline; }}

  strong {{ color: #f0f6fc; font-weight: 600; }}
  em {{ color: #d2a8ff; font-style: italic; }}

  code {{
    background: rgba(110, 118, 129, 0.18);
    color: #ffb38a;
    padding: 0.15em 0.4em;
    border-radius: 4px;
    font-size: 88%;
    font-family: ui-monospace, "SF Mono", Menlo, Monaco, monospace;
  }}
  pre {{
    background: #0a0d12;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 16px;
    overflow-x: auto;
    margin: 1em 0;
    line-height: 1.5;
  }}
  pre code {{
    background: none;
    color: var(--text);
    padding: 0;
    font-size: 12.5px;
  }}
  kbd {{
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 5px;
    padding: 1px 6px;
    font-size: 85%;
    font-family: ui-monospace, "SF Mono", Menlo, Monaco, monospace;
    color: #f0f6fc;
    white-space: nowrap;
  }}

  ul, ol {{
    margin: 0.6em 0;
    padding-left: 1.6em;
  }}
  li {{ margin: 0.25em 0; }}
  li > ul, li > ol {{ margin: 0.25em 0; }}

  blockquote {{
    margin: 1em 0;
    padding: 8px 16px;
    border-left: 3px solid var(--accent);
    background: rgba(255, 107, 53, 0.06);
    color: var(--text-dim);
    border-radius: 0 6px 6px 0;
  }}
  blockquote p {{ margin: 0.3em 0; }}

  hr {{
    border: none;
    border-top: 1px solid var(--border);
    margin: 2em 0;
  }}

  table {{
    border-collapse: collapse;
    margin: 1em 0;
    width: 100%;
  }}
  th, td {{
    border: 1px solid var(--border);
    padding: 8px 12px;
    text-align: left;
  }}
  th {{
    background: var(--bg-2);
    color: var(--text);
    font-weight: 600;
  }}
  tr:nth-child(even) td {{ background: rgba(110, 118, 129, 0.05); }}

  /* Smooth-Scroll für Anchor-Links */
  html {{ scroll-behavior: smooth; }}

  /* Mini-Footer mit Build-Hinweis */
  .footer {{
    margin-top: 60px;
    padding-top: 18px;
    border-top: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 11.5px;
    text-align: center;
  }}
</style>
</head>
<body>
<div class="layout">
  <div class="header">
    <img class="header-icon" src="../ui/assets/icon.png" alt="" onerror="this.style.display='none'">
    <div>
      <div class="header-title">Reisezoom GPS Studio</div>
      <div class="header-sub">{title}</div>
    </div>
    <div class="langswitch" style="margin-left:auto;display:flex;gap:5px">{langswitch}</div>
  </div>
  {content}
  <div class="footer">
    Reisezoom GPS Studio · diese Doku wurde aus <code>docs/USER_GUIDE.md</code> generiert.
  </div>
</div>
</body>
</html>
"""


# ── Mehrsprachig: DE (Quelle) + EN/ES (übersetzte USER_GUIDE.<lang>.md) ───────
# Deployte Dateinamen (reisezoom.com/downloads/gps-studio/latest/): user-guide[.<lang>].html
LANGS = [
    ("de", ROOT / "docs" / "USER_GUIDE.md",    ROOT / "docs" / "USER_GUIDE.html",    "user-guide.html"),
    ("en", ROOT / "docs" / "USER_GUIDE.en.md", ROOT / "docs" / "USER_GUIDE.en.html", "user-guide.en.html"),
    ("es", ROOT / "docs" / "USER_GUIDE.es.md", ROOT / "docs" / "USER_GUIDE.es.html", "user-guide.es.html"),
]
LANG_NAMES = {"de": "DE", "en": "EN", "es": "ES"}


def _langswitch(current: str) -> str:
    """Sprach-Pillen im Header — nur für tatsächlich vorhandene Übersetzungen,
    verlinkt auf die deployten Nachbar-Dateien (gleicher Ordner auf dem Server)."""
    out = []
    for code, src, _dst, deployed in LANGS:
        if not src.exists():
            continue
        active = code == current
        style = "background:#c46a3a;color:#fff" if active else "background:rgba(255,255,255,.08);color:#cbb89a"
        out.append('<a href="%s" style="%s;font:700 12px/1 system-ui,sans-serif;'
                   'padding:5px 9px;border-radius:999px;text-decoration:none">%s</a>'
                   % (_html.escape(deployed), style, LANG_NAMES[code]))
    return "".join(out)


def build_one(lang: str, src: Path, dst: Path) -> Path:
    md = src.read_text(encoding="utf-8")
    title = "Benutzerhandbuch"
    m = re.match(r"^\s*#\s+(.+)\s*$", md.split("\n")[0])
    if m:
        title = m.group(1).strip()
    content = md_to_html(md)
    html = HTML_TEMPLATE.format(lang=lang, title=_html.escape(title),
                                content=content, langswitch=_langswitch(lang))
    dst.write_text(html, encoding="utf-8")
    print(f"✅ {dst.relative_to(ROOT)} ({len(html) // 1024} KB)")
    return dst


def build() -> Path:
    if not LANGS[0][1].exists():
        sys.stderr.write(f"❌ {LANGS[0][1]} fehlt\n")
        sys.exit(1)
    built = []
    for lang, src, dst, _deployed in LANGS:
        if src.exists():
            built.append(build_one(lang, src, dst))
        else:
            print(f"⏭  {src.name} fehlt — {lang} übersprungen")
    return built[0]


if __name__ == "__main__":
    build()
