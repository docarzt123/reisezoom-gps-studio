# GPS Studio: Kartenquellen, Video-Lizenzen und automatische Quellenangaben

Stand: 7. September 2026

> Diese Zusammenfassung ist eine technische und praktische Auswertung öffentlich zugänglicher Lizenzbedingungen, keine Rechtsberatung. Entscheidend sind immer die Bedingungen des konkret verwendeten Datensatzes und Kartendienstes zum Zeitpunkt der Nutzung.

## 1. Ziel und Nutzungsszenario

GPS Studio lädt Karten- beziehungsweise Luftbildkacheln, kombiniert sie gegebenenfalls mit Gelände, Beschriftungen und einer GPX-Strecke und rendert daraus Bilder oder Videos. Diese Ergebnisse können in monetarisierten YouTube-Videos und anderen kommerziellen Veröffentlichungen erscheinen.

Dabei müssen drei voneinander getrennte Rechte geprüft werden:

1. **Datenlizenz:** Darf das Luftbild oder Kartenmaterial kommerziell genutzt, bearbeitet und veröffentlicht werden?
2. **Dienstbedingungen:** Darf der WMS-, WMTS- oder Tile-Server für automatisiertes Rendering und lokales Caching verwendet werden?
3. **Quellenangabe:** Welche Angaben müssen im Bild beziehungsweise Video und welche dürfen über eine verlinkte Seite bereitgestellt werden?

Eine offene Datenlizenz bedeutet nicht automatisch, dass ein kostenloser öffentlicher Tile-Server unbegrenzt für Rendering belastet werden darf.

## 2. Kurzfazit

- Amtliche Luftbilder unter **Datenlizenz Deutschland – Namensnennung 2.0**, **CC BY 4.0**, **CC0** und vergleichbaren Open-Data-Bedingungen können grundsätzlich auch in monetarisierten Videos verwendet werden.
- Die Erlaubnis gilt nur, wenn die vorgeschriebene Quellenangabe vollständig erfüllt wird.
- Die pauschale Bezeichnung **„Satellite (free) – kommerzielle Videos erlaubt“** sollte nur für einzeln geprüfte Dienste verwendet werden. Eine gemeinsame Lizenz für alle eingebauten Länder gibt es nicht.
- **Esri World Imagery** sollte nicht ohne eine gesonderte kommerzielle Vereinbarung in GPS Studio eingebaut werden.
- **Mapbox-Videomaterial** benötigt außerhalb der eng begrenzten Ausnahmen gekaufte Videorechte.
- **MapTiler Free** ist nicht für kommerzielle Nutzung gedacht. Der kostenpflichtige Flex-Tarif erlaubt begrenzte Internetvideos, insbesondere bis 100.000 Kanalabonnenten, mit sichtbarer Attribution.
- Ein **einziger Shortlink pro Export** ist als Teil der Quellenangabe gut umsetzbar. Er muss direkt zu den vollständigen Quellen dieses konkreten Exports führen, nicht zu einer Auswahl- oder allgemeinen Übersichtsseite.

## 3. Quellen, bei denen kommerzielle Videos grundsätzlich möglich sind

### 3.1 Datenlizenz Deutschland – Namensnennung 2.0

Die Lizenz erlaubt ausdrücklich kommerzielle und nichtkommerzielle Nutzung. Erlaubt sind unter anderem Vervielfältigung, Präsentation, Veränderung, Bearbeitung, Übermittlung und die Einbindung in Produkte und Anwendungen.

Erforderlich sind – soweit vom Bereitsteller vorgegeben:

- Bezeichnung des Bereitstellers,
- Hinweis `Datenlizenz Deutschland – Namensnennung – Version 2.0` oder `dl-de/by-2.0`,
- Verweis auf den Lizenztext,
- Verweis auf den konkreten Datensatz,
- bei Bearbeitung oder Abwandlung ein entsprechender Hinweis.

Quelle: [Offizieller Lizenztext DL-DE/BY 2.0](https://www.govdata.de/dl-de/by-2-0)

Die Animation, Farbkorrektur, Kombination mit Gelände oder sonstige Gestaltung sollte vorsichtshalber als Bearbeitung gekennzeichnet werden.

Beispiel für die kurze Anzeige im Video:

> Luftbild: © GeoBasis-DE/LGB · dl-de/by-2.0 · bearbeitet  
> Details: reisezoom.com/k/7F3K9

Die genaue Bezeichnung muss aus den Metadaten des tatsächlich verwendeten Dienstes übernommen werden.

### 3.2 Creative Commons BY 4.0

CC BY 4.0 erlaubt Weitergabe und Bearbeitung für beliebige Zwecke, ausdrücklich auch kommerziell. Erforderlich sind eine angemessene Namensnennung, ein Lizenzhinweis beziehungsweise Lizenzlink und ein Hinweis auf vorgenommene Änderungen.

Die Lizenz erlaubt ausdrücklich, die Anforderungen in einer dem Medium angemessenen Weise zu erfüllen. Dazu kann ein Hyperlink auf eine Seite gehören, welche die notwendigen Angaben enthält.

Quellen:

- [CC BY 4.0 – Zusammenfassung](https://creativecommons.org/licenses/by/4.0/)
- [CC BY 4.0 – verbindlicher Lizenztext, Abschnitt 3](https://creativecommons.org/licenses/by/4.0/legalcode)
- [Creative Commons: empfohlene Attributionspraxis](https://wiki.creativecommons.org/wiki/Recommended_practices_for_attribution)

Damit sind beispielsweise echte CC-BY-Luftbildquellen grundsätzlich für monetarisierte YouTube-Videos geeignet, sofern die vom Anbieter gewünschte Attribution eingehalten wird.

### 3.3 CC0 beziehungsweise DL-DE/Zero

Bei CC0 und DL-DE/Zero besteht regelmäßig keine rechtliche Namensnennungspflicht. Eine Quellenangabe ist trotzdem sinnvoll, damit Herkunft und Aktualität nachvollziehbar bleiben.

### 3.4 Swisstopo

Swisstopo erlaubt, seine kostenlosen Geodaten und Geodienste zu nutzen, zu verbreiten, zu bearbeiten und kommerziell zu verwenden. Eine Quellenangabe ist Pflicht. Swisstopo weist außerdem darauf hin, dass bei übermäßiger Nutzung der Dienstinfrastruktur der Zugang eingeschränkt werden kann.

Besonders relevant für das Shortlink-Konzept: Swisstopo akzeptiert ausdrücklich eine zentrale Webseite mit allen verwendeten Quellen, wenn in der Kartenanwendung oder Dienstbeschreibung auf diese Seite verlinkt wird.

Quellen:

- [Swisstopo: Nutzungsbedingungen für kostenlose Geodaten und Geodienste](https://www.swisstopo.admin.ch/de/nutzungsbedingungen-kostenlose-geodaten-und-geodienste)
- [Swisstopo: Vorgaben und Beispiele zur Quellenangabe](https://www.swisstopo.admin.ch/de/quellenangabe-ogd-swisstopo)

### 3.5 Spanien – PNOA

Die PNOA-Orthofotos werden grundsätzlich unter CC BY 4.0 bereitgestellt. Kommerzielle Veröffentlichung und Bearbeitung sind damit möglich, sofern die vorgegebene Quellenangabe verwendet wird.

Quellen:

- [IGN/CNIG: Lizenzbedingungen](https://www.ign.es/resources/licencia/Condiciones_licenciaUso_IGN.pdf)
- [PNOA: Katalog und Anwendungsfälle](https://pnoa.ign.es/pnoa-imagen/catalogo-y-casos-de-uso)

### 3.6 USA – USGS

Werke der US-Bundesregierung sind häufig gemeinfrei; das trifft regelmäßig auf USGS-Bildmaterial zu. Trotzdem müssen beim konkreten Layer Metadaten und mögliche Drittbestandteile geprüft werden. Eine freiwillige Quellenangabe sollte in GPS Studio beibehalten werden.

## 4. Quellen, die nicht ohne Weiteres verwendet werden sollten

### 4.1 Esri World Imagery

Esri World Imagery ist ein Mosaik aus Esri-eigenen, amtlichen und kommerziellen Drittanbieterdaten. Es handelt sich nicht um allgemein frei lizenzierte Satellitenbilder.

Esris Zusammenfassung für Esri-eigene ArcGIS-Online-Inhalte erlaubt mit einer ArcGIS-Online-Subscription unter anderem Screenshots und gedruckte Karten. Gleichzeitig untersagt sie:

- systematisches Sammeln von Basemap-Kacheln außerhalb der vorgesehenen Esri-Content-Pakete,
- Weitergabe oder Selbsthosting der Basemap-Kacheln,
- kommerzielle Nutzung von Living-Atlas-Inhalten in einer eigenen Anwendung oder einem Produkt ohne zusätzliche Lizenzklärung.

Für die Integration in GPS Studio und das Rendering monetarisierter Videos ist deshalb eine ausdrückliche kommerzielle Vereinbarung beziehungsweise schriftliche Freigabe von Esri erforderlich. Ein öffentlicher World-Imagery-Endpunkt oder ein normaler ArcGIS-Online-Account genügt dafür nicht zuverlässig.

Quellen:

- [Esri: FAQ zur Nutzung Esri-eigener ArcGIS-Online-Inhalte](https://content.esri.com/arcgisonline/docs/tou_summary.pdf)
- [Esri World Imagery – Layerbeschreibung und Bedingungen](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9)
- [Esri: Anforderungen an die Basemap-Attribution](https://support.esri.com/en-us/knowledge-base/what-is-the-correct-way-to-cite-an-arcgis-online-basema-000012040)
- [Esri Legal: Master Agreement und produktspezifische Bedingungen](https://www.esri.com/en-us/legal/terms/master-agreement)

### 4.2 Mapbox

Mapbox erlaubt Videos mit Licensed Map Content grundsätzlich nur in ausdrücklich genannten Fällen. Die kostenlose Ausnahme betrifft im Wesentlichen Videos, die eine lizenzierte Anwendung bewerben und in denen der Karteninhalt lediglich beiläufig im Anwendungskontext erscheint. Sonstige Videoverwendung benötigt gekaufte Print- beziehungsweise Videorechte.

Ein normaler Mapbox-Token oder das kostenlose Nutzungskontingent enthält daher keine allgemeine Erlaubnis, GPS-Animationen für monetarisierte Videos zu erstellen.

Quellen:

- [Mapbox: Commercial Print or Video Rights](https://www.mapbox.com/pricing)
- [Mapbox Product Terms](https://www.mapbox.com/legal/product-terms)
- [Mapbox: Attribution](https://docs.mapbox.com/help/dive-deeper/attribution/)

### 4.3 MapTiler

Der kostenlose MapTiler-Cloud-Tarif ist auf nichtkommerzielle Nutzung sowie Forschung und Entwicklung beschränkt. Für monetarisierte Videos ist ein geeigneter kostenpflichtiger Tarif nötig.

Die Cloud-Bedingungen erlauben mit einem passenden Abonnement begrenzte Videos und Animationen auf Internetkanälen bis maximal 100.000 Abonnenten. Die MapTiler-Attribution muss sichtbar sein, während die Karte gezeigt wird. Größere Kanäle, TV, Film und weitergehende kommerzielle Produktionen benötigen eine individuelle Vereinbarung.

Weitere technische Bedingungen:

- Jeder Nutzer muss seinen eigenen API-Key verwenden.
- Endnutzeranfragen sollen grundsätzlich direkt an MapTiler gehen.
- Ein temporärer persönlicher Endgeräte-Cache ist erlaubt.
- Bulk-Download, serverseitiges Caching und weitergehender Export können eine individuelle Vereinbarung benötigen.

Quellen:

- [MapTiler Cloud Terms, insbesondere Abschnitte 1, 5 und 6](https://www.maptiler.com/terms/cloud/)
- [MapTiler: Video- und Animationslizenz](https://www.maptiler.com/cloud/geolayers/)
- [MapTiler Cloud Pricing](https://www.maptiler.com/cloud/pricing/)

### 4.4 Öffentliche OpenStreetMap-Tile-Server

Die OpenStreetMap-Daten sind offen nutzbar. Das bedeutet jedoch nicht, dass der von Spenden finanzierte Standardserver `tile.openstreetmap.org` für automatisches Videorendering oder massenhafte Downloads freigegeben ist.

Die aktuelle Tile Usage Policy untersagt insbesondere:

- Bulk- und Prefetch-Downloads,
- Offline-Archive,
- automatisierte beziehungsweise headless Scans über große Gebiete oder Zoomstufen.

Ein Video-Renderer, der Bild für Bild öffentliche OSM-Rasterkacheln abruft, kann darunter fallen. Für Produktion und Skalierung sollten selbst gehostete Tiles oder ein Anbieter verwendet werden, der Rendering ausdrücklich gestattet.

Quelle: [OpenStreetMap Foundation: Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/)

## 5. Noch einzeln zu prüfende „Satellite (free)“-Quellen

Die folgenden derzeit in der GPS-Studio-Dokumentation genannten Quellen dürfen nicht allein aufgrund ihrer amtlichen Herkunft pauschal als kommerziell nutzbar markiert werden. Vor einem verbindlichen „Video erlaubt“-Hinweis müssen jeweils der konkrete Datensatz, Dienstendpunkt, Lizenzstand, vorgeschriebene Quellenvermerk und die Dienstbedingungen dokumentiert werden:

- alle 15 eingebauten deutschen Bundeslanddienste,
- Frankreich/IGN Géoplateforme,
- Italien/Geoportale Nazionale,
- Tschechien/ČÚZK,
- Polen/GUGiK,
- Estland/Maa-amet,
- Portugal/DGT,
- Niederlande/PDOK,
- Österreich/basemap.at,
- Japan/GSI,
- sonstige Fallback- oder Drittanbieterquellen.

Viele davon verwenden voraussichtlich offene Lizenzen wie CC BY 4.0, DL-DE/BY 2.0 oder nationale Open-Data-Lizenzen. Trotzdem muss die Prüfung pro konkretem Layer erfolgen. Besonders wichtig ist, ob die Lizenz für die **Daten** und die Nutzungsregel für den **Live-Dienst** auseinanderfallen.

## 6. Empfohlenes Shortlink- und Attributionskonzept

### 6.1 Grundsatz

Ein einziger Shortlink darf verwendet werden, wenn er unmittelbar zu allen Quellenangaben des konkreten Exports führt. Der Nutzer darf auf der Zielseite nicht erst Land, Quelle oder Video auswählen müssen.

Nicht empfohlen:

`https://reisezoom.com/kartenquellen`

wenn dort zunächst eine allgemeine Liste oder Auswahl erscheint.

Empfohlen:

`https://reisezoom.com/k/7F3K9`

Die Zielseite zeigt sofort ausschließlich oder zuerst die bei diesem Export tatsächlich verwendeten Quellen.

### 6.2 Warum ein zentraler Link grundsätzlich möglich ist

CC BY 4.0 erlaubt ausdrücklich eine dem Medium angemessene Attribution und nennt als zulässiges Beispiel einen URI oder Hyperlink auf eine Ressource mit den erforderlichen Informationen.

Swisstopo akzeptiert ausdrücklich eine zentrale Quellenseite, wenn die Karte beziehungsweise deren Beschreibung darauf verweist.

DL-DE/BY 2.0 verlangt einen Verweis auf Lizenztext und Datensatz. Die Lizenz sagt nicht ausdrücklich, dass ein zwischengeschalteter Shortlink immer genügt. Deshalb empfiehlt sich für DL-DE-Material die Kombination aus:

- sichtbarem Bereitsteller und Lizenzkürzel im Video,
- eindeutigem Shortlink im Video oder in der Beschreibung,
- direkten Links zu Lizenz und Datensatz auf der Zielseite.

### 6.3 Anzeige im gerenderten Bild oder Video

Empfohlenes Muster:

> Luftbild: © GeoBasis-DE/LGB · dl-de/by-2.0 · bearbeitet  
> Quellen: reisezoom.com/k/7F3K9

Bei mehreren gleichzeitig sichtbaren Quellen kann die erste Zeile verkürzt werden:

> Karten- und Luftbildquellen · bearbeitet  
> reisezoom.com/k/7F3K9

Ob diese starke Verkürzung zulässig ist, hängt von der jeweiligen Quelle ab. Sofern ein Anbieter eine sichtbare Namensnennung direkt am Bild verlangt, muss sein Name eingeblendet bleiben.

### 6.4 Text für die YouTube-Beschreibung

GPS Studio sollte nach jedem Export einen Copy-Button anbieten:

> Karten-, Luftbild- und Geländequellen: https://reisezoom.com/k/7F3K9

Damit steht nur ein Link in der Videobeschreibung, obwohl auf der Zielseite mehrere vollständige Datensatz- und Lizenzlinks dokumentiert werden.

### 6.5 Anforderungen an die Zielseite

Die Seite hinter dem Shortlink muss:

- ohne Anmeldung, Bezahlung oder Auswahl erreichbar sein,
- direkt die Quellen dieses konkreten Exports zeigen,
- jeden tatsächlich verwendeten Anbieter nennen,
- Datensatzbezeichnung und direkten Datensatzlink enthalten,
- Lizenzbezeichnung und direkten Lizenzlink enthalten,
- vorgeschriebene Copyright- oder Quellenformeln unverändert wiedergeben,
- Bearbeitungen kennzeichnen,
- auch Kartenbeschriftung, Gelände und sonstige Quellen aufführen,
- dauerhaft erreichbar und inhaltlich nachvollziehbar bleiben,
- Erstellungsdatum und optional den damaligen Lizenzstand dokumentieren.

Eine allgemeine Landingpage, die später andere Inhalte zeigt, reicht nicht.

## 7. Technischer Umsetzungsvorschlag

### 7.1 Quellenregister

Jeder Kartenlayer sollte einen maschinenlesbaren Datensatz besitzen, beispielsweise:

```json
{
  "id": "de-bb-lgb-dop20",
  "provider": "GeoBasis-DE/LGB",
  "dataset": "Digitales Orthophoto Brandenburg",
  "dataset_url": "https://…",
  "license": "dl-de/by-2.0",
  "license_url": "https://www.govdata.de/dl-de/by-2-0",
  "commercial_video": true,
  "modification_notice_required": true,
  "onscreen_credit": "© GeoBasis-DE/LGB · dl-de/by-2.0 · bearbeitet",
  "service_terms_url": "https://…",
  "checked_at": "2026-09-07"
}
```

`commercial_video` darf erst nach Prüfung des konkreten Datensatzes und Dienstes auf `true` gesetzt werden.

### 7.2 Erfassung während des Renderns

GPS Studio sollte nicht aus dem ausgewählten Stil ableiten, welche Quellen möglicherweise beteiligt waren. Stattdessen sollte der Renderer protokollieren, welche Layer tatsächlich erfolgreiche Kacheln geliefert haben.

Erfasst werden mindestens:

- Luftbildlayer,
- Beschriftungs- beziehungsweise Kartendaten,
- Geländequelle,
- Fallback-Layer,
- gegebenenfalls Quellen benachbarter Bundesländer.

### 7.3 Unveränderlicher Exportnachweis

Aus der sortierten Quellenliste wird ein stabiler Hash beziehungsweise eine Export-ID erzeugt. Beispiel:

`7F3K9 → de-bb-lgb-dop20 + osm-labels + mapzen-terrain`

Der Server legt dazu eine dauerhafte Seite an. Gleiche Quellenkombinationen können dieselbe Seite verwenden, sofern alle notwendigen Angaben identisch sind. Ändert sich eine Lizenz oder Quellenformel, sollte eine neue Version beziehungsweise ID entstehen, damit ältere Videos weiterhin auf ihre damalige Dokumentation zeigen.

### 7.4 Verhalten bei ungeprüften Quellen

Ist eine Quelle nicht vollständig geprüft, darf GPS Studio nicht behaupten, dass kommerzielle Veröffentlichung sicher erlaubt sei. Geeignete Statuswerte:

- `commercial_video: true` – geprüft und erlaubt,
- `commercial_video: license_required` – kostenpflichtige oder individuelle Rechte erforderlich,
- `commercial_video: unknown` – noch nicht verifiziert,
- `commercial_video: false` – nach den Bedingungen nicht erlaubt.

Vor dem Rendern eines kommerziellen Videos sollte bei `unknown`, `false` oder `license_required` ein klarer Hinweis erscheinen.

## 8. Cache und Serverbelastung

Der vorhandene lokale Kachelcache von GPS Studio muss je Quelle konfigurierbar sein. Eine pauschale Cachegröße von 2 GB sagt nichts darüber aus, ob der jeweilige Dienst diese Speicherung erlaubt.

Pro Quelle sollten deshalb zusätzlich gespeichert werden:

- zulässige Cache-Dauer,
- Beachtung der HTTP-Cache-Header,
- Erlaubnis oder Verbot von Prefetching,
- zulässige Parallelität und Rate-Limits,
- vorgeschriebener User-Agent und Kontaktadresse,
- Verbot von serverseitigem Proxying oder Weitergabe.

Das Rendern darf nicht automatisch große Gebiete und zahlreiche Zoomstufen vorsorglich herunterladen. Es sollten ausschließlich die für Vorschau und aktuellen Export benötigten Kacheln abgerufen werden.

## 9. Empfohlene Produktformulierungen

Nicht verwenden:

> Kostenloses Satellitenbild – Videos immer erlaubt

Besser:

> Amtliches Luftbild – kommerzielle Videos mit Quellenangabe erlaubt

Nur bei vollständig geprüfter Quelle.

Bei ungeprüfter Quelle:

> Nutzungsrechte dieser Quelle noch nicht vollständig verifiziert

Bei MapTiler:

> Eigener geeigneter MapTiler-Tarif erforderlich; Free-Tarif nicht kommerziell

Bei Mapbox:

> Veröffentlichung in Videos nur mit passenden, separat erworbenen Videorechten

Bei Esri:

> Für kommerzielle Nutzung in GPS Studio ist eine gesonderte Esri-Vereinbarung erforderlich

Außerdem ist **„amtliches Luftbild“** meistens genauer als **„Satellitenbild“**, weil viele hochauflösende Quellen tatsächlich aus Flugzeugbefliegungen stammen.

## 10. Go-/No-Go-Matrix

| Quelle/Lizenz | Monetarisiertes Video | GPS-Studio-Integration | Hauptbedingung |
|---|---:|---:|---|
| DL-DE/BY 2.0 | Ja | Ja | Vollständige Quellenangabe, Datensatz-/Lizenzverweis, Bearbeitungshinweis |
| DL-DE/Zero 2.0 | Ja | Ja | Herkunft freiwillig dokumentieren |
| CC BY 4.0 | Ja | Ja | Urheber/Bereitsteller, Lizenzlink, Quelle und Änderungen nennen |
| CC0 | Ja | Ja | Attribution meist freiwillig |
| Swisstopo OGD | Ja | Ja | Pflicht-Quellenangabe; Dienst nicht übermäßig belasten |
| PNOA/CNIG unter CC BY 4.0 | Ja | Ja | Vorgeschriebene PNOA/CNIG-Attribution |
| USGS ohne Drittmaterial | Ja | Ja | Gemeinfrei; Attribution empfohlen |
| Esri World Imagery | Nicht ohne Klärung | Nicht ohne Vertrag | Kommerzielle Vereinbarung, Drittanbieterrechte, kein Tile-Harvesting |
| Mapbox | Nur mit passenden Videorechten | Nur vertragsgemäß | Gekaufte Print-/Videorechte und Attribution |
| MapTiler Free | Nein, wenn kommerziell | Nur Entwicklung/nichtkommerziell | Für Monetarisierung geeigneten Tarif verwenden |
| MapTiler Flex, innerhalb der Grenzen | Ja | Ja, vertragsgemäß | Bis 100.000 Abonnenten, sichtbare Attribution, eigener Key |
| `tile.openstreetmap.org` | Datenlizenz ja, Server dafür problematisch | Nicht für Headless-/Bulk-Rendering | Kein Prefetch, Bulk-Download oder Offline-Archiv |
| Noch ungeprüfte nationale Dienste | Ungeklärt | Noch nicht freigeben | Layer, Lizenz, Attribution und Dienstbedingungen einzeln prüfen |

## 11. Empfohlene nächsten Schritte

1. Vollständige Liste aller in GPS Studio hinterlegten Luftbild-, Karten- und Geländelayer exportieren.
2. Für jeden Dienst Datensatzseite, Lizenz, Attribution und Dienstbedingungen dokumentieren.
3. Quellen mit unklaren Bedingungen zunächst auf `commercial_video: unknown` setzen.
4. Die aktuelle automatische Attribution auf die exakten Vorgaben der Bereitsteller umstellen.
5. Beim Rendern ausschließlich tatsächlich genutzte Quellen erfassen.
6. Pro Export oder Quellenkombination eine dauerhafte direkte Shortlink-Seite erzeugen.
7. Einen fertigen YouTube-Quellentext per Copy-Button bereitstellen.
8. Cache- und Abrufregeln pro Dienst implementieren.
9. Esri erst nach schriftlicher kommerzieller Freigabe hinzufügen.

## 12. SEO-Nebeneffekt

Der Quellenlink erfüllt einen echten rechtlichen und informativen Zweck. Wenn Nutzer ihn in ihre Videobeschreibung übernehmen, entstehen zugleich sachlich begründete Verweise auf Reisezoom. Das sollte nicht als künstliches Linkbuilding beworben oder erzwungen werden; die primäre Funktion bleibt die korrekte Lizenzdokumentation. Der Link muss auch dann vollständig funktionieren, wenn er keinen messbaren SEO-Effekt erzeugt.

