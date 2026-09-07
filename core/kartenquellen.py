"""Kartenquellen-Register (07.09.2026, Marc: „das Quellenregister, das muss mindestens halbjährlich überprüft werden").

Eine Wahrheit je Dienst: Datenlizenz, Dienstbedingungen, vorgeschriebene Nennung,
Freigabe für kommerzielle Videos (`commercial_video`), Prüfdatum. Grundlage:
docs/KARTENQUELLEN-LIZENZKONZEPT.md (Marcs Auswertung) + Recherche je Dienst am
07.09.2026 (Quellen je Eintrag in `sources`). Alles ist UNSERE Lesart der
Bedingungen, keine Rechtsberatung — die Links sind die Quelle.

`commercial_video`: "true" = geprüft und erlaubt · "license_required" = kostenpflichtige
oder individuelle Rechte nötig · "unknown" = nicht verifiziert · "false" = nach den
Bedingungen nicht erlaubt. `render_server`: "ok" | "absprache" (Anbieter kontaktieren
oder eigener Server, wird als Warnung gezeigt) | "nein" (Server-Regeln verbieten das
Bild-für-Bild-Rendern, zählt wie "false").

PRÜFPFLICHT: Jeder Eintrag trägt `checked_at`. Ist ein Eintrag älter als
PRUEF_INTERVALL_TAGE, schlägt tests/test_kartenquellen.py fehl (die Release-Suite
wird rot) und die App zeigt in der Rechte-Tabelle einen Hinweis. Bei der Prüfung:
Quelle nachlesen, Felder anpassen, `checked_at` setzen.

Diese Datei wird aus den Recherche-JSONs erzeugt (scratch register/gen_modul.py),
darf aber auch von Hand gepflegt werden — Einträge sind gewöhnliche Dicts.
"""
from __future__ import annotations

import datetime as _dt
from typing import Optional

PRUEF_INTERVALL_TAGE = 182          # halbjährlich (Marc, 07.09.2026)
STATUS = ("true", "license_required", "unknown", "false")

# Stil-Schlüssel / Regions-IDs → Register-ID
STIL_ZU_QUELLE = {
    "osm": "osm", "topo": "opentopomap", "cyclosm": "cyclosm", "humanitarian": "hot",
    "ofm_liberty": "openfreemap", "ofm_bright": "openfreemap", "ofm_positron": "openfreemap",
    "maptiler_satellite": "maptiler", "maptiler_outdoor": "maptiler", "maptiler_streets": "maptiler",
    "maptiler_topo": "maptiler", "maptiler_dataviz": "maptiler", "maptiler_hybrid": "maptiler",
    "satellite": "mapbox", "satellite_streets": "mapbox", "outdoors": "mapbox", "standard": "mapbox", "streets": "mapbox", "dark": "mapbox", "light": "mapbox",
}
REGION_ZU_QUELLE = {"us-ak": "us", "us-hi": "us"}
# Was bei „Satellit (kostenlos)" immer mitläuft (Untergrund, Sentinel, Gelände, Beschriftung)
GOV_GRUNDLAGEN = ("bluemarble", "sentinel", "terrain", "openfreemap")

QUELLEN: list[dict] = [{'id': 'de-be',
  'provider': 'Geoportal Berlin / Senatsverwaltung für Stadtentwicklung, Bauen und Wohnen',
  'dataset': 'Digitale farbige TrueOrthophotos 2024 (DOP20RGBI) – WMS truedop_2024',
  'dataset_url': 'https://daten.berlin.de/datensaetze/digitale-farbige-trueorthophotos-2024-dop20rgbi-wms-de71f450',
  'license': 'dl-de/zero-2-0',
  'license_url': 'https://www.govdata.de/dl-de/zero-2-0',
  'commercial_video': 'true',
  'modification_notice_required': False,
  'onscreen_credit': 'Geoportal Berlin / TrueDOP 2024 (dl-de/zero-2-0)',
  'service_terms_url': 'https://gdi.berlin.de/services/wms/truedop_2024?request=GetCapabilities&service=WMS',
  'service_limits': 'Keine Rate-Limits, Cache-, Prefetch- oder User-Agent-Regeln veröffentlicht; '
                    'Capabilities: keine Zugriffsbeschränkungen. Kontakt geoportal@senstadt.berlin.de.',
  'confidence': 'hoch',
  'notes': 'Bisher angenommen dl-de/by-2-0 — FALSCH: TrueDOP 2023/2024/Sommer 2025 stehen unter '
           'dl-de/zero-2-0 (jede Nutzung ohne Bedingungen). Nennung und Änderungshinweis nicht Pflicht; '
           'Formel «Geoportal Berlin / [Datensatz]» ist ein optionaler Quellenvermerk — wir zeigen ihn '
           'weiter.',
  'sources': ['https://daten.berlin.de/datensaetze/digitale-farbige-trueorthophotos-2024-dop20rgbi-wms-de71f450',
              'https://gdi.berlin.de/services/wms/truedop_2024?request=GetCapabilities&service=WMS',
              'https://www.govdata.de/dl-de/zero-2-0'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_hinweis': 'Geoportal Berlin / Digitale farbige TrueOrthophotos 2024 (DOP20RGBI)',
  'credit_kurz': '© Geoportal Berlin',
  'license_hinweis': 'Datenlizenz Deutschland – Zero – Version 2.0 (dl-de/zero-2-0)'},
 {'id': 'de-hb',
  'provider': 'Landesamt GeoInformation Bremen',
  'dataset': 'ATKIS DOP20 Land Bremen – WMS wms_dop20_2023 (DOP20_2023_HB, DOP20_2023_BHV)',
  'dataset_url': 'https://www.geo.bremen.de/produkte/luftbildprodukte-11703',
  'license': 'CC BY 4.0',
  'license_url': 'https://creativecommons.org/licenses/by/4.0/',
  'commercial_video': 'true',
  'modification_notice_required': True,
  'onscreen_credit': '© GeoBasis-DE / Landesamt GeoInformation Bremen (Jahr), CC BY 4.0, bearbeitet',
  'service_terms_url': 'https://geodienste.bremen.de/wms_dop20_2023?REQUEST=GetCapabilities&SERVICE=WMS&VERSION=1.3.0',
  'service_limits': 'Keine Rate-Limits/Cache-/Prefetch-Regeln veröffentlicht; Capabilities: keine '
                    'Zugriffsbeschränkungen, Fees CC BY mit Quellenvermerk. Kontakt '
                    'gdikoordinierungsstelle@geo.bremen.de.',
  'confidence': 'hoch',
  'notes': 'Landesamt: deutlich sichtbarer Quellenvermerk «© GeoBasis-DE / Landesamt GeoInformation Bremen '
           '(Jahr)» Pflicht; CC BY 4.0 verlangt Lizenzhinweis + Änderungshinweis. DOP20 seit 09.06.2024 Open '
           'Data. Website-Footer CC BY-NC-ND betrifft nur Webseiteninhalte.',
  'sources': ['https://www.geo.bremen.de/open-data-landingpage-15613',
              'https://geodienste.bremen.de/wms_dop20_2023?REQUEST=GetCapabilities&SERVICE=WMS&VERSION=1.3.0',
              'https://creativecommons.org/licenses/by/4.0/'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_kurz': '© GeoBasis-DE/Bremen CC BY',
  'license_hinweis': 'Creative Commons Namensnennung 4.0 International (CC BY 4.0)'},
 {'id': 'de-sl',
  'provider': 'Landesamt für Vermessung, Geoinformation und Landentwicklung Saarland (LVGL)',
  'dataset': 'ATKIS DOP 2025 / WMS SL DOP20 (sl_dop20_rgb)',
  'dataset_url': 'https://geoportal.saarland.de/app-article/geobasisdatenuebersicht/',
  'license': 'dl-de/by-2-0',
  'license_url': 'https://www.govdata.de/dl-de/by-2-0',
  'commercial_video': 'true',
  'modification_notice_required': True,
  'onscreen_credit': '© GeoBasis DE/LVGL-SL (2025), dl-de/by-2-0, Daten verändert',
  'service_terms_url': 'https://geoportal.saarland.de/mapbender/php/mod_showMetadata.php?resource=layer&layout=tabs&id=49804',
  'service_limits': 'Keine Rate-Limits/Cache-/Prefetch-Regeln veröffentlicht; Capabilities Fees None, «Es '
                    'gelten keine Zugriffsbeschränkungen». Freie Dienste ohne Registrierung. Kontakt '
                    'gdi-sl@lvgl.saarland.de.',
  'confidence': 'hoch',
  'notes': 'Volle Formel laut LVGL-Shop-AGB: «© GeoBasis DE/LVGL-SL (Jahr der Datenbereitstellung) - '
           'http://www.govdata.de/dl-de/by-2-0». HVD-Open-Data-Seite nennt CC BY 4.0 mit «© GDI-SL» — '
           'betrifft Geofachdaten, nicht die DOP.',
  'sources': ['https://geoportal.saarland.de/app-article/geobasisdatenuebersicht/',
              'https://www.shop.lvgl.saarland.de/index.php?option=com_content&view=article&id=18&metaauthor=odata',
              'https://www.govdata.de/dl-de/by-2-0'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_kurz': '© GeoBasis DE/LVGL-SL dl-de/by',
  'license_hinweis': 'Datenlizenz Deutschland – Namensnennung – Version 2.0 (dl-de/by-2-0)'},
 {'id': 'de-sh',
  'provider': 'Landesamt für Vermessung und Geoinformation Schleswig-Holstein (LVermGeo SH)',
  'dataset': 'DOP20 Schleswig-Holstein – Open-Data-Dienste WMS_SH_DOP20col_OpenGBD (sh_dop20_rgb)',
  'dataset_url': 'https://advmis.geodatenzentrum.de/trefferanzeige?docuuid=901165b0-4c64-4659-ba6b-604f82025802',
  'license': 'CC BY 4.0',
  'license_url': 'https://creativecommons.org/licenses/by/4.0/',
  'commercial_video': 'true',
  'modification_notice_required': True,
  'onscreen_credit': '© GeoBasis-DE/LVermGeo SH/CC BY 4.0 (Quelle verändert)',
  'service_terms_url': 'https://geodaten.schleswig-holstein.de/gaialight-sh/_apps/dladownload/lizenz.html',
  'service_limits': 'Keine Rate-Limits/Cache-/Prefetch-Regeln veröffentlicht; Capabilities Fees CC BY 4.0, '
                    'AccessConstraints NONE, MaxWidth/MaxHeight 5000 px. Kontakt '
                    'Geoserver@LVermGeo.landsh.de.',
  'confidence': 'hoch',
  'notes': 'Lizenzseite: kommerziell und nicht kommerziell erlaubt; Veränderungen im Quellenvermerk '
           'kennzeichnen. Nur den OpenGBD-Dienst nutzen — der Auth-Dienst WMS_SH_DOP20col ist CC BY-SA 4.0.',
  'sources': ['https://geodaten.schleswig-holstein.de/gaialight-sh/_apps/dladownload/lizenz.html',
              'https://dienste.gdi-sh.de/WMS_SH_DOP20col_OpenGBD?Service=wms&version=1.3.0&request=getCapabilities',
              'https://creativecommons.org/licenses/by/4.0/legalcode.de'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_kurz': '© GeoBasis-DE/LVermGeo SH CC BY',
  'license_hinweis': 'Creative Commons Namensnennung 4.0 International (CC BY 4.0)'},
 {'id': 'de-mv',
  'provider': 'Landesamt für innere Verwaltung Mecklenburg-Vorpommern (LAiV M-V), Amt für Geoinformation, '
              'Vermessung und Katasterwesen',
  'dataset': 'WMS Digitale Orthophotos MV (WMS_MV_DOP, mv_dop), DOP20/TrueDOP',
  'dataset_url': 'https://laiv.geodaten-mv.de/afgvk/Luftbilder/Beschreibung?produkt=DOP',
  'license': 'CC BY 4.0 (seit 06/2024)',
  'license_url': 'https://creativecommons.org/licenses/by/4.0',
  'commercial_video': 'true',
  'modification_notice_required': True,
  'onscreen_credit': '© GeoBasis-DE/M-V 2024/CC BY 4.0 (Quelle verändert)',
  'service_terms_url': 'https://laiv.geodaten-mv.de/afgvk/Sonstiges/Nutzungsbedingungen',
  'service_limits': 'Keine Rate-Limits/Cache-/Prefetch-/User-Agent-Regeln veröffentlicht; Capabilities: '
                    'Pflicht zum deutlich sichtbaren Quellenvermerk, sichtbar 1:1–1:400 000. Kontakt '
                    'geodatenservice@laiv-mv.de.',
  'confidence': 'hoch',
  'notes': 'Bisher angenommen dl-de/by-2-0 — ÜBERHOLT: seit 09.06.2024 CC BY 4.0 (Kurzbeschreibung '
           'WMS_MV_DOP 27.08.2024 + GetCapabilities). Dienstformel «© GeoBasis-DE/M-V <Jahr der letzten '
           'Datenlieferung>», OpenData-Formel «©GeoBasis-DE/MV/CC BY 4.0 (Quelle verändert)».',
  'sources': ['https://www.laiv-mv.de/static/LAIV/Geoinformation/Dateien/Geobasisdaten/Kurzbeschreibung_WMS_DOP.pdf',
              'https://www.geodaten-mv.de/dienste/adv_dop?REQUEST=GetCapabilities&SERVICE=WMS&VERSION=1.3.0',
              'https://laiv.geodaten-mv.de/afgvk/Sonstiges/Nutzungsbedingungen'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_kurz': '© GeoBasis-DE/M-V CC BY',
  'license_hinweis': 'Creative Commons Namensnennung 4.0 International (CC BY 4.0) — seit 09.06.2024'},
 {'id': 'de-ni',
  'provider': 'Landesamt für Geoinformation und Landesvermessung Niedersachsen (LGLN)',
  'dataset': 'Digitale Orthophotos Niedersachsen (DOP20), WMS NI DOP20 RGB (ni_dop20)',
  'dataset_url': 'https://gdk.gdi-de.org/geonetwork/srv/api/records/87890b7a-5a8a-4100-8a1e-78ced663a5d4',
  'license': 'CC BY 4.0',
  'license_url': 'https://creativecommons.org/licenses/by/4.0/',
  'commercial_video': 'true',
  'modification_notice_required': True,
  'onscreen_credit': '© GeoBasis-DE/LGLN 2026, Daten geändert / CC BY 4.0',
  'service_terms_url': 'https://www.lgln.niedersachsen.de/AGNB/',
  'service_limits': 'Keine Rate-Limits/Cache-/Prefetch-Regeln veröffentlicht; Capabilities Fees none, '
                    'MaxWidth/MaxHeight 15000 px. AGNB 4.3/7.2: Quellenvermerk bei untergeordneter Bedeutung '
                    'auch an anderer Stelle möglich (dann Anzeige an '
                    'kontraktmanagement@lgln.niedersachsen.de). Kontakt '
                    'geodatendienste@lgln.niedersachsen.de.',
  'confidence': 'hoch',
  'notes': 'AGNB Nr. 7.1: offene Geodaten unter CC BY 4.0 kostenfrei intern und extern nutzbar. Zwei '
           'Formeln: Metadaten «LGLN (Jahr) … CC BY 4.0», AGNB «© GeoBasis-DE/LGLN Jahr, Daten geändert» — '
           'kombiniert.',
  'sources': ['https://opendata.lgln.niedersachsen.de/doorman/noauth/dop_wms?REQUEST=GetCapabilities&SERVICE=WMS&VERSION=1.3.0',
              'https://www.lgln.niedersachsen.de/AGNB/',
              'https://gdk.gdi-de.org/geonetwork/srv/api/records/87890b7a-5a8a-4100-8a1e-78ced663a5d4'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_kurz': '© GeoBasis-DE/LGLN CC BY',
  'license_hinweis': 'Creative Commons Namensnennung 4.0 International (CC BY 4.0)'},
 {'id': 'de-bb',
  'provider': 'Landesvermessung und Geobasisinformation Brandenburg (LGB)',
  'dataset': 'Digitale Orthophotos DOP20c (WMS dop20c, inkl. Berlin-Kacheln)',
  'dataset_url': 'https://geobroker.geobasis-bb.de/gbss.php?MODE=GetProductInformation&PRODUCTID=253b7d3d-6b42-47dc-b127-682de078b7ae',
  'license': 'dl-de/by-2-0',
  'license_url': 'https://www.govdata.de/dl-de/by-2-0',
  'commercial_video': 'true',
  'modification_notice_required': True,
  'onscreen_credit': '© GeoBasis-DE/LGB, dl-de/by-2-0, (Daten geändert)',
  'service_terms_url': 'https://geobasis-bb.de/lgb/de/agnb/',
  'service_limits': 'AGNB (20.03.2026) Nr. 8: kein externes Monitoring; automatisiertes zyklisches Cachen '
                    'nur nach Vereinbarung mit der LGB; Zugriffe je Zeitintervall begrenzt und auf eine IP '
                    'zu beschränken (keine Zahlen). Capabilities: kostenfrei, keine Zugriffsbeschränkungen. '
                    'Kontakt kundenservice@geobasis-bb.de.',
  'confidence': 'hoch',
  'notes': 'Formel laut Geobroker und Capabilities; AGNB-Variante «© GeoBasis-DE/LGB (Jahr), dl-de/by-2-0, '
           'Daten geändert». Bei Berliner Ausschnitten zusätzlich «© Geoportal Berlin». '
           'Kachel-Zwischenspeicher im Render = formal «automatisiertes zyklisches Cachen» → ggf. LGB '
           'anzeigen.',
  'sources': ['https://geobasis-bb.de/lgb/de/agnb/',
              'https://geobroker.geobasis-bb.de/gbss.php?MODE=GetProductInformation&PRODUCTID=253b7d3d-6b42-47dc-b127-682de078b7ae',
              'https://isk.geobasis-bb.de/mapproxy/dop20c/service/wms?REQUEST=GetCapabilities&SERVICE=WMS'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_kurz': '© GeoBasis-DE/LGB dl-de/by',
  'license_hinweis': 'Datenlizenz Deutschland – Namensnennung – Version 2.0 (dl-de/by-2-0)'},
 {'id': 'de-st',
  'provider': 'Landesamt für Vermessung und Geoinformation Sachsen-Anhalt (LVermGeo)',
  'dataset': 'ATKIS DOP20 Open Data – WMS ST_LVermGeo_DOP_WMS_OpenData (lsa_lvermgeo_dop20_2)',
  'dataset_url': 'https://www.lvermgeo.sachsen-anhalt.de/de/gdp-open-data.html',
  'license': 'dl-de/by-2-0',
  'license_url': 'https://www.govdata.de/dl-de/by-2-0',
  'commercial_video': 'true',
  'modification_notice_required': True,
  'onscreen_credit': '© GeoBasis-DE / LVermGeo ST, dl-de/by-2-0, Daten geändert',
  'service_terms_url': 'https://www.lvermgeo.sachsen-anhalt.de/datei/anzeigen/id/3567,501/nutzungsbedingungen_b.pdf',
  'service_limits': 'Nutzungsbedingungen V5.0 (01.03.2024): keine Regeln zu Limits, Caching, Prefetch, '
                    'User-Agent. Kontakt service@lvermgeo.sachsen-anhalt.de.',
  'confidence': 'hoch',
  'notes': 'Bereitsteller ist mit «© GeoBasis-DE / LVermGeo ST» zu bezeichnen (Nr. 2 der '
           'Nutzungsbedingungen); «LVermGeo LSA» ist die alte Schreibweise. Nur den OpenData-Endpunkt nutzen '
           '(der ältere ST_LVermGeo_GDI_DOP20 verweist auf die Kostenverordnung).',
  'sources': ['https://www.lvermgeo.sachsen-anhalt.de/de/gdp-open-data.html',
              'https://www.lvermgeo.sachsen-anhalt.de/datei/anzeigen/id/3567,501/nutzungsbedingungen_b.pdf',
              'https://www.geodatenportal.sachsen-anhalt.de/wss/service/ST_LVermGeo_DOP_WMS_OpenData/guest?service=wms&version=1.3.0&request=getcapabilities'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_kurz': '© GeoBasis-DE/LVermGeo ST dl-de/by',
  'license_hinweis': 'Datenlizenz Deutschland – Namensnennung – Version 2.0 (dl-de/by-2-0)'},
 {'id': 'de-sn',
  'provider': 'Landesamt für Geobasisinformation Sachsen (GeoSN)',
  'dataset': 'Digitale Orthophotos RGB 20 cm – WMS SN DOP-RGB (wms_geosn_dop-rgb)',
  'dataset_url': 'https://www.geodaten.sachsen.de/luftbild-produkte-3995.html',
  'license': 'dl-de/by-2-0',
  'license_url': 'https://www.govdata.de/dl-de/by-2-0',
  'commercial_video': 'true',
  'modification_notice_required': True,
  'onscreen_credit': 'Quelle: GeoSN, dl-de/by-2-0, Daten geändert',
  'service_terms_url': 'https://www.landesvermessung.sachsen.de/allgemeine-nutzungsbedingungen-8954.html',
  'service_limits': 'Keine Limits/Cache-/User-Agent-Regeln; Capabilities Fees kostenfrei; FAQ: Dienste '
                    'beliebig in Desktop- und Online-Anwendungen einbindbar; Batch-Download angeboten. '
                    'Kontakt servicedesk@geosn.sachsen.de.',
  'confidence': 'hoch',
  'notes': 'Nutzungsbedingungen: dl-de/by-2-0 mit Quellenvermerk «Landesamt für Geobasisinformation Sachsen '
           '(GeoSN)» oder kurz «GeoSN»; Beispiel elektronische Medien «Quelle: GeoSN, dl-de/by-2-0». FAQ: '
           'kommerzielle Nutzung zulässig.',
  'sources': ['https://www.landesvermessung.sachsen.de/allgemeine-nutzungsbedingungen-8954.html',
              'https://www.geodaten.sachsen.de/haufig-gestellte-fragen-4464.html',
              'https://geodienste.sachsen.de/wms_geosn_dop-rgb/guest?REQUEST=GetCapabilities&SERVICE=WMS'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_kurz': 'GeoSN dl-de/by',
  'license_hinweis': 'Datenlizenz Deutschland – Namensnennung – Version 2.0 (dl-de/by-2-0)'},
 {'id': 'de-th',
  'provider': 'Thüringer Landesamt für Bodenmanagement und Geoinformation (TLBG) / GDI-Th',
  'dataset': 'Digitale Orthophotos Thüringen DOP20 – WMS TH DOP20 (Geoproxy)',
  'dataset_url': 'https://tlbg.thueringen.de/geobasisdaten/luftbilder-orthophotos',
  'license': 'dl-de/by-2-0 (ab 14.09.2026 CC BY 4.0)',
  'license_url': 'https://www.govdata.de/dl-de/by-2-0',
  'commercial_video': 'true',
  'modification_notice_required': True,
  'onscreen_credit': '© GDI-Th, dl-de/by-2-0, bearbeitet',
  'service_terms_url': 'https://geoportal.thueringen.de/gdi-th/download-offene-geodaten',
  'service_limits': 'Capabilities: AccessConstraints NONE, MaxWidth/MaxHeight 5000 px; keine '
                    'Limits/Cache-/User-Agent-Regeln. Kontakt kompetenzzentrum.gdi-th@tlbg.thueringen.de.',
  'confidence': 'hoch',
  'notes': 'LIZENZWECHSEL: Beschluss IKG-GIZ / News 24.06.2026 — ab 14.09.2026 gilt CC BY 4.0 (Namensnennung '
           'bleibt «© GDI-Th»). Danach Lizenzangabe im Register und in der Nennung umstellen.',
  'sources': ['https://geoportal.geoportal-th.de/gaialight-th/_apps/dladownload/dl-lbop-info.html',
              'https://geoportal.thueringen.de/gdi-th/download-offene-geodaten',
              'https://www.geoproxy.geoportal-th.de/geoproxy/services/DOP20?SERVICE=WMS&REQUEST=GetCapabilities'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_hinweis': '© GDI-Th, dl-de/by-2-0, bearbeitet (ab 14.09.2026: © GDI-Th, CC BY 4.0, bearbeitet)',
  'credit_kurz': '© GDI-Th dl-de/by',
  'license_hinweis': 'dl-de/by-2-0 — ab 14.09.2026 CC BY 4.0'},
 {'id': 'de-he',
  'provider': 'Hessische Verwaltung für Bodenmanagement und Geoinformation (HVBG)',
  'dataset': 'ATKIS DOP20 (he_dop20_rgb) – WMS ogc-free-images',
  'dataset_url': 'https://hvbg.hessen.de/landesvermessung/geotopographie/luftbilder/digitale-orthophotos-true-orthophoto',
  'license': 'dl-de/zero-2-0 (§ 18 HVGG)',
  'license_url': 'https://www.govdata.de/dl-de/zero-2-0',
  'commercial_video': 'true',
  'modification_notice_required': True,
  'onscreen_credit': 'Geobasisdaten © HVBG, bearbeitet',
  'service_terms_url': 'https://hvbg.hessen.de/geoinformation/open-data',
  'service_limits': 'Capabilities: automatisierter Abruf kostenfrei (§ 24 HVGG), MaxWidth/MaxHeight 3000 px; '
                    'keine Limits/Cache-/User-Agent-Regeln. Kontakt gds@hvbg.hessen.de.',
  'confidence': 'hoch',
  'notes': 'Kein Pflicht-Quellenvermerk (dl-de/zero), ABER § 18 HVGG: wird ein Quellenvermerk beigegeben, '
           'muss er auf Veränderungen/Bearbeitungen hinweisen → mit Credit immer «bearbeitet» zeigen.',
  'sources': ['https://hvbg.hessen.de/geoinformation/open-data',
              'https://www.gds-srv.hessen.de/cgi-bin/lika-services/ogc-free-images.ows?SERVICE=WMS&REQUEST=GetCapabilities',
              'https://www.govdata.de/dl-de/zero-2-0'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_hinweis': 'Geobasisdaten © Hessische Verwaltung für Bodenmanagement und Geoinformation, bearbeitet',
  'credit_kurz': '© HVBG',
  'license_hinweis': 'Datenlizenz Deutschland – Zero – Version 2.0 (dl-de/zero-2-0), § 18/§ 24 HVGG'},
 {'id': 'de-nw',
  'provider': 'Geobasis NRW (Bezirksregierung Köln)',
  'dataset': 'Digitale Orthophotos NW (DOP, 10 cm) – WMS NW DOP / WMTS NW DOP',
  'dataset_url': 'https://www.bezreg-koeln.nrw.de/geobasis-nrw/produkte-und-dienste/luftbild-und-satellitenbildinformationen/aktuelle-luftbild-und-0',
  'license': 'dl-de/zero-2-0',
  'license_url': 'https://www.govdata.de/dl-de/zero-2-0',
  'commercial_video': 'true',
  'modification_notice_required': False,
  'onscreen_credit': 'Geobasis NRW',
  'service_terms_url': 'https://www.bezreg-koeln.nrw.de/system/files/media/document/file/lizenzbedingungen_geobasis_nrw.pdf',
  'service_limits': 'Lizenz-PDF: nur dl-de/zero + Haftungsausschluss; Capabilities AccessConstraints NONE, '
                    'MaxWidth/MaxHeight 5000 px; keine Limits/Cache-/User-Agent-Regeln; WMTS für Kacheln '
                    'vorgesehen. Kontakt geobasis@bezreg-koeln.nrw.de.',
  'confidence': 'hoch',
  'notes': 'Jede Nutzung ohne Einschränkungen; kein Pflicht-Quellenvermerk, kein Änderungshinweis. '
           'Freiwilliger Credit «© Geobasis NRW» üblich.',
  'sources': ['https://www.bezreg-koeln.nrw.de/geobasis-nrw/open-data',
              'https://www.bezreg-koeln.nrw.de/system/files/media/document/file/lizenzbedingungen_geobasis_nrw.pdf',
              'https://www.wms.nrw.de/geobasis/wms_nw_dop?SERVICE=WMS&REQUEST=GetCapabilities'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_kurz': 'Geobasis NRW',
  'license_hinweis': 'Datenlizenz Deutschland – Zero – Version 2.0 (dl-de/zero-2-0)'},
 {'id': 'de-rp',
  'provider': 'Landesamt für Vermessung und Geobasisinformation Rheinland-Pfalz (LVermGeoRP)',
  'dataset': 'Digitale Orthophotos 0,2 m (DOP20RGB) – WMS RP DOP20',
  'dataset_url': 'https://lvermgeo.rlp.de/geodaten-geoshop/open-data',
  'license': 'dl-de/by-2-0',
  'license_url': 'https://www.govdata.de/dl-de/by-2-0',
  'commercial_video': 'true',
  'modification_notice_required': True,
  'onscreen_credit': '©GeoBasis-DE / LVermGeoRP 2026, dl-de/by-2-0, www.lvermgeo.rlp.de [Daten bearbeitet]',
  'service_terms_url': 'https://lvermgeo.rlp.de/geodaten-geoshop/open-data',
  'service_limits': 'Keine Limits/Cache-/Prefetch-/User-Agent-Regeln; Capabilities AccessConstraints NONE, '
                    'MaxWidth/MaxHeight 10000 px. Kontakt vertrieb-geodienste@vermkv.rlp.de.',
  'confidence': 'hoch',
  'notes': 'Open-Data-Seite und Capabilities nennen dieselbe Formel mit «[Daten bearbeitet]» als '
           'Veränderungskennzeichnung; Jahr = Jahr des Datenbezugs. Die «Allgemeinen Nutzungsbedingungen» '
           'gelten für lizenzpflichtige Produkte, nicht für Open Data.',
  'sources': ['https://lvermgeo.rlp.de/geodaten-geoshop/open-data',
              'https://geo4.service24.rlp.de/wms/rp_dop20.fcgi?REQUEST=GetCapabilities&SERVICE=WMS&VERSION=1.3.0',
              'https://www.govdata.de/dl-de/by-2-0'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_kurz': '© GeoBasis-DE/LVermGeoRP dl-de/by',
  'license_hinweis': 'Datenlizenz Deutschland – Namensnennung – Version 2.0 (dl-de/by-2-0)'},
 {'id': 'de-bw',
  'provider': 'Landesamt für Geoinformation und Landentwicklung Baden-Württemberg (LGL)',
  'dataset': 'DOP20 – WMS/WMTS LGL-BW ATKIS DOP 20 C',
  'dataset_url': 'https://www.lgl-bw.de/Produkte/Open-Data/index.html',
  'license': 'dl-de/by-2-0',
  'license_url': 'https://www.govdata.de/dl-de/by-2-0',
  'commercial_video': 'true',
  'modification_notice_required': True,
  'onscreen_credit': 'Datenquelle: LGL, www.lgl-bw.de, dl-de/by-2-0, Daten bearbeitet',
  'service_terms_url': 'https://www.lgl-bw.de/agb/agb-lgl.html',
  'service_limits': 'Keine Limits/Cache-/Prefetch-/User-Agent-Regeln; Capabilities Fees «Unentgeltliche '
                    'Nutzung nach Open Data Lizenz». Keine Gewähr für dauerhafte Verfügbarkeit. Kontakt '
                    'benutzerservice@lgl.bwl.de.',
  'confidence': 'hoch',
  'notes': 'Open-Data-Seite und AGB: Namensnennung wörtlich «Datenquelle: LGL, www.lgl-bw.de, dl-de/by-2-0»; '
           'Capabilities-Variante «LGL-BW (Jahr) Datenlizenz Deutschland – Namensnennung – Version 2.0, '
           'www.lgl-bw.de». Ministerium bestätigt kommerzielle Nutzung.',
  'sources': ['https://www.lgl-bw.de/Produkte/Open-Data/index.html',
              'https://www.lgl-bw.de/agb/agb-lgl.html',
              'https://mlw.baden-wuerttemberg.de/de/landesentwicklung/geoinformation/open-data'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_kurz': 'LGL BW dl-de/by',
  'license_hinweis': 'Datenlizenz Deutschland – Namensnennung – Version 2.0 (dl-de/by-2-0)'},
 {'id': 'de-by',
  'provider': 'Bayerische Vermessungsverwaltung – Landesamt für Digitalisierung, Breitband und Vermessung '
              '(LDBV)',
  'dataset': 'DOP20 RGB – WMS BY DOP20 (OpenData, by_dop20c)',
  'dataset_url': 'https://geodaten.bayern.de/opengeodata/OpenDataDetail.html?pn=dop20rgb',
  'license': 'CC BY 4.0',
  'license_url': 'https://creativecommons.org/licenses/by/4.0/deed.de',
  'commercial_video': 'true',
  'modification_notice_required': True,
  'onscreen_credit': 'Geobasisdaten: Bayerische Vermessungsverwaltung – www.geodaten.bayern.de (Daten '
                     'verändert), CC BY 4.0',
  'service_terms_url': 'https://www.geodaten.bayern.de/odd/m/3/html/nutzungsbedingungen.html',
  'service_limits': 'WMS kostenfrei ohne Authentifizierung, GetMap max. 6000×6000 px; keine '
                    'Limits/Cache-/Prefetch-/User-Agent-Regeln. Kontakt service@geodaten.bayern.de.',
  'confidence': 'hoch',
  'notes': 'Nutzungsbedingungen: Namensnennung «Bayerische Vermessungsverwaltung – www.geodaten.bayern.de»; '
           'FAQ: bei Veränderung Zusatz «Daten verändert». Kommerzielle Nutzung ausdrücklich erlaubt.',
  'sources': ['https://www.geodaten.bayern.de/odd/m/3/html/nutzungsbedingungen.html',
              'https://www.geodaten.bayern.de/odd/m/3/html/faq.html',
              'https://geoservices.bayern.de/od/wms/dop/v1/dop20?SERVICE=WMS&REQUEST=GetCapabilities'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_kurz': 'Bayer. Vermessungsverwaltung CC BY',
  'license_hinweis': 'Creative Commons Namensnennung 4.0 International (CC BY 4.0)'},
 {'id': 'lu',
  'provider': 'Administration du cadastre et de la topographie (ACT), Grand-Duché de Luxembourg – '
              'geoportail.lu',
  'dataset': 'BD-L-ORTHO – Webservices WMS et WMTS (Open Data WMTS, Layer «ortho_latest» = «Dernières '
             'Photographies aériennes orthorectifiées»; aktuell Orthophoto été 2025, GSD ≤10 cm)',
  'dataset_url': 'https://data.public.lu/en/datasets/bd-l-ortho-webservices-wms-et-wmts/',
  'license': 'CC0 1.0',
  'license_url': 'https://creativecommons.org/publicdomain/zero/1.0/',
  'commercial_video': 'true',
  'modification_notice_required': False,
  'onscreen_credit': 'Orthophoto: Administration du cadastre et de la topographie, geoportail.lu (CC0)',
  'service_terms_url': 'https://www.geoportail.lu/en/about-us/terms-conditions/',
  'service_limits': 'Keine numerischen Limits veröffentlicht. WMTS-Capabilities: Fees «none», '
                    "AccessConstraints «none». geoportail.lu T&C (FR): «L'usager de geoportal.lu reconnaît "
                    "avoir pris connaissance du fait que l'appel aux géoservices génère des flux de données "
                    'ainsi que des charges de traitement important au niveau des serveurs de données. '
                    "L'usager évite toute requête abusive.» Keine Regeln zu Caching/Prefetch/User-Agent "
                    'gefunden. Kontakt Service: support.geoportail@act.etat.lu; Status: '
                    'https://status.geoportail.lu/',
  'confidence': 'hoch',
  'notes': 'Lizenz CC0 dreifach bestätigt: data.public.lu-Datensatzseite (BD-L-ORTHO Webservices, «Creative '
           'Commons Zero (CC0)»), Geocatalogue-Service-Metadaten («Toutes les données publiées à travers ce '
           'services sont licencées sous CC0») und data.public.lu-Portalbedingungen (Inhalte standardmäßig '
           'CC0 1.0). Einzel-Orthophotos (été/hiver 2025) ebenfalls CC0. Kommerzielle Nutzung, Bearbeitung '
           'und Veröffentlichung in monetarisierten Videos damit ohne Auflagen erlaubt; kein '
           'Änderungshinweis nötig. Einzige Auflage aus den geoportail-T&C: kein «usage abusif» der '
           'Geodienste (Serverlast). Layer «ortho_latest» in WMTS-Capabilities bestätigt.',
  'sources': ['https://data.public.lu/en/datasets/bd-l-ortho-webservices-wms-et-wmts/',
              'https://data.public.lu/fr/datasets/bd-l-ortho-webservices-wms-et-wmts/',
              'https://data.public.lu/en/datasets/orthophoto-officielle-du-grand-duche-de-luxembourg-edition-ete-2025/',
              'https://geocatalogue.geoportail.lu/geonetwork/geoportail-lu/api/records/cd6fd37d-afc8-4911-9641-e050650e39a9?language=eng',
              'https://wmts1.geoportail.lu/opendata/wmts/1.0.0/WMTSCapabilities.xml',
              'https://www.geoportail.lu/en/about-us/terms-conditions/',
              'https://www.geoportail.lu/fr/about-us/terms-conditions/',
              'https://www.geoportail.lu/en/applications/map-api/',
              'https://data.public.lu/en/pages/legal/terms',
              'https://data.public.lu/en/organizations/administration-du-cadastre-et-de-la-topographie/'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_hinweis': 'Keine Pflichtformel (CC0 – Public-Domain-Dedication, keine Namensnennung '
                    'vorgeschrieben). Freiwillig empfohlen: «Orthophoto: Administration du cadastre et de la '
                    'topographie, geoportail.lu (CC0)»',
  'credit_kurz': 'ACT Luxembourg CC0',
  'license_hinweis': 'Creative Commons Zero (CC0 1.0 Universal)'},
 {'id': 'ch',
  'provider': 'Bundesamt für Landestopografie swisstopo (Federal Office of Topography swisstopo), Schweiz',
  'dataset': 'SWISSIMAGE 10 cm – Digitales Farb-Orthophotomosaik der Schweiz (WMTS-Layer '
             'ch.swisstopo.swissimage / ch.swisstopo.swissimage-product, BGDI/FSDI)',
  'dataset_url': 'https://www.swisstopo.admin.ch/en/orthoimage-swissimage-10',
  'license': 'swisstopo OGD-Nutzungsbedingungen',
  'license_url': 'https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices',
  'commercial_video': 'true',
  'modification_notice_required': False,
  'onscreen_credit': '© swisstopo',
  'service_terms_url': 'https://www.geo.admin.ch/en/general-terms-of-use-fsdi',
  'service_limits': 'Fair Use ohne Registrierung, kostenlos, Best Effort. «A maximum number of requests per '
                    'time unit is specified in the table below» – die Tabelle mit Zahlen ist auf der Seite '
                    '(DE+EN, Stand 07.09.2026) NICHT vorhanden; laut Ankündigung wurden die Request-Limiten '
                    'per 01.01.2025 verdoppelt. «The integration of geoservices in web applications with an '
                    'average of 20,000 users per day or desktop applications corresponds to fair use.» '
                    'Web-Scraping: «Automatic parsing of geoservices via bots with high query intensities is '
                    'to be avoided. The download service should be used to obtain the datasets outside the '
                    'context of the web services.» Lokales Tile-Caching ist vorgesehen (WMTS-Doku: Cache per '
                    'Cache-Update-Service invalidieren). Bei übermäßiger Nutzung kann der Zugang '
                    'eingeschränkt/verweigert werden; bei absehbarer Überschreitung vorab info@geo.admin.ch '
                    'kontaktieren. Keine User-Agent-/Referer-Vorgabe gefunden.',
  'confidence': 'hoch',
  'notes': 'Nutzungsbedingungen (DE): «Die kostenlosen Geodaten und Geodienste von swisstopo dürfen genutzt, '
           'verbreitet und zugänglich gemacht werden. Weiter dürfen sie angereichert, bearbeitet sowie auch '
           'kommerziell genutzt werden.» Einzige Auflage = Quellenangabe. FAQ bestätigt kommerzielle Nutzung '
           '(«Yes. The aim is the widest and most versatile usage») und regelt Videos explizit (Quelle am '
           'Ende des Videos akzeptabel). Kein Pflicht-Änderungshinweis, «abgeleitet von» ist optional. '
           'Achtung Produktseite SWISSIMAGE: für die 20 größten Seen ab Bildjahr 2018 RapidEye-Material – '
           'Zusatzvermerk «Includes material © (2016-2018) Planet. All rights reserved» vorgesehen; '
           'sicherheitshalber im Abspann mitführen. BGDI-Bedingungen nennen als Muster den '
           'Kartenviewer-Vermerk «© Data: swisstopo». swissALTIRegio/swissEO haben abweichende Formeln (hier '
           'nicht relevant).',
  'sources': ['https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices',
              'https://www.swisstopo.admin.ch/de/nutzungsbedingungen-kostenlose-geodaten-und-geodienste',
              'https://www.swisstopo.admin.ch/en/source-reference-ogd-swisstopo',
              'https://www.swisstopo.admin.ch/de/quellenangabe-ogd-swisstopo',
              'https://www.swisstopo.admin.ch/en/faq-free-geodata',
              'https://www.swisstopo.admin.ch/en/orthoimage-swissimage-10',
              'https://www.geo.admin.ch/en/general-terms-of-use-fsdi',
              'https://www.geo.admin.ch/de/allgemeine-nutzungsbedingungen-bgdi',
              'https://www.geo.admin.ch/de/geo-dienstleistungen/geodienste/terms-of-use.html',
              'https://www.geo.admin.ch/de/neue-fair-use-limiten',
              'https://www.geo.admin.ch/en/change-limits-fair-use',
              'https://docs.geo.admin.ch/visualize-data/wmts.html'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_hinweis': '«©swisstopo» – alternativ «Bundesamt für Landestopografie swisstopo» / «Federal Office '
                    'of Topography swisstopo» / «Source: Federal Office of Topography swisstopo». Für Videos '
                    '(Quellenangabe-Seite): ideal bei jedem Erscheinen neben den Geodaten; akzeptabel: «Die '
                    'Quelle wird an zentraler Stelle am Ende des Videos … genannt» / «The source is '
                    'mentioned in a central place at the end of the video». Bei abgeleiteten Daten optional '
                    'Zusatz «abgeleitet von …» / «derived from …».',
  'credit_kurz': '© swisstopo',
  'license_hinweis': 'Nutzungsbedingungen für kostenlose Geodaten und Geodienste (OGD) von swisstopo / Terms '
                     'of use for free geodata and geoservices (OGD) from swisstopo (keine CC-Lizenz; '
                     'Grundlage GeoIG/GeoIV)'},
 {'id': 'nl',
  'provider': 'Samenwerkingsverband Beeldmateriaal (Beeldmateriaal Nederland), Datenhalter Kadaster; '
              'Bereitstellung über PDOK (Publieke Dienstverlening Op de Kaart)',
  'dataset': 'Luchtfoto Actueel Ortho 25cm RGB (WMTS-Layer «Actueel_ortho25», Service «Landelijke '
             'Voorziening Beeldmateriaal»; aktuell = Luchtfoto Beeldmateriaal 2025 25cm RGB open data)',
  'dataset_url': 'https://www.pdok.nl/introductie/-/article/pdok-luchtfoto-rgb-open-',
  'license': 'CC BY 4.0',
  'license_url': 'https://creativecommons.org/licenses/by/4.0/deed.nl/',
  'commercial_video': 'true',
  'modification_notice_required': True,
  'onscreen_credit': 'Luchtfoto: Beeldmateriaal.nl (CC BY 4.0)',
  'service_terms_url': 'https://www.pdok.nl/pdc-afnemers-van-data',
  'service_limits': 'Service-Level «PDOK Fair Use» für Bedrijven/particulieren, keine Anmeldung nötig («Als '
                    'bedrijf of particulier kan je van de PDOK diensten gebruik maken. Hiervoor is geen '
                    'aanmelding bij PDOK nodig.»); garantierte Kapazität nur für registrierte Behörden (PDOK '
                    'Basis). Keine numerischen Tile-Limits veröffentlicht; PDC nennt Verfügbarkeit 98,50 %, '
                    '7x24 Best-Effort. Bulk: «De gebruiker die massale hoeveelheden data bij PDOK afneemt '
                    "(zgn. 'bulkafname') dient te allen tijde de zogenoemde Atomfeed als afnamekanaal te "
                    'gebruiken.» Bei Verstoß gegen Fair Use nimmt PDOK zuerst Kontakt auf. Keine '
                    'Caching-/User-Agent-Regel gefunden. WMTS-Capabilities: Fees «none», AccessConstraints '
                    '«none». Kontakt: BeheerPDOK@kadaster.nl (KlantContactCenter PDOK), Datenhalter '
                    'dpi-gi@kadaster.nl.',
  'confidence': 'hoch',
  'notes': 'Lizenz CC BY 4.0 bestätigt auf PDOK-Datensatzseite («kosteloos en vrij beschikbaar voor alle '
           'toepassingen, onder een CC-BY licentie»), im NGR-Metadatensatz 2025 25cm RGB (useLimitation '
           '«Geen beperkingen», otherConstraints «Naamsvermelding verplicht, Beeldmateriaal.nl», CC BY 4.0) '
           'und auf beeldmateriaal.nl («De beelden worden beschikbaar gesteld met een CC BY 4.0 licentie … '
           'mogen zonder verplichtingen worden gebruikt of aangepast door eenieder»). PDOK-Copyright-Seite: '
           'CC BY erlaubt kopiëren/verspreiden, remixen und «gebruik maken van het werk voor commerciële '
           'doeleinden»; NGR-Metadaten sind «leidend». Änderungshinweis: ergibt sich aus dem '
           'CC-BY-4.0-Lizenztext (Sec. 3(a)(1)(B) «indicate if You modified the Licensed Material»), nicht '
           'aus einer PDOK-Seite – im Abspann z. B. «bearbeitet/zugeschnitten» ergänzen. Die geschlossene '
           '«Landelijke Voorziening Beeldmateriaal (Gesloten)» ist ein anderer Dienst; Ortho25 ist seit 2016 '
           'open data.',
  'sources': ['https://www.pdok.nl/introductie/-/article/pdok-luchtfoto-rgb-open-',
              'https://www.nationaalgeoregister.nl/geonetwork/srv/api/records/7b424340-25c5-4c95-8dbf-bf1d87888566/formatters/xml',
              'https://www.beeldmateriaal.nl/dataroom',
              'https://www.pdok.nl/copyright',
              'https://www.pdok.nl/open-data',
              'https://www.pdok.nl/how-to-faq',
              'https://www.pdok.nl/pdc-afnemers-van-data',
              'https://www.pdok.nl/documents/d/pdok/pdok_pdc_afnemers-oktober-2023-v1-1?download=false',
              'https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0?request=GetCapabilities&service=wmts',
              'https://www.pdok.nl/introductie/-/article/luchtfoto-landelijke-voorziening-beeldmateriaal',
              'https://data.overheid.nl/dataset/60246-luchtfoto-beeldmateriaal-2025-25cm-rgb-open-data'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_hinweis': '«Naamsvermelding verplicht, Beeldmateriaal.nl» (NGR-Metadaten, otherConstraints). '
                    'beeldmateriaal.nl: «Wel vragen wij voor publicaties te refereren aan '
                    'beeldmateriaal.nl.» Empfohlene Formel: «Luchtfoto: Beeldmateriaal.nl (CC BY 4.0)» bzw. '
                    '«© Beeldmateriaal.nl, CC BY 4.0».',
  'credit_kurz': 'Beeldmateriaal.nl CC BY',
  'license_hinweis': 'Creative Commons Naamsvermelding 4.0 Internationaal (CC BY 4.0)'},
 {'id': 'at',
  'provider': 'basemap.at (geoland.at / Länder Österreichs; Betrieb Stadt Wien, MA 41 '
              'GDI-Koordinierungsstelle)',
  'dataset': 'basemap.at Orthofoto (WMTS-Layer bmaporthofoto30cm, Komposit der aktuellsten '
             'Länder-Luftbilder, 29 cm / 15 cm)',
  'dataset_url': 'https://basemap.at/en/orthofoto/',
  'license': 'CC BY 4.0 (OGD Oesterreich)',
  'license_url': 'https://creativecommons.org/licenses/by/4.0/',
  'commercial_video': 'true',
  'modification_notice_required': False,
  'onscreen_credit': 'Datenquelle: basemap.at (CC BY 4.0)',
  'service_terms_url': 'https://basemap.at/#nutzungsbedingungen',
  'service_limits': 'Keine Rate-Limits, Cache-/Prefetch- oder User-Agent-Regeln veröffentlicht. basemap.at '
                    'läuft als „Golden Service“ (Verfügbarkeit > 99,985 %), alle Nutzer teilen sich die '
                    'Infrastruktur, keine Exklusivverträge. Offizielle Raster-Schnittstelle laut basemap.at: '
                    'https://mapsneu.wien.gv.at/basemapneu/1.0.0/WMTSCapabilities.xml (mapsneu.wien.gv.at '
                    'ist damit der offizielle Endpunkt, kein inoffizieller Mirror). Orthofoto wird jährlich '
                    'aktualisiert; in Zoom 17–20 ist das Flugjahr als Wasserzeichen in die Kacheln '
                    'geschrieben. Kontakt über Kontaktformular auf basemap.at.',
  'confidence': 'hoch',
  'notes': 'Wortlaut der Nutzungsbedingungen (basemap.at, 07.09.2026): „basemap.at ist gemäß der Open '
           'Government Data Österreich Lizenz CC-BY 4.0 sowohl für private als auch kommerzielle Zwecke frei '
           'sowie entgeltfrei nutzbar. Die Namensnennung hat in folgender Weise zu erfolgen: ‚Datenquelle: '
           'basemap.at‘ bzw. ‚Grundkarte: basemap.at‘, wobei ‚basemap.at‘ als Link auf basemap.at '
           'auszuführen ist.“ Englische Fassung: „basemap.at can be used for any purpose, even commercially '
           '… ‚Data source: basemap.at‘ – including the hyperlink to basemap.at“. Fallbeispiel-PDF '
           '(cdn.basemap.at/basemapat_Copyright.pdf, 20.12.2017): Credit muss als Text UND Link erscheinen, '
           'sobald basemap.at als Karte dargestellt wird; Hinweis nur im Impressum ist „nicht optimal, aber '
           'zulässig“; Google-/Apple-Copyright allein ist irreführend und unzulässig. basemap.at selbst '
           'verlangt keinen Bearbeitungshinweis; CC BY 4.0 §3(a)(1)(B) verlangt allgemein, Änderungen '
           'anzugeben – ein Track-Overlay über unveränderten Kacheln ist unkritisch, bei '
           'Farb-/Bildbearbeitung „bearbeitet“ ergänzen. Video-Credit-Empfehlung: Bildeinblendung '
           '„Datenquelle: basemap.at“ + Link in der Videobeschreibung (im Video ist kein Hyperlink möglich). '
           'Der data.gv.at-Katalogeintrag (basemap.at verweist darauf) war am Prüftag über die gefundenen '
           'URLs nicht abrufbar (HTTP 404) – Lizenzangabe dort nicht gegengeprüft.',
  'sources': ['https://basemap.at/',
              'https://basemap.at/en/',
              'https://basemap.at/en/orthofoto/',
              'https://cdn.basemap.at/basemapat_Copyright.pdf',
              'https://wiki.openstreetmap.org/wiki/DE:AT/basemap'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_hinweis': 'Datenquelle: basemap.at  (alternativ: Grundkarte: basemap.at; EN: Data source: '
                    'basemap.at) – „basemap.at“ ist als Link auf https://basemap.at auszuführen',
  'credit_kurz': 'basemap.at CC BY',
  'license_hinweis': 'Open Government Data Österreich Lizenz CC-BY 4.0 (Creative Commons Attribution 4.0 '
                     'International)'},
 {'id': 'cz',
  'provider': 'Český úřad zeměměřický a katastrální (ČÚZK) / Zeměměřický úřad (ZÚ)',
  'dataset': 'Ortofoto České republiky (Ortofoto ČR) – Kachel-Dienst ORTOFOTO_WM (Esri ArcGIS Server, Web '
             'Mercator)',
  'dataset_url': 'https://geoportal.cuzk.cz/Default.aspx?mode=TextMeta&metadataID=CZ-CUZK-ORTOFOTO-R&metadataXSL=full&side=ortofoto',
  'license': 'CC BY 4.0',
  'license_url': 'https://cuzk.gov.cz/Predpisy/Podminky-poskytovani-prostor-dat-a-sitovych-sluzeb/Podminky-poskytovani-prostorovych-dat-CUZK.aspx',
  'commercial_video': 'true',
  'modification_notice_required': True,
  'onscreen_credit': '© ČÚZK – on-line (CC BY 4.0)',
  'service_terms_url': 'https://cuzk.gov.cz/Predpisy/Podminky-poskytovani-prostor-dat-a-sitovych-sluzeb/Podminky-poskytovani-sitovych-sluzeb-CUZK.aspx',
  'service_limits': 'Keine konkreten Rate-Limits, Cache-/Prefetch-Verbote oder User-Agent-Vorgaben '
                    'veröffentlicht. Dienste sind kostenlos, ohne Registrierung, „otevřené … bez omezení '
                    'komerčně i nekomerčně, pokud rozsah užití není na újmu poskytovatele“. Bei Überlastung '
                    'der Infrastruktur („přetěžuje technologickou infrastrukturu ČÚZK“) darf ČÚZK den Nutzer '
                    'technisch sperren; ČÚZK darf Zugriff aus Betriebsgründen zeitweise einschränken; '
                    'Qualitätsgarantie nur für INSPIRE-Dienste. ZÚ „Zásady užívání dat a služeb“ (23.3.2026) '
                    'Pkt. 7.3 gleichlautend. Kontakt (Dienst-Metadaten): milan.krizek@cuzk.gov.cz, +420 284 '
                    '047 430. Offizielle Service-URL laut Geoportal-Metadaten: '
                    'https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO/MapServer; ORTOFOTO_WM auf '
                    'ags.cuzk.cz liefert Kacheln 256 px, 24 Zoomstufen, Copyright „© ČÚZK“.',
  'confidence': 'hoch',
  'notes': 'Bestätigt: „Český úřad zeměměřický a katastrální … poskytuje prostorová data spadající do '
           'kategorie otevřených dat (včetně metadat) bezúplatně na základě licence Creative Commons CC-BY '
           '4.0“ – inkl. „ortofota České republiky“. Pflichten laut Datenbedingungen: „tiskové výstupy z '
           'těchto dat a prohlížecí služby nad těmito daty musí obsahovat uvedení zdroje ve formátu: ‚ČÚZK, '
           '[rok]‘“, „zpřístupnění těchto podmínek užití formou odkazu na internetové stránky ČÚZK“, „v '
           'případě šíření upraveného díla, uvést popis úpravy“ (→ Bearbeitungshinweis Pflicht, z. B. '
           '„Ortofoto bearbeitet/mit GPS-Track überlagert“). Dienstbedingungen: „uvedení poskytovatele '
           'služby ve formátu: ‚ČÚZK – on-line‘ při užití prohlížecí služby ve vlastním produktu uživatele“, '
           '„zpřístupnění těchto podmínek … formou odkazu“, „při užití služby je uživatel povinen uvést '
           'příslušná metadata“. Video-Empfehlung: Einblendung „Ortofoto: © ČÚZK – on-line, [Jahr]“ + in der '
           'Videobeschreibung Link auf die ČÚZK-Bedingungen und CC BY 4.0. Geoportal-Metadaten: „Omezení '
           'zdroje: Bez poplatků, Licence Creative Commons CC BY 4.0, Dle Vyhlášky č. 31/1995 Sb.“',
  'sources': ['https://cuzk.gov.cz/Predpisy/Podminky-poskytovani-prostor-dat-a-sitovych-sluzeb/Podminky-poskytovani-prostorovych-dat-CUZK.aspx',
              'https://cuzk.gov.cz/Predpisy/Podminky-poskytovani-prostor-dat-a-sitovych-sluzeb/Podminky-poskytovani-sitovych-sluzeb-CUZK.aspx',
              'https://geoportal.cuzk.cz/Default.aspx?mode=TextMeta&metadataID=CZ-CUZK-ORTOFOTO-R&metadataXSL=full&side=ortofoto',
              'https://geoportal.cuzk.cz/Default.aspx?menu=3141&mode=TextMeta&side=wms.AGS&metadataID=CZ-CUZK-AGS-ORTOFOTO&metadataXSL=metadata.sluzba',
              'https://geoportal.cuzk.cz/Default.aspx?head_tab=sekce-05-gp&mode=TextMeta&text=data_uvod&menu=50&news=yes',
              'https://geoportal.cuzk.cz/Dokumenty/Podminky.pdf',
              'https://ags.cuzk.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_hinweis': 'ČÚZK – on-line  (bei Nutzung des Prohlížecí-/Kacheldienstes im eigenen Produkt); für '
                    'Daten/Druckausgaben: „ČÚZK, [rok]“ (Jahr = Aktualität der Daten); Copyright-Text des '
                    'Dienstes: „© ČÚZK“',
  'credit_kurz': '© ČÚZK',
  'license_hinweis': 'Creative Commons CC BY 4.0 (Daten; offiziell seit 1.7.2023 Open Data) + „Podmínky '
                     'poskytování síťových služeb ČÚZK“ v1.0 vom 4.3.2016 (Dienst)'},
 {'id': 'ee',
  'provider': 'Maa- ja Ruumiamet (Republic of Estonia Land and Spatial Development Board; früher Maa-amet / '
              'Estonian Land Board)',
  'dataset': 'Eesti ortofotod (Ortofoto, 20–40 cm landesweit, 10–16 cm in Siedlungen) – TMS/WMTS-Layer '
             'foto@GMC (EPSG:3857) auf tiles.maaamet.ee',
  'dataset_url': 'https://geoportaal.maaamet.ee/est/ruumiandmed/ortofotod-p99.html',
  'license': 'Maa- ja Ruumiameti avaandmete litsents (CC-BY-aehnlich)',
  'license_url': 'https://geoportaal.maaamet.ee/opendata-licence',
  'commercial_video': 'true',
  'modification_notice_required': False,
  'onscreen_credit': 'Ortofoto: Maa- ja Ruumiamet (Republic of Estonia Land and Spatial Development Board)',
  'service_terms_url': 'https://geoportaal.maaamet.ee/est/Teenused/WMSWFS-teenused/Maa-ameti-kaarditeenuste-kasutustingimused-p24.html',
  'service_limits': 'Pkt. 12: „Teenustest kaardipiltide puhverdamine (massiline allalaadimine) ei ole '
                    'soovitav, kuid seda võib teha töövälisel ajal eelkõige TMS / WMTS teenustest“ '
                    '(Caching/Massendownload unerwünscht, außerhalb der Arbeitszeit v. a. aus TMS/WMTS '
                    'geduldet; WMS nur begrenzt). Pkt. 13: Last wird überwacht, IP-Adressen mit störender '
                    'Anfragemenge/-intensität werden gesperrt. Pkt. 14: keine Verfügbarkeitszusage. Keine '
                    'Zahlen zu Rate-Limits, kein User-Agent-Zwang. MapCache-Leitfaden (Maa-amet 2023): '
                    'Zugriff über eigenen Proxy ODER Zusatzparameter &ASUTUS=&KESKKOND=&IS= zur Statistik, '
                    'Nutzung bitte per Mail an kaardirakendus@maaamet.ee (heute kaardirakendus@maaruum.ee, '
                    '+372 665 0600) anmelden. WMS-Bedingungen gelten ausdrücklich auch für TMS/WMTS/WMS-C. '
                    'Ortofoto-Kachellayer wird 1× jährlich (Herbst) erneuert.',
  'confidence': 'hoch',
  'notes': 'Behörde heißt seit 2025 Maa- ja Ruumiamet – alte Credits „Maa-amet“ sind veraltet. '
           'Dienst-Bedingungen Pkt. 3: „Teenused on tasuta, igaühele“; Pkt. 5: Urheberrecht bei Maa- ja '
           'Ruumiamet; Pkt. 6 (verbatim): „Teenuste kaudu saadud materjali avalikkusele esitlemisel või '
           'integreerimisel enda loodud teenustesse tuleb viidata andmete päritolule, märkides ära andmete '
           'nimetuse, väljavõtte aja või andmete vanuse ning Maa- ja Ruumiameti nime. Näiteks ‚Aluskaart: '
           'Maa- ja Ruumiamet [aasta]‘ või ‚Maa- ja Ruumiameti ortofoto [kuupäev]‘ …“; Pkt. 7: '
           'Auszüge/Ableitungen, Kombination mit eigenen Produkten, öffentliche Wiedergabe, „kasutada '
           'andmeid ärilisel või mitte-ärilisel eesmärgil“ mit Quellenhinweis erlaubt. Open-Data-Lizenz '
           '(PDF, EN): „use the data for commercial or non-commercial purposes“, Pflicht zum Quellenhinweis '
           'mit Name + Titel + Datenalter; bei Weitergabe der Daten Lizenztext/Link '
           'https://geoportaal.maaruum.ee/opendata-licence beifügen; Quellenhinweis auf schriftliche '
           'Aufforderung der Behörde entfernen. Kein Bearbeitungshinweis gefordert; nur wenn das '
           'Kartendesign wesentlich verändert wurde, soll stattdessen auf die zugrunde liegenden Raumdaten '
           'verwiesen werden („… aluseks Maa- ja Ruumiameti ruumiandmed seisuga [kuupäev]“). Englische '
           'WMS-Seite: „Please refer to the source of origin when using extracted data, printouts, etc.“ '
           'Video-Empfehlung: Einblendung „Ortofoto: Maa- ja Ruumiamet [Jahr]“ (EN „Orthophoto: Republic of '
           'Estonia Land and Spatial Development Board [year]“), Render-Prefetch der Kacheln nur moderat und '
           'möglichst außerhalb estnischer Arbeitszeit; Kennzeichnungs-Parameter ASUTUS/KESKKOND/IS an die '
           'Kachel-URL hängen ist wünschenswert.',
  'sources': ['https://geoportaal.maaamet.ee/est/Teenused/WMSWFS-teenused/Maa-ameti-kaarditeenuste-kasutustingimused-p24.html',
              'https://geoportaal.maaamet.ee/eng/Services/Public-WMS-Service-p346.html',
              'https://geoportaal.maaamet.ee/opendata-licence',
              'https://geoportaal.maaamet.ee/avaandmete-litsents',
              'https://geoportaal.maaamet.ee/est/ruumiandmed/ortofotod-p99.html',
              'https://geoportaal.maaamet.ee/est/Teenused/WMS-teenused/TMS-WMS-C-ja-WMTS-teenused-p481.html',
              'https://geoportaal.maaamet.ee/docs/WMS/MapCache_teenused_juhend_v2.pdf',
              'https://tiles.maaamet.ee/tm/tms/1.0.0/foto@GMC/'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_hinweis': 'Maa- ja Ruumiameti ortofoto [kuupäev]  (Dienst-Bedingungen Pkt. 6); Lizenz-Beispiel: '
                    '„Ortofoto 21.05.2024, Maa- ja Ruumiamet“ / EN: „Orthophoto 21.05.2024, Republic of '
                    'Estonia Land and Spatial Development Board“ – Pflichtbestandteile: Name der Behörde, '
                    'Datensatzname, Datenalter bzw. Auszugsdatum',
  'credit_kurz': 'Maa- ja Ruumiamet',
  'license_hinweis': 'Maa- ja Ruumiameti avaandmete litsents, 01.01.2025 (eigene Open-Data-Lizenz, '
                     'CC-BY-ähnlich, nicht CC BY 4.0) – für den Kacheldienst zusätzlich „Maa- ja Ruumiameti '
                     'kaarditeenuste kasutustingimused“ (01.01.2025, geändert 16.06.2026)'},
 {'id': 'pt',
  'provider': 'Direção-Geral do Território (DGT), Portugal',
  'dataset': 'Ortofotos 25 cm - Portugal Continental - 2018 (Ortos 2018, RGB+NIR, GSD 0,25 m)',
  'dataset_url': 'https://snig.dgterritorio.gov.pt/rndg/srv/api/records/daf5479d-29c8-4e0c-b7b8-0e1791891186/formatters/snig-view',
  'license': 'CC BY 4.0',
  'license_url': 'https://creativecommons.org/licenses/by/4.0/',
  'commercial_video': 'true',
  'modification_notice_required': True,
  'onscreen_credit': 'Informação geográfica cedida pela Direção-Geral do Território',
  'service_terms_url': 'https://www.dgterritorio.gov.pt/dados-abertos',
  'service_limits': 'Keine veröffentlichten Rate-Limits, Caching-, Prefetch- oder Bulk-Download-Regeln '
                    'gefunden. WMTS-GetCapabilities: Fees „None“, AccessConstraints „This service is '
                    'public“; WMS-GetCapabilities: Fees „no conditions apply“, AccessConstraints „None“. Die '
                    'allgemeinen Website-Bedingungen der DGT (/Condicoes-de-utilizacao) verbieten nur '
                    'Handlungen, die die Integrität des Systems gefährden, und behalten sich Zugangsentzug '
                    'ohne Vorankündigung vor. Kein User-Agent-Erfordernis dokumentiert. Kontakt: '
                    'loja@dgterritorio.pt, +351 21 381 96 00 (Ansprechpartner laut WMTS: Danilo Furtado).',
  'confidence': 'hoch',
  'notes': 'Lizenz und Attributionsformel stehen wörtlich im offiziellen SNIG-Metadatensatz '
           '(useConstraints): „Licença de utilização - CC-BY-4.0 '
           '(https://creativecommons.org/licenses/by/4.0/) Sempre que o utilizador publique e/ou divulgue, '
           'por meio analógico ou digital, informação geográfica propriedade da Direção-Geral do Território, '
           'ainda que parcialmente adaptada, deverá atribuir créditos com inclusão do texto "Informação '
           'geográfica cedida pela Direção-Geral do Território"“. „Ainda que parcialmente adaptada“ = Credit '
           'auch bei bearbeiteter/abgeleiteter Nutzung (Video mit Track-Overlay) Pflicht; der '
           'Änderungshinweis folgt aus CC BY 4.0 §3(a)(1)(B) („indicate if You modified the Licensed '
           'Material“), DGT selbst schreibt keine Formel dafür vor. DGT-Seite „Dados abertos“: „A informação '
           'geográfica descarregada do Centro de Dados está sujeita a uma licença de utilização CC-BY 4.0, '
           'que permite a utilização livre e gratuita dos dados tendo apenas como obrigação a menção de que '
           'a entidade proprietária da informação é a Direção-Geral do Território.“ dados.gov.pt führt den '
           'Datensatz als „Creative Commons Attribution 4.0 - CC BY 4.0“. Empfohlene Einblendung: „Ortofotos '
           '2018 — Informação geográfica cedida pela Direção-Geral do Território (CC BY 4.0), bearbeitet“. '
           'Live-Endpunkte: WMS https://cartografia.dgterritorio.gov.pt/wms/ortos2018, WMTS '
           'https://cartografia.dgterritorio.gov.pt/ortos2018/service (Layer Ortos2018-RGB). Nutzungslimits '
           'nirgends publiziert — bei Prefetch/Bulk eigene Fair-Use-Grenzen setzen, im Zweifel '
           'loja@dgterritorio.pt fragen.',
  'sources': ['https://snig.dgterritorio.gov.pt/rndg/srv/api/records/daf5479d-29c8-4e0c-b7b8-0e1791891186/formatters/snig-view',
              'https://snig.dgterritorio.gov.pt/rndg/srv/api/records/daf5479d-29c8-4e0c-b7b8-0e1791891186/formatters/xml',
              'https://www.dgterritorio.gov.pt/dados-abertos',
              'https://www.dgterritorio.gov.pt/Ortofotos-2018-de-Portugal-continental',
              'https://www.dgterritorio.gov.pt/Condicoes-de-utilizacao',
              'https://dados.gov.pt/en/datasets/ortofotos-25-cm-portugal-continental-2018/',
              'https://ogcapi.dgterritorio.gov.pt/collections/ortos2018-rgb?f=html',
              'https://cartografia.dgterritorio.gov.pt/ortos2018/service?service=wmts&request=getcapabilities',
              'https://cartografia.dgterritorio.gov.pt/wms/ortos2018?service=wms&request=getcapabilities',
              'https://creativecommons.org/licenses/by/4.0/'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_kurz': 'DGT Portugal CC BY',
  'license_hinweis': 'Creative Commons Attribution 4.0 International (CC BY 4.0) — im SNIG-Metadatensatz als '
                     '„Licença de utilização - CC-BY-4.0“ geführt'},
 {'id': 'fr',
  'provider': "IGN — Institut national de l'information géographique et forestière (Géoplateforme / "
              'cartes.gouv.fr)',
  'dataset': 'BD ORTHO® (Orthophotographies IGN), WMTS-Layer ORTHOIMAGERY.ORTHOPHOTOS („Photographies '
             'aériennes“)',
  'dataset_url': 'https://cartes.gouv.fr/rechercher-une-donnee/dataset/IGNF_BD-ORTHO',
  'license': 'Licence Ouverte 2.0 (Etalab)',
  'license_url': 'https://www.data.gouv.fr/pages/legal/licences/etalab-2.0/',
  'commercial_video': 'true',
  'modification_notice_required': False,
  'onscreen_credit': '© IGN – BD ORTHO® (Géoplateforme, data.geopf.fr), Licence Ouverte 2.0',
  'service_terms_url': 'https://cartes.gouv.fr/cgu/',
  'service_limits': "CGU Art. 3.2 „Limite d'usage (Fair use)“ (Version 15.10.2024): „API Géoplateforme - "
                    "Diffusion d'images tuilées WMTS — Non soumis à limite d'usage“ (kein Rate-Limit); "
                    'WMS-Raster 40 requêtes/s pro IP; TMS 400/s; WFS 30/s; Téléchargement 5 requêtes/5 s mit '
                    '5-Minuten-Bann. Bei Überschreitung HTTP 429 für 5 s (Header retry-after), nur für die '
                    'betroffene API. Kein API-Key nötig (offene Endpunkte). Keine veröffentlichten Regeln zu '
                    'Caching, Prefetch, Bulk-Harvesting oder User-Agent; nur die allgemeine Pflicht „ne pas '
                    'nuire, entraver ou fausser le bon fonctionnement des API“. Kontakt: '
                    'geoplateforme@ign.fr, Formular https://cartes.gouv.fr/aide/fr/nous-ecrire, Tel. 01 43 '
                    '98 80 00.',
  'confidence': 'hoch',
  'notes': 'geoservices.ign.fr ist abgeschaltet (alle URLs leiten auf cartes.gouv.fr um). Lizenz: CGU „A '
           "défaut, la Licence Ouverte / Open Licence – Etalab s'applique sur ce jeu de données“; der "
           'CSW-Metadatensatz IGNF_BD-ORTHO (auf den der WMTS-Layer ORTHOIMAGERY.ORTHOPHOTOS per '
           'ows:Metadata verlinkt) nennt useConstraints „Licence Ouverte / Open License (compatible ODC-BY, '
           'CC-BY 2.0)“, useLimitation „Aucune contrainte“; data.gouv.fr führt BD ORTHO® unter „Licence '
           "Ouverte / Open Licence version 2.0“. LO 2.0 erlaubt wörtlich „de l'adapter, la modifier, "
           "l'extraire et la transformer“ und „de l'exploiter à titre commercial“; einzige Pflicht ist die "
           'Paternitätsnennung (Quelle + Datum), erfüllbar durch URL zum Datensatz. Ein Änderungshinweis ist '
           'NICHT vorgeschrieben; nur: „La « Réutilisation » ne doit pas induire en erreur des tiers quant '
           "au contenu de l'« Information », sa source et sa date de mise à jour.“ Eine IGN-eigene "
           'Wortformel existiert nicht; cartes.gouv.fr/mentions-legales nennt „© IGN“ als Standardnennung; '
           'das ältere geoportail.gouv.fr-Impressum (gilt nur für Screenshots des Géoportail-Viewers) '
           'verlangt „© IGN“ plus Jahr. Befliegungsdaten pro Gebiet: '
           'https://data.geopf.fr/annexes/ressources/fiches/photographies-aeriennes-RVB/geoportail_dates_des_prises_de_vues_aeriennes-RVB.pdf '
           '(aus dem Layer-Abstract). Partner-/ORTHO-HR-Frage: BD ORTHO® wird teils mit '
           'Regionen/Départements kofinanziert (Liste: '
           'https://data.geopf.fr/annexes/ressources/documentation/Partenariats_BDORTHO.pdf, Rev. 12/2025); '
           'der Produkt-Metadatensatz gibt trotzdem einheitlich Licence Ouverte an — eine abweichende Lizenz '
           'für Teile des Layers ist auf keiner offiziellen Seite belegt (nur Drittseiten-Hinweise zu '
           'ORTHO-HR-Editionen vor der Öffnung 2021). WMTS-GetCapabilities: Fees „none“, AccessConstraints '
           "„Conditions Générales d'Utilisation disponibles ici : https://cartes.gouv.fr/cgu“. Endpunkt: "
           'https://data.geopf.fr/wmts (Layer ORTHOIMAGERY.ORTHOPHOTOS, TileMatrixSet PM_0_19, image/jpeg).',
  'sources': ['https://cartes.gouv.fr/cgu/',
              'https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/limites-d-usage/',
              'https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/diffusion/wms-raster/',
              'https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/',
              'https://cartes.gouv.fr/aide/fr/',
              'https://cartes.gouv.fr/mentions-legales/',
              'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetCapabilities&VERSION=1.0.0',
              'https://data.geopf.fr/csw?REQUEST=GetRecordById&SERVICE=CSW&VERSION=2.0.2&OUTPUTSCHEMA=http://standards.iso.org/iso/19115/-3/mdb/2.0&elementSetName=full&ID=IGNF_BD-ORTHO',
              'https://data.geopf.fr/annexes/ressources/documentation/Partenariats_BDORTHO.pdf',
              'https://www.data.gouv.fr/datasets/bd-ortho-r',
              'https://www.data.gouv.fr/pages/legal/licences/etalab-2.0/',
              'https://github.com/etalab/licence-ouverte/blob/master/LO.md',
              'https://www.geoportail.gouv.fr/pages/mentions-legales'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_hinweis': '© IGN – BD ORTHO® (Géoplateforme, data.geopf.fr), <Datum der letzten '
                    'Aktualisierung/Befliegung> — LO 2.0 verlangt wörtlich nur: „mentionner la paternité de '
                    "l'« Information » : sa source (a minima le nom du « Concédant ») et la date de la "
                    'dernière mise à jour“',
  'credit_kurz': '© IGN France',
  'license_hinweis': 'Licence Ouverte / Open Licence 2.0 (Etalab) — im offiziellen Metadatensatz '
                     'IGNF_BD-ORTHO als „Licence Ouverte / Open License (compatible ODC-BY, CC-BY 2.0)“'},
 {'id': 'es',
  'provider': 'Instituto Geográfico Nacional (IGN) / Centro Nacional de Información Geográfica (CNIG), '
              'España — Sistema Cartográfico Nacional (SCNE)',
  'dataset': 'PNOA — Plan Nacional de Ortofotografía Aérea, Ortofotos PNOA máxima actualidad (WMS/WMTS '
             'pnoa-ma, Layer OI.OrthoimageCoverage)',
  'dataset_url': 'https://pnoa.ign.es/pnoa-imagen/visualizadores-y-servicios-web',
  'license': 'CC BY 4.0 (Licencia CNIG)',
  'license_url': 'https://www.ign.es/resources/licencia/Condiciones_licenciaUso_IGN.pdf',
  'commercial_video': 'true',
  'modification_notice_required': True,
  'onscreen_credit': 'Obra derivada de PNOA CC-BY 4.0 scne.es',
  'service_terms_url': 'https://www.ign.es/resources/licencia/Condiciones_licenciaUso_IGN.pdf',
  'service_limits': 'Keine offiziellen Rate-Limits, Caching-, Prefetch- oder Bulk-Download-Regeln für '
                    'www.ign.es/wms-inspire/pnoa-ma gefunden. WMS-GetCapabilities: Fees „No se aplican '
                    'condiciones“, AccessConstraints „CC BY 4.0 scne.es“, Attribution „Sistema Cartográfico '
                    'Nacional“ (https://www.scne.es); Kontakt ign@transportes.gob.es (IDEE), Lizenzfragen '
                    'consulta@cnig.es. Die Lizenz verlangt, den Credit „visible junto con los datos, de '
                    'forma legible y a pie de mapa, imagen, presentación o ventana de visualización“ zu '
                    'zeigen. Das „nur keine Massendownloads“-Verbot aus der Suche stammt von '
                    'Ministeriums-WMS (mapa.gob.es/miteco), nicht vom IGN — für das IGN nicht belegt.',
  'confidence': 'hoch',
  'notes': 'Lizenztext (PDF, CNIG): Nutzung frei und kostenlos „siempre que se mencione el origen y '
           'propiedad de los datos“; Formel für unveränderte Produkte „«<identificador del producto> <fecha> '
           'CC-BY 4.0 <atribución de productores>»“, Kurzform „«CC-BY 4.0 <atribución productores> <fecha>»“ '
           '(z. B. „CC-BY 4.0 scne.es 2010“); für abgeleitete Werke Pflichtpräfix „Obra derivada de“ (Punkt '
           '4) — ein Video mit Track-Overlay ist eine obra derivada, also Änderungshinweis Pflicht. Für '
           'Dienste (Punkt 2) gilt die Formel der gekoppelten Daten bzw. der <AccessConstraints> des '
           'Dienstes: bei pnoa-ma „CC BY 4.0 scne.es“. Produkttabelle scne.es/tablaProductos.php: '
           'Identificador „PNOA“, Reconocimiento „PNOA 2025 CC-BY 4.0 scne.es“ (pro Jahr), Atribución '
           '„scne.es“ / „Sistema Cartográfico Nacional“ / Produzentenliste; eine eigene Zeile „máxima '
           'actualidad“ gibt es nicht — der pnoa-ma-Mosaik mischt Jahrgänge, daher praktikabel: „Obra '
           'derivada de PNOA CC-BY 4.0 scne.es“ oder Jahresspanne. Die Formulierung „PNOA cedido por © '
           'Instituto Geográfico Nacional de España“ taucht nur auf ArcGIS-/Drittseiten auf, nicht auf '
           'ign.es/pnoa.ign.es — Altformel, nicht mehr verwenden. Melilla-Ortho im pnoa-ma ist „Pléiades Neo '
           '© Airbus DS (2022)“ (laut WMS-Abstract) — dort ggf. gesonderte Rechte. Hintergrundbilder '
           '<1:70.000 sind Sentinel-2 (Copernicus). ign.es/aviso-legal und politica-datos bestätigen nur die '
           'Orden FOM/2807/2015 + „licencia de uso, compatible con CC-BY 4.0“. Endpunkte: WMS '
           'https://www.ign.es/wms-inspire/pnoa-ma, WMTS https://www.ign.es/wmts/pnoa-ma (JPEG, bis Zoom 19, '
           'EPSG:3857 laut pnoa.ign.es).',
  'sources': ['https://www.ign.es/resources/licencia/Condiciones_licenciaUso_IGN.pdf',
              'https://www.scne.es/productos.php',
              'https://www.scne.es/tablaProductos.php',
              'https://centrodedescargas.cnig.es/CentroDescargas/politica-datos?codAgr=MPRAU&codSerie=02309',
              'https://centrodedescargas.cnig.es/CentroDescargas/ortofoto-pnoa-maxima-actualidad',
              'https://www.ign.es/web/ign/portal/politica-datos',
              'https://www.ign.es/web/ign/portal/info-aviso-legal',
              'https://www.ign.es/web/ide-servicios-web',
              'https://pnoa.ign.es/',
              'https://pnoa.ign.es/pnoa-imagen/visualizadores-y-servicios-web',
              'https://pnoa.ign.es/aviso-legal',
              'https://www.ign.es/wms-inspire/pnoa-ma?Request=GetCapabilities&Service=WMS',
              'https://www.ign.es/wms-inspire/pnoa-ma?Request=GetCapabilities&Service=WMTS'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_hinweis': 'Obra derivada de PNOA <año> CC-BY 4.0 scne.es (Beispiel aus der Lizenz: „Obra derivada '
                    'de PNOA 2010-2013 CC-BY scne.es“); unverändertes Produkt: „PNOA <año> CC-BY 4.0 '
                    'scne.es“; Dienst-Formel laut WMS-AccessConstraints: „CC BY 4.0 scne.es“',
  'credit_kurz': 'PNOA CC-BY scne.es',
  'license_hinweis': 'Licencia de uso de los productos y servicios de datos geográficos del IGN (Orden '
                     'FOM/2807/2015), „compatible con CC-BY 4.0“ — Nutzung „conlleva la aceptación por el '
                     'usuario de una licencia CC-BY 4.0“'},
 {'id': 'it',
  'provider': "Geoportale Nazionale – Ministero dell'Ambiente e della Sicurezza Energetica (MASE, ex "
              'MATTM/MiTE); Bilddaten: AGEA (Agenzia per le Erogazioni in Agricoltura)',
  'dataset': 'Ortofoto a colori anno 2012 (Ortofoto a colori AGEA periodo 2009-2012, 50 cm/px) – WMS-Layer '
             'OI.ORTOIMMAGINI.2012',
  'dataset_url': 'http://www.pcn.minambiente.it/geoportal/catalog/search/resource/details.page?uuid=m_amte:299FN3:af07a814-4026-4b80-8ecb-818229991856',
  'license': 'unbekannt (keine CC-Lizenz, Freigabe offen)',
  'license_url': 'https://gn.mase.gov.it/portale/faq',
  'commercial_video': 'unknown',
  'modification_notice_required': False,
  'onscreen_credit': 'Ortofoto AGEA 2012 – Geoportale Nazionale (MASE), gn.mase.gov.it',
  'service_terms_url': 'https://gn.mase.gov.it/portale/note-legali',
  'service_limits': 'WMS 1.3.0 (MapServer) läuft am 2026-09-07 weiter unter wms.pcn.minambiente.it '
                    '(HTTPS-Aufruf wird per 301 auf HTTP umgeleitet; GetMap 256x256 JPEG in EPSG:3857 ok). '
                    'MaxWidth/MaxHeight 2048 px; Abstract: „Il servizio è visualizzabile solo a scale '
                    'superiori a 1:100.000“. Kein WMTS/Tile-Cache. Keine veröffentlichten Rate-Limits, '
                    'Caching-/Prefetch-/User-Agent-Regeln; Bulk-Download nicht vorgesehen (nur Live-WMS; der '
                    'GN-Download-Dienst gilt laut Note legali für CC-BY-4.0-Daten, nicht für Ortofoto). '
                    'Kontakt: gn@mase.gov.it (Geoportale Nazionale, Via Cristoforo Colombo 44, 00147 Roma).',
  'confidence': 'niedrig',
  'notes': 'Portal ist von pcn.minambiente.it nach gn.mase.gov.it migriert (alte Seiten /mattm/… leiten auf '
           'gn.mase.gov.it/portale/home um); der alte Esri-Geoportal-Katalog (pcn.minambiente.it/geoportal, '
           'Branding „Geoportale MiTE“) und der WMS-Host laufen aber weiter. Note legali: Download-Daten CC '
           'BY 4.0, Geodaten „realizzati ai soli fini dei loro utilizzi istituzionali“, Lizenzen „riportate '
           'nella sezione corrispondente del metadato“ – im Metadato der Ortofoto steht nur „Citare sempre '
           'la fonte del servizio“. FAQ nimmt Ortofoto ausdrücklich von CC BY 4.0 aus, nennt aber keine '
           'Ersatzlizenz. Der Satz „utilizzabili solo per la visualizzazione … vietata ogni riproduzione“ '
           'für AGEA-Ortofoto 2012/2015 stammt von Regione Veneto (idt2.regione.veneto.it), nicht von MASE. '
           'Rechteinhaber der Bilder ist AGEA; AGEA hat am 26.08.2026 sein eigenes Geoportal (Ortofoto '
           '2022–2024, 20 cm) auf CC BY 4.0 gestellt (Attribution „AGEA“, Änderungen kennzeichnen, max. 20 '
           'Bilder/Request, kein WMS/WMTS) – gilt NICHT automatisch für die 2012er MASE-WMS. Empfehlung: '
           'kommerzielle Nutzung in monetarisierten Videos vor Einsatz schriftlich bei gn@mase.gov.it (ggf. '
           'AGEA) klären oder den Layer als „Lizenz unklar / nur mit Freigabe“ kennzeichnen. '
           'modification_notice_required=false heißt hier: nicht verifizierbar, keine offizielle Vorgabe '
           'gefunden.',
  'sources': ['https://gn.mase.gov.it/portale/faq',
              'https://gn.mase.gov.it/portale/note-legali',
              'https://gn.mase.gov.it/portale/en/legal-notices',
              'https://gn.mase.gov.it/portale/en/',
              'https://gn.mase.gov.it/portale/en/website-description',
              'https://gn.mase.gov.it/portale/en/network-services-ocg',
              'https://gn.mase.gov.it/portale/en/consultation-service-wms',
              'https://gn.mase.gov.it/portale/servizio-di-consultazione-wms',
              'https://gn.mase.gov.it/portale/servizio-di-ricerca-csw',
              'https://gn.mase.gov.it/portale/en/metadata-catalog',
              'https://www.mase.gov.it/portale/geoportale-nazionale',
              'https://wms.pcn.minambiente.it/ogc?map=/ms_ogc/WMS_v1.3/raster/ortofoto_colore_12.map&SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0',
              'http://www.pcn.minambiente.it/geoportal/catalog/search/resource/details.page?uuid=m_amte:299FN3:af07a814-4026-4b80-8ecb-818229991856',
              'http://www.pcn.minambiente.it/geoportal/catalog/search/resource/details.page?uuid=m_amte:299FN3:0cf65452-2c51-49d7-b57b-a5871f108335',
              'http://www.pcn.minambiente.it/geoportal/catalog/content/disclaimer.page',
              'http://www.pcn.minambiente.it/geoportal/rest/find/document?searchText=ortofoto%202012&f=json',
              'https://geodati.gov.it/RNDT/csw?service=CSW&version=2.0.2&request=GetRecordById&id=m_amte:299FN3:af07a814-4026-4b80-8ecb-818229991856&outputSchema=http://www.isotc211.org/2005/gmd&elementSetName=full',
              'https://geodati.gov.it/RNDT/csw?service=CSW&version=2.0.2&request=GetRecordById&id=m_amte:299FN3:80437fc1-bbed-41f9-84dc-ee091b9080e4&outputSchema=http://www.isotc211.org/2005/gmd&elementSetName=full',
              'https://www.alspergis.altervista.org/data/ortofoto_pcn.html',
              'https://idt2.regione.veneto.it/condizioni_utilizzo_geoportale/',
              'https://www.geocorsi.it/N1787/geoportale-agea-online-il-nuovo-servizio-per-consultare-e-scaricare-le-ortofoto-nazionali.html',
              'https://www.gisinfrastrutture.it/2026/07/scarica-le-ortofoto-agea-dal-nuovo-geoportale/',
              'https://garr8.altervista.org/gis/geoportale-nazionale-disponibili-le-ortofoto-agea-2009-2012/',
              'https://lists.openstreetmap.org/pipermail/talk-it/2014-February/041843.html'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_hinweis': 'Keine wörtliche Formel vorgeschrieben. Einzige offizielle Vorgabe: „Citare sempre la '
                    'fonte del servizio.“ (Metadaten). Empfohlene Umsetzung analog zur '
                    "WMS-ContactOrganization „Geoportale Nazionale - Ministero dell'Ambiente e della "
                    'Sicurezza Energetica“: IT „Ortofoto AGEA 2012 – Geoportale Nazionale, Ministero '
                    "dell'Ambiente e della Sicurezza Energetica (gn.mase.gov.it)“ / EN „Orthophoto AGEA 2012 "
                    '– Italian National Geoportal, Ministry of the Environment and Energy Security '
                    '(gn.mase.gov.it)“',
  'credit_kurz': 'Ortofoto AGEA/MASE',
  'license_hinweis': 'unknown – KEINE Creative-Commons-Lizenz für die Ortofoto verifizierbar. GN-FAQ: „Tutti '
                     'i dati del Geoportale nazionale, ad eccezione delle ortofoto, sono dati pubblici e '
                     'sono distribuiti con Licenza Creative Commons Attribuzione 4.0 Internazionale.“ '
                     'Metadaten (RNDT/PCN, Service-Record, Stand 2014-02-26): Vincoli di fruibilità/Altri '
                     'vincoli = „Questo servizio è ad accesso pubblico. Citare sempre la fonte del '
                     'servizio.“; Vincoli di accesso = „Nessuna Limitazione al Pubblico Accesso“. '
                     'WMS-GetCapabilities: Fees = „Nessuna condizione applicata“, AccessConstraints = '
                     '„Nessuno“. Die in Sekundärquellen (alsperGIS 2016, OSM talk-it) genannte CC BY-NC-ND '
                     '3.0 IT ist auf keiner heutigen offiziellen Seite mehr auffindbar; CC BY 3.0 IT / IODL '
                     '2.0 nirgends belegt.'},
 {'id': 'pl',
  'provider': 'Główny Urząd Geodezji i Kartografii (GUGiK) / Główny Geodeta Kraju – Geoportal.gov.pl',
  'dataset': 'ORTOFOTOMAPA (Ortofotomapa klasyczna, państwowy zasób geodezyjny i kartograficzny – PZGiK); '
             'WMTS „Usługa przeglądania ortofotomap dla obszaru Polski. Profil kafelkowany (WMTS)“, Layer '
             'ORTOFOTOMAPA – Endpoint '
             'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution',
  'dataset_url': 'https://www.geoportal.gov.pl/dane/ortofotomapa',
  'license': 'CC BY 4.0',
  'license_url': 'https://dane.gov.pl/pl/dataset/2026,ortofotomapa',
  'commercial_video': 'true',
  'modification_notice_required': True,
  'onscreen_credit': 'Źródło: GUGiK, geoportal.gov.pl (CC BY 4.0) – opracowano na podstawie materiałów PZGiK',
  'service_terms_url': 'https://www.geoportal.gov.pl/pl/o-geoportalu/regulamin/',
  'service_limits': 'WMTS 1.0.0 GetCapabilities: Fees = „Korzystanie z usługi danych przestrzennych oznacza '
                    'akceptację bez ograniczeń i zastrzeżeń Regulaminu dostępnego na stronie internetowej '
                    'Geoportalu http://www.geoportal.gov.pl/“, AccessConstraints = „brak ograniczeń“. Keine '
                    'veröffentlichten Rate-Limits, Caching- oder User-Agent-Regeln; Regulamin (gültig ab '
                    '08.07.2024) enthält keine Klausel zu Massen-Download. Beim Schwester-WMTS (TOPO) '
                    'derselben Plattform steht ausdrücklich: „Wykorzystanie usługi nie podlega żadnym '
                    'ograniczeniom z wyłączeniem automatycznego pobierania i kolekcjonowania obrazów lub '
                    'informacji opisowych pobieranych funkcją GetFeatureInfo (tzw. harvesting).“ – '
                    'Tile-Harvesting also nicht gewollt; für Bulk die kostenlosen Download-Dienste nutzen '
                    '(WCS max. 7 km² pro Abruf, Kachel-Download über geoportal.gov.pl/dane/ortofotomapa). '
                    'Kontakt: geoportal@geoportal.gov.pl (Dział Geoportalu); Technik '
                    'sigservicedesk@geoportal.gov.pl, +48 58 773 79 91 (24/7).',
  'confidence': 'hoch',
  'notes': 'Seit der Novelle des Prawa geodezyjnego i kartograficznego (31.07.2020) ist die Ortofotomapa als '
           'offene Daten kostenlos und „bez ograniczeń“ nutzbar (gov.pl/gugik: „Materiały centralnego zasobu '
           'geodezyjnego i kartograficznego udostępniane nieodpłatnie bez konieczności składania wniosku“; '
           'geoportal.gov.pl/dane/ortofotomapa: „dostępna bezpłatnie do pobrania i możliwa do dowolnego '
           'wykorzystania“). Kommerzielle Nutzung, Bearbeitung und Veröffentlichung in monetarisierten '
           'Videos zulässig; Pflicht ist der PZGiK-Vermerk bzw. die Quellenangabe. Zwei Ebenen: dane.gov.pl '
           'nennt CC BY 4.0 (daraus folgt formal der Änderungshinweis, daher '
           'modification_notice_required=true), der Regulamin verlangt nur „informacja o źródle pochodzenia“ '
           '– PZGiK-Vermerk + „Źródło: geoportal.gov.pl / GUGiK“ deckt beides ab. Die ORTO-WMTS-Capabilities '
           'nennen selbst keine Harvesting-Klausel, das TOPO-WMTS schon – Live-Tile-Rendering im Video '
           'unproblematisch, systematisches Kachel-Abgrasen vermeiden. Weitere Endpoints: WMS '
           'StandardResolution, WMTS/WMS HighResolution, WMS StandardResolutionTime (Archiv), WMS TrueOrtho.',
  'sources': ['https://www.geoportal.gov.pl/pl/o-geoportalu/regulamin/',
              'https://www.geoportal.gov.pl/pl/regulamin/',
              'https://www.geoportal.gov.pl/uslugi/-/asset_publisher/Pp7hdZCC2h89/content/regulamin',
              'https://www.geoportal.gov.pl/en/about-geoportal/terms-and-conditions/',
              'https://www.geoportal.gov.pl/dane/ortofotomapa',
              'https://www.geoportal.gov.pl/pl/uslugi/uslugi-przegladania-wms-i-wmts/',
              'https://www.geoportal.gov.pl/en/services/view-services-wms-and-wmts/',
              'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution?SERVICE=WMTS&REQUEST=GetCapabilities',
              'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution?SERVICE=WMS&REQUEST=GetCapabilities',
              'https://mapy.geoportal.gov.pl/wss/service/WMTS/guest/wmts/TOPO?SERVICE=WMTS&REQUEST=getcapabilities',
              'https://api.dane.gov.pl/1.4/datasets/2026',
              'https://api.dane.gov.pl/1.4/resources/26793',
              'https://dane.gov.pl/pl/dataset/2026,ortofotomapa',
              'https://www.gov.pl/web/gugik/dane-udostepniane-bez-platnie-do-pobrania-z-serwisu-wwwgeoportalgovpl',
              'https://www.gov.pl/web/gugik/dane-pzgik2',
              'https://arslege.pl/udostepnianie-materialow-panstwowego-zasobu-geodezyjnego-i-kartograficznego/k103/a12924/',
              'https://community.openstreetmap.org/t/regulamin-geoportalu-a-ustawy/60542/121'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_hinweis': 'PL (Pflichtvermerk laut dane.gov.pl/GUGiK): „Wykorzystano/opracowano na podstawie '
                    'materiałów państwowego zasobu geodezyjnego i kartograficznego“ – plus Quellenangabe '
                    'nach Regulamin § 3 ust. 2 („Publikacja materiałów z Serwisu jest dozwolona pod '
                    'warunkiem umieszczenia informacji o źródle pochodzenia.“), z. B. „Źródło: Ortofotomapa '
                    '– Główny Urząd Geodezji i Kartografii, geoportal.gov.pl“. EN (eigene Übersetzung, keine '
                    'offizielle Formel): „Based on materials of the Polish state geodetic and cartographic '
                    'resource (PZGiK) – GUGiK, geoportal.gov.pl“',
  'credit_kurz': 'GUGiK geoportal.gov.pl',
  'license_hinweis': 'CC BY 4.0 (dane.gov.pl-Datensatz „Ortofotomapa klasyczna prawdziwa ukośna“, '
                     'Herausgeber GUGiK) auf gesetzlicher Basis Art. 40a ust. 2 pkt 1 lit. e Prawo '
                     'geodezyjne i kartograficzne („Nie pobiera się opłaty za: 1) udostępnianie zbiorów '
                     'danych: … e) ortofotomapy“). dane.gov.pl: „Na podstawie ustawy Prawo geodezyjne i '
                     'kartograficzne zbiór stanowi materiał państwowego zasobu geodezyjnego i '
                     'kartograficznego (PZGiK) i może być wykorzystywany bez ograniczeń.“ Regulamin '
                     'Geoportalu § 3 ust. 1: „Informacje publikowane w Serwisie zgodnie z art. 4 ust. 2 '
                     'ustawy z dnia 4 lutego 1994 r. o prawie autorskim i prawach pokrewnych (Dz. U. z 2022 '
                     'r. poz. 2509) nie podlegają ochronie przewidzianej ww. ustawą.“'},
 {'id': 'jp',
  'provider': '国土地理院 (GSI Japan)',
  'dataset': '地理院タイル 全国最新写真（シームレス） seamlessphoto',
  'dataset_url': 'https://maps.gsi.go.jp/development/ichiran.html',
  'license': 'GSI Terms (PDL 1.0, CC BY 4.0-kompatibel)',
  'license_url': 'https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html',
  'commercial_video': 'true',
  'modification_notice_required': True,
  'onscreen_credit': '地理院タイル（国土地理院）を加工して作成 / Source: GSI Japan, modified',
  'service_terms_url': 'https://maps.gsi.go.jp/development/ichiran.html',
  'service_limits': 'Keine offizielle Rate-Limit-, Cache- oder Prefetch-Regel gefunden; Tiles sind ohne '
                    'Antrag nutzbar (『出典を記載いただくことで、申請なくご利用いただけます』). GSI stellt sogar mokuroku.csv.gz je '
                    'Tile-Set für effiziente Synchronisation/Massen-Download bereit. '
                    'Frame-by-frame-Headless-Rendering vom öffentlichen Server: nicht ausdrücklich geregelt, '
                    'nach Datenlage akzeptabel (kein Verbot, Bulk-Sync vorgesehen).',
  'confidence': 'hoch',
  'notes': 'Tile-Kategorie 2 (nur Quellenangabe nötig). Seamlessphoto enthält Landsat-8- und '
           'Axelspace-GRUS-Anteile mit Zusatz-Credit. Bearbeitete Inhalte dürfen nicht so wirken, als '
           'stammten sie vom GSI. 『地理院タイル』 ist eingetragene Marke.',
  'sources': ['https://maps.gsi.go.jp/development/ichiran.html',
              'https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html',
              'https://www.gsi.go.jp/ENGLISH/page_e30286.html',
              'https://maps.gsi.go.jp/development/siyou.html',
              'https://www.digital.go.jp/resources/open_data/public_data_license_v1.0',
              'https://www.gsi.go.jp/common/000106650.pdf'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_hinweis': '地理院タイル（国土地理院） https://maps.gsi.go.jp/development/ichiran.html — bei bearbeiteten '
                    'Inhalten zusätzlich: 「全国最新写真（シームレス）」（国土地理院）を加工して作成 / engl.: Source: GSI website (URL); '
                    'bei Axelspace-Anteilen zusätzlich: GRUS画像（© Axelspace）',
  'credit_kurz': '地理院タイル (GSI)',
  'license_hinweis': 'Public Data License v1.0 (PDL1.0, 国土地理院コンテンツ利用規約; CC BY 4.0-kompatibel)'},
 {'id': 'us',
  'provider': 'USGS National Geospatial Program (The National Map)',
  'dataset': 'USGSImageryOnly (NAIP 1 m, Blue Marble/Landsat klein\xadmaßstäbig, Alaska SPOT 10 m)',
  'dataset_url': 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer',
  'license': 'US Public Domain',
  'license_url': 'https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map',
  'commercial_video': 'true',
  'modification_notice_required': False,
  'onscreen_credit': 'USDA, USGS The National Map: Orthoimagery (public domain)',
  'service_terms_url': 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits',
  'service_limits': 'Keine veröffentlichte Rate-Limit-, Cache- oder Bulk-Regel gefunden; Service-Metadaten '
                    'nennen nur MaxRecordCount 1000. Hilfe: TNM_Help@USGS.gov. '
                    'Frame-by-frame-Headless-Rendering: nicht geregelt, keine Einschränkung erkennbar '
                    '(Public Domain, Download ausdrücklich frei); Alaska-SPOT-Imagery ist nur im Service, '
                    'nicht als Download lizenziert.',
  'confidence': 'hoch',
  'notes': "Credit-Formel wird 'erbeten', nicht rechtlich erzwungen. Kommerzielle Nutzung nicht "
           'eingeschränkt, keine Modified-Pflicht.',
  'sources': ['https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map',
              'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits',
              'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer',
              'https://www.usgs.gov/programs/national-geospatial-program/national-map'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_hinweis': 'Map services and data available from U.S. Geological Survey, National Geospatial '
                    "Program. (Service-Copyright-Feld: 'USDA, USGS The National Map: Orthoimagery')",
  'credit_kurz': 'USGS',
  'license_hinweis': "U.S. Public Domain (USGS Copyrights and Credits; The National Map: 'free and in the "
                     "public domain. There are no restrictions.')"},
 {'id': 'sentinel',
  'provider': 'EOX IT Services GmbH (EOX::Maps / EOxCloudless)',
  'dataset': 'Sentinel-2 cloudless 2016 (Layer s2cloudless_3857 = s2cloudless-2016_3857)',
  'dataset_url': 'https://cloudless.eox.at/',
  'license': 'CC BY 4.0 (Jahrgang 2016)',
  'license_url': 'https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml',
  'commercial_video': 'true',
  'modification_notice_required': True,
  'onscreen_credit': 'EOxCloudless by EOX IT Services GmbH (Contains modified Copernicus Sentinel data '
                     '2016), CC BY 4.0',
  'service_terms_url': 'https://maps.eox.at/',
  'service_limits': 'EOX wendet wegen hoher Last Rate-Limiting an (HTTP-Fehler möglich); AccessConstraints: '
                    "'Proper attribution is required for any usage'. Keine Cache-/Prefetch-Regel "
                    'veröffentlicht; für Offline-Karten, eigene Projektionen oder SLA-Dienst auf '
                    'office@eox.at bzw. cloudless@eox.at verweisen (kostenpflichtig). '
                    'Frame-by-frame-Headless-Rendering vom Free-Server: nicht verboten, aber wegen '
                    'Rate-Limits nur mit lokalem Cache und moderat; für Dauerlast ist der '
                    'bezahlte/dedizierte Dienst vorgesehen.',
  'confidence': 'hoch',
  'notes': 'Wichtig: Der 2016-Layer wird in den Capabilities aktuell als CC BY 4.0 ausgewiesen (nicht CC '
           "BY-SA, wie in der Aufgabe angenommen). Nur 2016 ist kommerziell frei; 2017+ NC. 'Contains "
           "modified Copernicus Sentinel data' erfüllt die Modified-Pflicht.",
  'sources': ['https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml',
              'https://tiles.maps.eox.at/wms?service=wms&request=getcapabilities',
              'https://maps.eox.at/',
              'https://cloudless.eox.at/',
              'https://cloudless.eox.at/documentation/license',
              'https://cloudless.eox.at/documentation/usage'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_hinweis': 'EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified '
                    'Copernicus Sentinel data 2016) — plus Service-Vorgabe: Attribution wie in der '
                    "Demo-Karte unten rechts, z. B. 'Terrain { Data © OpenStreetMap contributers and others, "
                    "Rendering © EOX }' mit Links auf openstreetmap.org/copyright, maps.eox.at/#data, eox.at",
  'credit_kurz': 'EOX Sentinel-2 CC BY',
  'license_hinweis': '2016-Layer: Creative Commons Attribution 4.0 International (CC BY 4.0) laut '
                     'WMTS-Capabilities (nicht mehr CC BY-SA); Jahrgänge 2017–2025: CC BY-NC-SA 4.0, '
                     "kommerziell nur mit 'EOX Commercial Attribution-RestrictedUse 1.2 License'"},
 {'id': 'bluemarble',
  'provider': 'NASA GIBS / ESDIS (Earth Observatory Blue Marble Next Generation)',
  'dataset': 'BlueMarble_ShadedRelief_Bathymetry (WMTS epsg3857/best, EPSG3857_500m)',
  'dataset_url': 'https://www.earthdata.nasa.gov/data/tools/global-imagery-browse-services-gibs',
  'license': 'gemeinfrei (NASA)',
  'license_url': 'https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance',
  'commercial_video': 'true',
  'modification_notice_required': False,
  'onscreen_credit': 'Hintergrund: NASA Blue Marble (GIBS)',
  'service_terms_url': 'https://nasa-gibs.github.io/gibs-api-docs/',
  'service_limits': 'Keine Rate-Limits, Cache- oder Bulk-Regeln in den GIBS-API-Docs veröffentlicht; '
                    'Acknowledgement wird verlangt; Kontakt earthdata-support@nasa.gov. Keine '
                    'NASA-Endorsement-Andeutung, keine NFT/KI-Nutzung. Frame-by-frame-Headless-Rendering: '
                    'nicht geregelt, nach Datenlage akzeptabel (offener Dienst, statischer Layer).',
  'confidence': 'mittel',
  'notes': 'Layer-spezifische Seite (GIBS-Wiki) nur mit Earthdata-Login erreichbar; Katalogseite lud '
           "fehlerhaft. Blue-Marble-Credit laut Earth Observatory: 'Imagery by Jesse Allen, NASA's Earth "
           "Observatory, using data from GEBCO (BODC)'. GEBCO-Nutzungsbedingungen nicht separat geprüft.",
  'sources': ['https://nasa-gibs.github.io/gibs-api-docs/',
              'https://nasa-gibs.github.io/gibs-api-docs/access-basics/',
              'https://www.earthdata.nasa.gov/engage/open-data-services-software-policies',
              'https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance',
              'https://www.nasa.gov/nasa-brand-center/images-and-media/',
              'https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/topography-bathymetry-maps/'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_hinweis': "We acknowledge the use of imagery provided by services from NASA's Global Imagery "
                    "Browse Services (GIBS), part of NASA's Earth Science Data and Information System "
                    '(ESDIS). (Kurzform empfohlen: NASA GIBS / NASA Earth Observatory Blue Marble; '
                    'Bathymetrie: GEBCO, British Oceanographic Data Centre)',
  'credit_kurz': 'NASA Blue Marble',
  'license_hinweis': 'NASA Earthdata: nicht urheberrechtlich geschützt, Daten NASA-geführter Missionen als '
                     'Creative Commons Zero (CC0) lizenziert; Earth Observatory-Bilder frei auch kommerziell '
                     'nutzbar'},
 {'id': 'terrain',
  'provider': 'Mapzen/Tilezen (Linux Foundation) auf AWS Open Data (Registry of Open Data on AWS)',
  'dataset': 'Terrain Tiles (terrarium PNG, Bucket elevation-tiles-prod)',
  'dataset_url': 'https://registry.opendata.aws/terrain-tiles/',
  'license': 'Mix gemeinfrei / CC BY / OGL (Mapzen Terrain Tiles)',
  'license_url': 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
  'commercial_video': 'true',
  'modification_notice_required': False,
  'onscreen_credit': 'Gelände: Mapzen/AWS Terrain Tiles',
  'service_terms_url': 'https://registry.opendata.aws/terrain-tiles/',
  'service_limits': 'Offener S3-Bucket ohne AWS-Konto (--no-sign-request), EU-Replikat '
                    'elevation-tiles-prod-eu; keine Rate-Limits, Cache- oder Prefetch-Regeln veröffentlicht, '
                    'Bulk-Zugriff ist Zweck des Open-Data-Angebots. Frame-by-frame-Headless-Rendering und '
                    'lokaler Cache: akzeptabel. Fragen via GitHub Issues (tilezen/joerd).',
  'confidence': 'hoch',
  'notes': "Vollständiger Attribution-Text ist lang — kann in Video-Beschreibung, im Bild kurz 'Terrain: "
           "Mapzen/Tilezen Terrain Tiles (USGS, NOAA, Copernicus u. a.)'. Der alte tile.mapzen.com-Dienst "
           'mit API-Key existiert nicht mehr (Doku veraltet).',
  'sources': ['https://registry.opendata.aws/terrain-tiles/',
              'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
              'https://github.com/tilezen/joerd/blob/master/docs/use-service.md',
              'https://github.com/tilezen/joerd/blob/master/docs/data-sources.md'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_hinweis': 'ArcticDEM terrain data DEM(s) were created from DigitalGlobe, Inc., imagery and funded '
                    'under National Science Foundation awards 1043681, 1559691, and 1542736; Australia '
                    'terrain data © Commonwealth of Australia (Geoscience Australia) 2017; Austria terrain '
                    'data © offene Daten Österreichs – Digitales Geländemodell (DGM) Österreich; Canada '
                    'terrain data contains information licensed under the Open Government Licence – Canada; '
                    'Europe terrain data produced using Copernicus data and information funded by the '
                    'European Union - EU-DEM layers; Global ETOPO1 terrain data U.S. National Oceanic and '
                    'Atmospheric Administration; Mexico terrain data source: INEGI, Continental relief, '
                    '2016; New Zealand terrain data Copyright 2011 Crown copyright (c) Land Information New '
                    'Zealand and the New Zealand Government (All rights reserved); Norway terrain data © '
                    'Kartverket; United Kingdom terrain data © Environment Agency copyright and/or database '
                    'right 2015. All rights reserved; United States 3DEP (formerly NED) and global GMTED2010 '
                    "and SRTM terrain data courtesy of the U.S. Geological Survey. (Registry-Zitat: 'Terrain "
                    "Tiles was accessed on DATE from https://registry.opendata.aws/terrain-tiles.')",
  'credit_kurz': 'Mapzen/AWS Terrain',
  'license_hinweis': 'Kein Gesamt-Lizenzname; Mischung aus Public Domain (USGS 3DEP/SRTM/GMTED2010, NOAA '
                     'ETOPO1), CC BY 3.0 NZ (LINZ), CC BY 3.0 AT (Österreich), CC BY 4.0 (Kartverket, '
                     'Geoscience Australia), OGL v3 (UK), OGL Canada, Copernicus EU-DEM, INEGI, ArcticDEM '
                     "'unlicensed' — Attribution pro Quelle Pflicht (tilezen/joerd attribution.md)"},
 {'id': 'openfreemap',
  'provider': 'OpenFreeMap (Zsolt Ero) — Daten OpenStreetMap, Schema OpenMapTiles',
  'dataset': 'OpenFreeMap Vector Tiles (OpenMapTiles-Schema, OSM-Daten)',
  'dataset_url': 'https://openfreemap.org/',
  'license': 'ODbL + OpenMapTiles CC BY 4.0',
  'license_url': 'https://github.com/openmaptiles/openmaptiles/blob/master/LICENSE.md',
  'commercial_video': 'true',
  'modification_notice_required': False,
  'onscreen_credit': '© OpenMapTiles © OpenStreetMap contributors (OpenFreeMap)',
  'service_terms_url': 'https://openfreemap.org/',
  'service_limits': "'No limits on the number of map views or requests', keine Registrierung/API-Key, "
                    "kommerzielle Nutzung ausdrücklich 'Yes'; Attribution in Print/Video ausdrücklich "
                    'verlangt. Wöchentliche Planet-Downloads (Btrfs/MBTiles) und Self-Hosting vorgesehen; '
                    'Sponsoring erbeten. Frame-by-frame-Headless-Rendering: akzeptabel.',
  'confidence': 'hoch',
  'notes': 'Einziger Dienst der Liste, der unbegrenzte Nutzung explizit zusagt. Bei Dauerlast Sponsoring '
           '(GitHub Sponsors) fair. Kontakt zsolt@openfreemap.org.',
  'sources': ['https://openfreemap.org/',
              'https://github.com/hyperknot/openfreemap',
              'https://github.com/openmaptiles/openmaptiles/blob/master/LICENSE.md',
              'https://www.openstreetmap.org/copyright'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_hinweis': "OpenFreeMap © OpenMapTiles Data from OpenStreetMap (OpenMapTiles-Vorgabe: '© "
                    "OpenMapTiles © OpenStreetMap contributors'; 'OpenFreeMap' optional)",
  'credit_kurz': '© OpenMapTiles © OpenStreetMap',
  'license_hinweis': 'Daten: ODbL 1.0 (OpenStreetMap); OpenMapTiles-Schema: Code BSD-3-Clause, '
                     'Kartografie/Design CC BY 4.0; OpenFreeMap-Code: MIT'},
 {'id': 'osm',
  'provider': 'OpenStreetMap Foundation (OSMF)',
  'dataset': 'OpenStreetMap Standard-Tiles (openstreetmap-carto)',
  'dataset_url': 'https://www.openstreetmap.org/copyright',
  'license': 'ODbL (Daten), CC0 (Stil)',
  'license_url': 'https://opendatacommons.org/licenses/odbl/1-0/',
  'commercial_video': 'true',
  'modification_notice_required': False,
  'onscreen_credit': '© OpenStreetMap contributors',
  'service_terms_url': 'https://operations.osmfoundation.org/policies/tiles/',
  'service_limits': 'OSMF Tile Usage Policy: eindeutiger User-Agent mit App-Name + Kontakt (generische UAs '
                    'werden geblockt); Cache-Header beachten bzw. mind. 7 Tage cachen; Attribution sichtbar; '
                    "Bulk-Download = 'any pre-emptive fetching of tiles other than those a user is actively "
                    "viewing' verboten (inkl. Pre-Seeding, Tile-Archive); Sperre ohne Vorwarnung bei "
                    "Lastproblemen; wer die Anforderungen nicht erfüllen kann: 'use an alternative "
                    "OSM-derived service, or run your own'. Frame-by-frame-Headless-Rendering vom "
                    'öffentlichen Server: ausdrücklich unerwünscht — Export-Prefetch ist kein aktives '
                    'Betrachten durch einen Nutzer; nur Vorschau mit Cache ist vertretbar, Render-Exporte '
                    'gehören auf einen alternativen/eigenen Server.',
  'confidence': 'hoch',
  'notes': 'Lizenzseitig (ODbL + CC0-Stil) ist der monetarisierte Video-Einsatz unproblematisch; das Problem '
           "ist allein die Server-Policy. Attribution-Guidelines verlangen keinen 'modified'-Hinweis.",
  'sources': ['https://operations.osmfoundation.org/policies/tiles/',
              'https://www.openstreetmap.org/copyright',
              'https://osmfoundation.org/wiki/Licence/Attribution_Guidelines',
              'https://github.com/gravitystorm/openstreetmap-carto/blob/master/LICENSE.txt',
              'https://wiki.openstreetmap.org/wiki/FR:Politique_d%E2%80%99utilisation_des_tuiles'],
  'checked_at': '2026-09-07',
  'render_server': 'absprache',
  'credit_hinweis': "© OpenStreetMap contributors (Attribution Guidelines: 'Attribution must be to "
                    "OpenStreetMap'; in Videos in einer Kartenecke und zusätzlich in Abspann/Beschreibung; "
                    'muss lange genug lesbar sein, nicht dauerhaft bei Pan/Zoom)',
  'credit_kurz': '© OpenStreetMap contributors',
  'license_hinweis': 'Daten: Open Data Commons Open Database License 1.0 (ODbL); Kartografie '
                     'openstreetmap-carto: CC0 1.0'},
 {'id': 'opentopomap',
  'provider': 'OpenTopoMap (Stefan Erhardt u. a.)',
  'dataset': 'OpenTopoMap Raster-Tiles (OSM + SRTM)',
  'dataset_url': 'https://opentopomap.org/about',
  'license': 'CC BY-SA 3.0',
  'license_url': 'https://opentopomap.org/about',
  'commercial_video': 'true',
  'modification_notice_required': True,
  'onscreen_credit': 'Kartendaten: © OpenStreetMap-Mitwirkende, SRTM | Kartendarstellung: © OpenTopoMap '
                     '(CC-BY-SA)',
  'service_terms_url': 'https://opentopomap.org/about',
  'service_limits': 'Kostenlose Nutzung inkl. kommerziell mit Attribution; keine Ausfallgarantie; Warnung '
                    "vor Massen-Downloads, die den Server belasten; 'If you plan to use the tiles for bigger "
                    "projects, please contact us' (derstefan/mogstar auf OSM, stefan@opentopomap.org, GitHub "
                    'Issues). Frame-by-frame-Headless-Rendering vom öffentlichen Server: nicht verboten, '
                    "aber als 'bigger project' meldepflichtig/abzustimmen; Bulk-Prefetch unerwünscht.",
  'confidence': 'mittel',
  'notes': 'CC BY-SA 3.0: Adaptionen (Karte + Track-Overlay im Video) müssen als Bearbeitung gekennzeichnet '
           'und unter SA weitergegeben werden — ShareAlike-Risiko für ein monetarisiertes Video, das als '
           'Adaption gelten könnte; Lizenztext nicht separat geprüft. Tile-Server ist Community-Hobbyprojekt '
           'ohne SLA.',
  'sources': ['https://opentopomap.org/about',
              'https://opentopomap.org/credits',
              'https://wiki.openstreetmap.org/wiki/OpenTopoMap'],
  'checked_at': '2026-09-07',
  'render_server': 'absprache',
  'credit_kurz': '© OpenTopoMap (CC-BY-SA) © OpenStreetMap',
  'license_hinweis': 'Creative Commons Attribution-ShareAlike 3.0 (CC BY-SA 3.0) für die Kartendarstellung; '
                     'Daten ODbL (OSM) + SRTM'},
 {'id': 'cyclosm',
  'provider': 'CyclOSM-Projekt; Tile-Hosting OpenStreetMap France',
  'dataset': 'CyclOSM Raster-Tiles (a.tile-cyclosm.openstreetmap.fr/cyclosm)',
  'dataset_url': 'https://www.cyclosm.org/',
  'license': 'ODbL (Daten), BSD-3 (Stil)',
  'license_url': 'https://github.com/cyclosm/cyclosm-cartocss-style/blob/master/LICENSE.md',
  'commercial_video': 'false',
  'modification_notice_required': False,
  'onscreen_credit': '© CyclOSM | Map data © OpenStreetMap contributors (hosted by OpenStreetMap France)',
  'service_terms_url': 'https://www.openstreetmap.fr/usage',
  'service_limits': 'OSM-France-Usage-Policy (gilt für alle OSM-FR-Fond-de-carte-Dienste): sichtbare '
                    'Attribution ohne Interaktion in einer Kartenecke; öffentlich erreichbare Nutzung (kein '
                    "Login/Intranet); nur nicht-kommerzielle Sites ('use on a non-profit site'); moderater "
                    "Traffic ('if you're wondering whether your traffic is moderate, it usually isn't'); "
                    'Apps müssen kostenlos, non-profit und mit vollem User-Agent sein; Sperre ohne '
                    'Vorwarnung; Verweis auf kommerzielle Anbieter (switch2osm.org) oder eigenen Server; '
                    'Spenden ersetzen keine Gegenleistung. cyclosm.org verweist zusätzlich auf die OSMF Tile '
                    'Usage Policy (kein Bulk-Download). Frame-by-frame-Headless-Rendering für monetarisierte '
                    'Videos vom OSM-FR-Server: nicht zulässig (kommerzieller Zweck, hoher Traffic) — Stil '
                    'ist BSD, also Self-Hosting problemlos.',
  'confidence': 'hoch',
  'notes': 'Lizenz erlaubt alles, der Server nicht: OSM-FR nur für Non-Profit und moderaten Traffic. Für GPS '
           'Studio: CyclOSM selbst hosten oder Anbieter mit Vertrag.',
  'sources': ['https://www.cyclosm.org/',
              'https://github.com/cyclosm/cyclosm-cartocss-style',
              'https://github.com/cyclosm/cyclosm-cartocss-style/blob/master/LICENSE.md',
              'https://www.openstreetmap.fr/usage',
              'https://www.openstreetmap.fr/mentions-legales/',
              'https://forum.openstreetmap.fr/t/abus-dusage-des-services-de-tuiles-openstreetmap-france/40184',
              'https://wiki.openstreetmap.org/wiki/FR:Serveurs/tile.openstreetmap.fr'],
  'checked_at': '2026-09-07',
  'render_server': 'nein',
  'credit_hinweis': "unknown (keine verbindliche Formel veröffentlicht; üblich: '© CyclOSM | Map data © "
                    "OpenStreetMap contributors' + Hinweis 'hosted by OpenStreetMap France')",
  'credit_kurz': '© CyclOSM © OpenStreetMap',
  'license_hinweis': 'Stil: BSD-3-Clause (Icons teils CC BY 4.0 / CC0 / Apache 2.0); Daten: ODbL 1.0 (OSM); '
                     'OSM-FR-Tiles laut Mentions légales CC BY-SA 2.0'},
 {'id': 'hot',
  'provider': 'Humanitarian OpenStreetMap Team (Stil); Tile-Hosting OpenStreetMap France',
  'dataset': 'Humanitarian map style (HDM-CartoCSS) Raster-Tiles (a.tile.openstreetmap.fr/hot)',
  'dataset_url': 'https://wiki.openstreetmap.org/wiki/Humanitarian_map_style',
  'license': 'ODbL (Daten), CC0 (Stil)',
  'license_url': 'https://github.com/hotosm/HDM-CartoCSS',
  'commercial_video': 'false',
  'modification_notice_required': False,
  'onscreen_credit': '© OpenStreetMap contributors | Tiles: Humanitarian OpenStreetMap Team, hosted by '
                     'OpenStreetMap France',
  'service_terms_url': 'https://www.openstreetmap.fr/usage',
  'service_limits': 'Gleiche OSM-France-Usage-Policy wie CyclOSM: Attribution sichtbar, öffentlicher Zugang, '
                    'nur Non-Profit-Sites, moderater Traffic, Apps kostenlos + voller User-Agent, Sperre '
                    'ohne Vorwarnung, Verweis auf kommerzielle Anbieter/eigenen Server. '
                    'Frame-by-frame-Headless-Rendering für monetarisierte Videos vom OSM-FR-Server: nicht '
                    'zulässig; Stil ist CC0, Self-Hosting möglich (Repo seit März 2025 archiviert, OSM-FR '
                    'hostet weiter).',
  'confidence': 'hoch',
  'notes': 'HDM-CartoCSS-Repo archiviert (03/2025), Nachfolger als Vector-Style in Arbeit '
           '(hotosm/humanitarian-map-style). Lizenzseitig frei, Server-Policy schließt kommerzielle Nutzung '
           'aus.',
  'sources': ['https://wiki.openstreetmap.org/wiki/Humanitarian_map_style',
              'https://github.com/hotosm/HDM-CartoCSS',
              'https://www.openstreetmap.fr/usage',
              'https://www.openstreetmap.fr/mentions-legales/',
              'https://forum.openstreetmap.fr/t/abus-dusage-des-services-de-tuiles-openstreetmap-france/40184'],
  'checked_at': '2026-09-07',
  'render_server': 'nein',
  'credit_hinweis': "© OpenStreetMap contributors (Stil CC0 ohne Pflicht-Credit; üblich: 'Tiles style by "
                    "Humanitarian OpenStreetMap Team, hosted by OpenStreetMap France')",
  'credit_kurz': '© OpenStreetMap contributors (HOT)',
  'license_hinweis': 'Stil HDM-CartoCSS: CC0 1.0; Daten: ODbL 1.0 (OSM); OSM-FR-Tiles laut Mentions légales '
                     'CC BY-SA 2.0'},
 {'id': 'maptiler',
  'provider': 'MapTiler AG',
  'dataset': 'MapTiler Cloud (Satellite, Outdoor, Streets …)',
  'dataset_url': 'https://www.maptiler.com/cloud/',
  'license': 'MapTiler Cloud Terms of Service (Free: nicht kommerziell; Flex: Videos bis 100.000 Abonnenten)',
  'license_url': 'https://www.maptiler.com/terms/cloud/',
  'commercial_video': 'license_required',
  'modification_notice_required': False,
  'onscreen_credit': '© MapTiler © OpenStreetMap contributors',
  'service_terms_url': 'https://www.maptiler.com/terms/cloud/',
  'service_limits': 'Eigener API-Schlüssel je Nutzer; Endnutzer-Anfragen direkt an MapTiler; nur temporärer '
                    'Geräte-Cache; Bulk/Server-Cache nur mit Vereinbarung.',
  'confidence': 'hoch',
  'notes': 'Free-Tarif nicht kommerziell. Flex-Tarif: begrenzte Internetvideos bis 100.000 Kanalabonnenten '
           'mit sichtbarer Attribution; größere Kanäle/TV/Film individuell. Quelle: Konzept 07.09.2026 §4.3.',
  'sources': ['https://www.maptiler.com/terms/cloud/',
              'https://www.maptiler.com/cloud/geolayers/',
              'https://www.maptiler.com/cloud/pricing/'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_kurz': '© MapTiler © OpenStreetMap'},
 {'id': 'mapbox',
  'provider': 'Mapbox, Inc.',
  'dataset': 'Mapbox Standard / Satellite / Outdoors (Style-URLs)',
  'dataset_url': 'https://www.mapbox.com/maps',
  'license': 'Mapbox Product Terms (§1.7 Print or Video Use)',
  'license_url': 'https://www.mapbox.com/legal/product-terms',
  'commercial_video': 'license_required',
  'modification_notice_required': False,
  'onscreen_credit': '© Mapbox © OpenStreetMap',
  'service_terms_url': 'https://www.mapbox.com/legal/tos',
  'service_limits': 'Token-gebunden; Videos mit Karteninhalt nur mit gekauften Print-/Video-Rechten '
                    '(Ausnahme: Werbevideo für die lizenzierte App).',
  'confidence': 'hoch',
  'notes': 'Normaler Token oder Free-Kontingent enthält keine Videorechte. Quelle: Konzept 07.09.2026 §4.2.',
  'sources': ['https://www.mapbox.com/legal/product-terms',
              'https://www.mapbox.com/pricing',
              'https://docs.mapbox.com/help/dive-deeper/attribution/'],
  'checked_at': '2026-09-07',
  'render_server': 'ok',
  'credit_kurz': '© Mapbox © OpenStreetMap'}]

_BY_ID = {q["id"]: q for q in QUELLEN}


def _th_lizenzwechsel() -> None:
    """Thüringen wechselt am 14.09.2026 von dl-de/by-2-0 auf CC BY 4.0 (Beschluss IKG-GIZ, News 24.06.2026);
    die Nennung bleibt „© GDI-Th". Ab dem Stichtag zeigt das Register die neue Lizenz."""
    q = _BY_ID.get("de-th")
    if q and _dt.date.today() >= _dt.date(2026, 9, 14):
        q["license"] = "Creative Commons Namensnennung 4.0 International (CC BY 4.0) — seit 14.09.2026"
        q["license_url"] = "https://creativecommons.org/licenses/by/4.0/"
        q["onscreen_credit"] = "© GDI-Th, CC BY 4.0, bearbeitet"
        q["credit_kurz"] = "© GDI-Th CC BY"


_th_lizenzwechsel()


def eintrag(qid: str) -> Optional[dict]:
    return _BY_ID.get(REGION_ZU_QUELLE.get(qid, STIL_ZU_QUELLE.get(qid, qid)))


def status(qid: str) -> str:
    q = eintrag(qid)
    return q["commercial_video"] if q else "unknown"


def _datum(s: str) -> Optional[_dt.date]:
    try:
        return _dt.date.fromisoformat(str(s)[:10])
    except (TypeError, ValueError):
        return None


def faellige(heute: Optional[_dt.date] = None) -> list[dict]:
    """Einträge, deren Prüfung länger als PRUEF_INTERVALL_TAGE her ist (oder ohne Datum)."""
    heute = heute or _dt.date.today()
    out = []
    for q in QUELLEN:
        d = _datum(q.get("checked_at"))
        tage = (heute - d).days if d else None
        if d is None or tage > PRUEF_INTERVALL_TAGE:
            out.append({"id": q["id"], "checked_at": q.get("checked_at"), "tage": tage})
    return out


def naechste_pruefung() -> Optional[_dt.date]:
    """Frühestes Fälligkeitsdatum über alle Einträge."""
    ds = [_datum(q.get("checked_at")) for q in QUELLEN]
    ds = [d for d in ds if d]
    return (min(ds) + _dt.timedelta(days=PRUEF_INTERVALL_TAGE)) if ds else None


def stil_status(style_key: str, region_ids=None) -> dict:
    """Gesamtstatus eines Stils: bei „Satellit (kostenlos)" über alle beteiligten Quellen
    (Landesdienste des Stapels + Grundlagen), sonst die eine Quelle des Stils.
    Rang: false > license_required > unknown > true — die schlechteste Quelle bestimmt."""
    if style_key == "free_satellite":
        ids = list(GOV_GRUNDLAGEN) + [REGION_ZU_QUELLE.get(r, r) for r in (region_ids or [])]
    else:
        ids = [STIL_ZU_QUELLE.get(style_key, style_key)]
    rang = {"false": 3, "license_required": 2, "unknown": 1, "true": 0}
    st, je, server = "true", {}, {}
    for i in ids:
        s = status(i); je[i] = s
        rs = (eintrag(i) or {}).get("render_server", "ok")
        if rs != "ok":
            server[i] = rs
            s = "false" if rs == "nein" else ("unknown" if s == "true" else s)   # Server-Regeln: nein = nicht erlaubt, absprache = Warnung
        if rang.get(s, 1) > rang[st]:
            st = s
    return {"status": st, "quellen": je, "server": server,
            "offen": [i for i, s in je.items() if s == "unknown"],
            "nein": [i for i, s in je.items() if s == "false"],
            "rechte": [i for i, s in je.items() if s == "license_required"]}


def nennung(qid: str) -> str:
    """Vorgeschriebene Nennformel (leer, wenn keine bekannt)."""
    q = eintrag(qid)
    return (q or {}).get("onscreen_credit") or ""


def _ids_geordnet(ids) -> list[str]:
    """Regionen zuerst (wie im Bild: oben liegt das Luftbild), dann Grundlagen; Doppelte raus."""
    seen, out = set(), []
    for i in list(ids or []):
        k = REGION_ZU_QUELLE.get(i, STIL_ZU_QUELLE.get(i, i))
        if k in seen or not _BY_ID.get(k):
            continue
        seen.add(k); out.append(k)
    grund = [g for g in GOV_GRUNDLAGEN if g in out]
    return [i for i in out if i not in grund] + grund


def kurz_nennung(ids, link: str = "", bearbeitet: str = "bearbeitet", quellen_wort: str = "Quellen") -> str:
    """Knappe Quellenzeile (Modus „kurz"): Kurznamen aller beteiligten Quellen, Änderungshinweis,
    optional ein Link zu den vollständigen Angaben. Spiegel: util.js rzKurzNennung."""
    teile = [_BY_ID[i].get("credit_kurz") or _BY_ID[i].get("onscreen_credit") or i for i in _ids_geordnet(ids)]
    if bearbeitet:
        teile.append(bearbeitet)
    if link:
        teile.append(f"{quellen_wort}: {link}")
    return " · ".join(teile)


def quellen_text(ids, link: str = "", titel: str = "Karten-, Luftbild- und Geländequellen", bearbeitet: str = "Daten bearbeitet") -> str:
    """Vollständiger Quellentext für Videobeschreibung/Abspann: je Quelle Anbieter, Datensatz, Lizenz mit Links.
    Spiegel: util.js rzQuellenText."""
    zeilen = [titel + ":"]
    for i in _ids_geordnet(ids):
        q = _BY_ID[i]
        z = f"- {q['provider']}: {q['dataset']} — {q['license']}"
        if q.get("license_url"):
            z += f" ({q['license_url']})"
        if q.get("dataset_url"):
            z += f" — {q['dataset_url']}"
        zeilen.append(z)
    if bearbeitet:
        zeilen.append(bearbeitet + ".")
    if link:
        zeilen.append(link)
    return chr(10).join(zeilen)


def fuer_ui() -> list[dict]:
    """Schlanke Sicht für die Rechte-Tabelle (ohne Quellenlisten)."""
    return [{k: q.get(k) for k in ("id", "provider", "dataset", "dataset_url", "license", "license_url",
                                    "commercial_video", "modification_notice_required", "onscreen_credit",
                                    "service_terms_url", "confidence", "checked_at", "notes", "render_server", "service_limits", "credit_kurz")}
            for q in QUELLEN]
