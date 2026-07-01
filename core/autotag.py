"""
core/autotag.py — Bilderkennung für automatische Verschlagwortung (v0.9.349).

**Nur macOS.** Nutzt das eingebaute **Apple-Vision-Framework** (on-device, kein
Download, kein Netz, kein Konto) über PyObjC, um zu jedem Foto Szenen-/Objekt-
Labels zu erkennen (z.B. „outdoor, forest, deer"). Die Labels werden — soweit
bekannt — ins Deutsche übersetzt; unbekannte bleiben (bereinigt) englisch.

Cross-Platform-Politik (Marc-Regel): macOS bekommt das Feature, Windows/Linux
nicht — `is_available()` liefert dort `False`, das UI blendet den Button aus.
Apple Vision ist OS-eigen → nichts zu bundeln; auf Nicht-Mac gibt's das schlicht
nicht.

Bewusst KEIN großes LLM: für reine Stichwörter ist der eingebaute Klassifikator
schneller (~30–160 ms/Foto) und völlig ausreichend. Die Treffer sind Vorschläge
— der Nutzer prüft sie (landen als ausstehende EXIF-Edits) und schreibt dann.
"""

from __future__ import annotations

import logging
import sys

log = logging.getLogger("reisezoom.autotag")

# ── Vision lazy/guarded importieren ────────────────────────────────────────
_VISION = None        # Modul-Handle (None solange ungeprüft/nicht verfügbar)
_AVAILABLE: bool | None = None


def _try_import() -> bool:
    """Lädt Vision + Foundation einmalig. True wenn auf diesem System nutzbar."""
    global _VISION, _AVAILABLE
    if _AVAILABLE is not None:
        return _AVAILABLE
    if sys.platform != "darwin":
        _AVAILABLE = False
        return False
    try:
        import Vision  # type: ignore
        import Foundation  # noqa: F401  (für NSURL)
        _VISION = Vision
        _AVAILABLE = True
        log.info("autotag: Apple Vision verfügbar")
    except Exception as e:  # pragma: no cover (nur auf nicht-mac / kaputtem pyobjc)
        _AVAILABLE = False
        log.info("autotag: Apple Vision NICHT verfügbar (%s)", e)
    return _AVAILABLE


def is_available() -> bool:
    """True, wenn die Bilderkennung auf diesem System läuft (= macOS + Vision)."""
    return _try_import()


# ── Label-Aufbereitung ─────────────────────────────────────────────────────
# Zentrale Übersetzungstabelle (Vision-Label → Deutsch, Español). Aus EINER
# Quelle gebaut, damit DE/ES immer dieselben Schlüssel abdecken. Die Auto-Tag-
# Sprache folgt der App-Sprache (siehe app.py): DE/ES werden übersetzt,
# EN nutzt das Apple-Original. In den übersetzten Sprachen werden Labels OHNE
# Eintrag WEGGELASSEN (statt englisch reinzumischen) → konsistente Sprache.
_TRANS = [
    # Kontext
    ("outdoor", "Outdoor", "Exterior"), ("indoor", "Indoor", "Interior"),
    ("nature", "Natur", "Naturaleza"), ("landscape", "Landschaft", "Paisaje"),
    ("land", "Landschaft", "Paisaje"), ("scenery", "Landschaft", "Paisaje"),
    # Himmel / Wetter / Tageszeit
    ("sky", "Himmel", "Cielo"), ("cloud", "Wolken", "Nubes"),
    ("cloudy", "Wolken", "Nubes"), ("clouds", "Wolken", "Nubes"),
    ("sunset", "Sonnenuntergang", "Atardecer"), ("sunrise", "Sonnenaufgang", "Amanecer"),
    ("sun", "Sonne", "Sol"), ("sunlight", "Sonnenlicht", "Luz solar"),
    ("fog", "Nebel", "Niebla"), ("mist", "Nebel", "Niebla"),
    ("rain", "Regen", "Lluvia"), ("snow", "Schnee", "Nieve"),
    ("storm", "Sturm", "Tormenta"), ("lightning", "Blitz", "Relámpago"),
    ("rainbow", "Regenbogen", "Arcoíris"), ("frost", "Frost", "Escarcha"),
    ("ice", "Eis", "Hielo"), ("wind", "Wind", "Viento"),
    ("dusk", "Dämmerung", "Anochecer"), ("dawn", "Morgendämmerung", "Amanecer"),
    ("twilight", "Dämmerung", "Crepúsculo"), ("daytime", "Tag", "Día"),
    ("day", "Tag", "Día"), ("night", "Nacht", "Noche"),
    ("nighttime", "Nacht", "Noche"), ("moon", "Mond", "Luna"),
    ("star", "Stern", "Estrella"), ("stars", "Sterne", "Estrellas"),
    # Pflanzen / Boden
    ("grass", "Wiese", "Hierba"), ("meadow", "Wiese", "Pradera"),
    ("field", "Feld", "Campo"), ("plant", "Pflanze", "Planta"),
    ("plants", "Pflanzen", "Plantas"), ("tree", "Baum", "Árbol"),
    ("trees", "Bäume", "Árboles"), ("forest", "Wald", "Bosque"),
    ("woods", "Wald", "Bosque"), ("woodland", "Wald", "Bosque"),
    ("wood_natural", "Holz", "Madera"), ("moss", "Moos", "Musgo"),
    ("fern", "Farn", "Helecho"), ("mushroom", "Pilz", "Seta"),
    ("flower", "Blume", "Flor"), ("flowers", "Blumen", "Flores"),
    ("blossom", "Blüte", "Flor"), ("leaf", "Blatt", "Hoja"),
    ("foliage", "Laub", "Follaje"), ("bush", "Strauch", "Arbusto"),
    ("shrub", "Strauch", "Arbusto"), ("hedge", "Hecke", "Seto"),
    ("reed", "Schilf", "Junco"), ("heather", "Heide", "Brezo"),
    ("heath", "Heide", "Brezal"), ("vineyard", "Weinberg", "Viñedo"),
    ("palm", "Palme", "Palmera"), ("pine", "Kiefer", "Pino"),
    ("birch", "Birke", "Abedul"), ("oak", "Eiche", "Roble"),
    ("cactus", "Kaktus", "Cactus"), ("berry", "Beere", "Baya"),
    ("crop", "Feldfrucht", "Cultivo"),
    # Landformen
    ("mountain", "Berg", "Montaña"), ("mountains", "Berge", "Montañas"),
    ("hill", "Hügel", "Colina"), ("hills", "Hügel", "Colinas"),
    ("rock", "Fels", "Roca"), ("rocks", "Felsen", "Rocas"),
    ("stone", "Stein", "Piedra"), ("cliff", "Klippe", "Acantilado"),
    ("boulder", "Felsblock", "Roca"), ("sand", "Sand", "Arena"),
    ("beach", "Strand", "Playa"), ("dune", "Düne", "Duna"),
    ("desert", "Wüste", "Desierto"), ("valley", "Tal", "Valle"),
    ("canyon", "Schlucht", "Cañón"), ("gorge", "Schlucht", "Desfiladero"),
    ("cave", "Höhle", "Cueva"), ("glacier", "Gletscher", "Glaciar"),
    ("volcano", "Vulkan", "Volcán"), ("swamp", "Sumpf", "Pantano"),
    ("marsh", "Moor", "Marisma"), ("coast", "Küste", "Costa"),
    ("shore", "Ufer", "Orilla"), ("island", "Insel", "Isla"),
    # Wasser
    ("water", "Wasser", "Agua"), ("lake", "See", "Lago"),
    ("river", "Fluss", "Río"), ("stream", "Bach", "Arroyo"),
    ("sea", "Meer", "Mar"), ("ocean", "Meer", "Océano"),
    ("waterfall", "Wasserfall", "Cascada"), ("pond", "Teich", "Estanque"),
    ("wave", "Welle", "Ola"), ("waves", "Wellen", "Olas"),
    ("harbor", "Hafen", "Puerto"), ("pier", "Steg", "Muelle"),
    ("dock", "Steg", "Muelle"), ("dam", "Damm", "Presa"),
    ("bay", "Bucht", "Bahía"),
    # Tiere
    ("animal", "Tier", "Animal"), ("animals", "Tiere", "Animales"),
    ("dog", "Hund", "Perro"), ("cat", "Katze", "Gato"),
    ("bird", "Vogel", "Pájaro"), ("birds", "Vögel", "Pájaros"),
    ("horse", "Pferd", "Caballo"), ("cow", "Kuh", "Vaca"),
    ("sheep", "Schaf", "Oveja"), ("goat", "Ziege", "Cabra"),
    ("donkey", "Esel", "Burro"), ("pig", "Schwein", "Cerdo"),
    ("deer", "Reh", "Ciervo"), ("fox", "Fuchs", "Zorro"),
    ("rabbit", "Hase", "Conejo"), ("squirrel", "Eichhörnchen", "Ardilla"),
    ("fish", "Fisch", "Pez"), ("insect", "Insekt", "Insecto"),
    ("bee", "Biene", "Abeja"), ("butterfly", "Schmetterling", "Mariposa"),
    ("dragonfly", "Libelle", "Libélula"), ("snail", "Schnecke", "Caracol"),
    ("spider", "Spinne", "Araña"), ("snake", "Schlange", "Serpiente"),
    ("lizard", "Eidechse", "Lagarto"), ("turtle", "Schildkröte", "Tortuga"),
    ("frog", "Frosch", "Rana"), ("swan", "Schwan", "Cisne"),
    ("duck", "Ente", "Pato"), ("goose", "Gans", "Ganso"),
    ("owl", "Eule", "Búho"), ("eagle", "Adler", "Águila"),
    ("gull", "Möwe", "Gaviota"), ("heron", "Reiher", "Garza"),
    ("crab", "Krabbe", "Cangrejo"), ("jellyfish", "Qualle", "Medusa"),
    # Menschen
    ("people", "Menschen", "Personas"), ("person", "Person", "Persona"),
    ("adult", "Erwachsener", "Adulto"), ("child", "Kind", "Niño"),
    ("children", "Kinder", "Niños"), ("man", "Mann", "Hombre"),
    ("woman", "Frau", "Mujer"), ("portrait", "Porträt", "Retrato"),
    ("face", "Gesicht", "Cara"), ("selfie", "Selfie", "Selfie"),
    ("crowd", "Menschenmenge", "Multitud"),
    # Fahrzeuge
    ("vehicle", "Fahrzeug", "Vehículo"), ("car", "Auto", "Coche"),
    ("bicycle", "Fahrrad", "Bicicleta"), ("bike", "Fahrrad", "Bicicleta"),
    ("motorcycle", "Motorrad", "Motocicleta"), ("boat", "Boot", "Barco"),
    ("ship", "Schiff", "Barco"), ("sailboat", "Segelboot", "Velero"),
    ("kayak", "Kajak", "Kayak"), ("canoe", "Kanu", "Canoa"),
    ("train", "Zug", "Tren"), ("streetcar", "Straßenbahn", "Tranvía"),
    ("bus", "Bus", "Autobús"), ("truck", "Lkw", "Camión"),
    ("airplane", "Flugzeug", "Avión"),
    # Bauwerke
    ("building", "Gebäude", "Edificio"), ("house", "Haus", "Casa"),
    ("church", "Kirche", "Iglesia"), ("castle", "Burg", "Castillo"),
    ("tower", "Turm", "Torre"), ("bridge", "Brücke", "Puente"),
    ("road", "Straße", "Carretera"), ("street", "Straße", "Calle"),
    ("path", "Weg", "Camino"), ("trail", "Pfad", "Sendero"),
    ("fence", "Zaun", "Valla"), ("wall", "Mauer", "Muro"),
    ("city", "Stadt", "Ciudad"), ("town", "Ort", "Pueblo"),
    ("village", "Dorf", "Aldea"), ("park", "Park", "Parque"),
    ("garden", "Garten", "Jardín"), ("ruins", "Ruine", "Ruinas"),
    ("monument", "Denkmal", "Monumento"), ("lighthouse", "Leuchtturm", "Faro"),
    ("windmill", "Windmühle", "Molino"), ("barn", "Scheune", "Granero"),
    ("hut", "Hütte", "Cabaña"), ("cabin", "Hütte", "Cabaña"),
    ("statue", "Statue", "Estatua"), ("fountain", "Brunnen", "Fuente"),
    ("gate", "Tor", "Puerta"), ("stairs", "Treppe", "Escalera"),
    ("dome", "Kuppel", "Cúpula"), ("skyscraper", "Wolkenkratzer", "Rascacielos"),
    ("tunnel", "Tunnel", "Túnel"), ("market", "Markt", "Mercado"),
    # Aktivitäten / Objekte
    ("camera", "Kamera", "Cámara"), ("boots", "Stiefel", "Botas"),
    ("backpack", "Rucksack", "Mochila"), ("tent", "Zelt", "Tienda"),
    ("campfire", "Lagerfeuer", "Fogata"), ("camping", "Camping", "Camping"),
    ("hiking", "Wandern", "Senderismo"), ("climbing", "Klettern", "Escalada"),
    ("skiing", "Skifahren", "Esquí"), ("surfing", "Surfen", "Surf"),
    ("kite", "Drachen", "Cometa"), ("umbrella", "Regenschirm", "Paraguas"),
    ("hat", "Hut", "Sombrero"), ("map", "Karte", "Mapa"),
    ("flag", "Flagge", "Bandera"), ("sign", "Schild", "Señal"),
    ("bench", "Bank", "Banco"),
    # Essen
    ("food", "Essen", "Comida"), ("drink", "Getränk", "Bebida"),
    ("fruit", "Obst", "Fruta"), ("vegetable", "Gemüse", "Verdura"),
    ("coffee", "Kaffee", "Café"), ("beer", "Bier", "Cerveza"),
    ("wine", "Wein", "Vino"), ("bread", "Brot", "Pan"),
    ("cake", "Kuchen", "Pastel"), ("meal", "Mahlzeit", "Comida"),
]
_DE = {k: de for k, de, es in _TRANS}
_ES = {k: es for k, de, es in _TRANS}
_MAPS = {"de": _DE, "es": _ES}    # EN/sonst → Apple-Original (keine Übersetzung)

# Zu generische/technische Labels, die als Stichwort wenig bringen → raus.
_SKIP = {
    "structure", "material", "machine", "equipment", "optical_equipment",
    "manmade", "manmade_object", "object", "surface", "texture", "pattern",
    "device", "instrument", "tool", "art", "abstract", "background",
    "document", "screenshot", "text", "paper",
}


def _clean(label: str) -> str:
    return str(label or "").replace("_", " ").strip()


def _label_for(ident: str, lang: str):
    """Vision-Label → Anzeigewort in der Zielsprache, oder None wenn es
    übersprungen wird. DE/ES: übersetzen, Nicht-Übersetzbares → None (weglassen,
    damit die Liste konsistent in EINER Sprache bleibt). EN/sonst: Apple-Original."""
    key = (ident or "").lower()
    if key in _SKIP:
        return None
    tmap = _MAPS.get(lang)
    if tmap is not None:
        return tmap.get(key) or None
    return _clean(ident) or None


def suggest_keywords(path: str, max_tags: int = 8, min_conf: float = 0.25,
                     lang: str = "de") -> list[str]:
    """Liefert eine Liste vorgeschlagener Stichwörter für ein Foto (geordnet nach
    Konfidenz). Leere Liste, wenn Vision nicht verfügbar ist oder nichts greift."""
    if not _try_import():
        return []
    import Foundation
    Vision = _VISION
    try:
        url = Foundation.NSURL.fileURLWithPath_(path)
        handler = Vision.VNImageRequestHandler.alloc().initWithURL_options_(url, None)
        req = Vision.VNClassifyImageRequest.alloc().init()
        ok, _err = handler.performRequests_error_([req], None)
        if not ok:
            return []
        results = req.results() or []
    except Exception:
        log.exception("autotag: Klassifikation fehlgeschlagen für %s", path)
        return []

    seen: set[str] = set()
    out: list[str] = []
    for obs in results:
        try:
            conf = float(obs.confidence())
            ident = str(obs.identifier())
        except Exception:
            continue
        if conf < min_conf:
            continue
        word = _label_for(ident, lang)
        if not word:
            continue
        wl = word.lower()
        if wl in seen:
            continue
        seen.add(wl)
        out.append(word)
        if len(out) >= max_tags:
            break
    return out
