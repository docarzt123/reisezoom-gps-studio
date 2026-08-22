<?php
/**
 * Reisezoom GPS Studio — Cloud-Archiv, Gegenstelle für den eigenen Webserver.
 *
 * EINE Datei. Hochladen, im GPS Studio Adresse und Schlüssel eintragen, fertig.
 * Entwurf und Begründungen: docs/IDEAS.md §26 (durchgesprochen am 15.08.2026).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WAS DIESER SERVER WEISS — UND WAS NICHT
 * ─────────────────────────────────────────────────────────────────────────
 * Er sieht: undurchsichtige Namen (Hashes), Größen, Zeitpunkte.
 * Er sieht NICHT: Tournamen, Orte, Notizen, Strecken. Alles Inhaltliche ist
 * verschlüsselt, bevor es hier ankommt, und der Schlüssel dafür verlässt den
 * Rechner des Nutzers nie.
 *
 * Wer diese Datei und alle Daten stiehlt, hat verschlüsselte Klumpen.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  ABLAGE
 * ─────────────────────────────────────────────────────────────────────────
 *   rz-cloud.php          diese Datei
 *   rz-daten/             wird beim ersten Aufruf angelegt
 *     .htaccess           sperrt den Ordner fürs Web
 *     zugang.php          Pruefsumme des Zugangsschluessels (als .php, damit ein
 *                         Server ohne .htaccess-Unterstützung sie ausführt
 *                         statt sie auszuliefern — sie gibt dann nichts aus)
 *     archiv.json         verpackter Datenschlüssel (ohne Passwort wertlos)
 *     u/<hash>.bin        Umschläge
 *     p/<hash>.bin        Papierkorb
 *     index.json          Prüfsummen und Nummern, damit „was ist neu?" eine
 *                         einzige Anfrage ist statt tausend
 *
 * ⚠️ Der Ordner heißt bewusst `rz-daten` und liegt NEBEN dieser Datei: Auf
 * einfachem Webspace gibt es kein Verzeichnis außerhalb des Web-Wurzelordners,
 * auf das man sich verlassen könnte. Die Sperre übernimmt `.htaccess` — und
 * weil man sich darauf auf fremden Servern nicht blind verlassen kann, ist
 * zusätzlich alles verschlüsselt und der Schlüssel-Hash in einer .php-Datei.
 */

declare(strict_types=1);

// Fehler nie in die Antwort schreiben — sie würden das JSON zerstören und
// nebenbei Pfade des Servers verraten.
ini_set('display_errors', '0');
error_reporting(E_ALL);

const RZ_FORMAT      = 1;         // Formatnummer des Protokolls
const RZ_DATEN       = 'rz-daten';
const RZ_MAX_NAME    = 64;        // sha256-hex
const RZ_PAPIERKORB_TAGE_VORGABE = 30;
// Ältere Stände je Umschlag, die beim Überschreiben aufgehoben werden (22.08.2026).
const RZ_VERSIONEN = 5;

// ── Antworten ────────────────────────────────────────────────────────────

function rz_json(array $d, int $code = 200): never {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Robots-Tag: noindex, nofollow');
    echo json_encode($d, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function rz_fehler(string $text, int $code = 400): never {
    rz_json(['ok' => false, 'fehler' => $text], $code);
}

// ── Ablage ───────────────────────────────────────────────────────────────

function rz_pfad(string ...$teile): string {
    return __DIR__ . '/' . RZ_DATEN . ($teile ? '/' . implode('/', $teile) : '');
}

function rz_ablage_anlegen(): void {
    foreach ([rz_pfad(), rz_pfad('u'), rz_pfad('p')] as $d) {
        if (!is_dir($d) && !@mkdir($d, 0700, true) && !is_dir($d)) {
            rz_fehler('Der Ordner ' . RZ_DATEN . ' lässt sich nicht anlegen. '
                    . 'Fehlen die Schreibrechte?', 500);
        }
    }
    $ht = rz_pfad('.htaccess');
    if (!file_exists($ht)) {
        // Apache 2.2 und 2.4 gleichzeitig bedienen — welcher läuft, weiß man
        // auf fremdem Webspace nicht.
        @file_put_contents($ht,
            "Require all denied\n" .
            "<IfModule !mod_authz_core.c>\n  Order allow,deny\n  Deny from all\n</IfModule>\n");
    }
}

/** Atomar schreiben: erst daneben, dann umbenennen. Ein abgebrochener Upload
 *  darf niemals eine halbe Datei hinterlassen, die später als gültig gilt. */
function rz_schreiben(string $pfad, string $inhalt): bool {
    $tmp = $pfad . '.tmp' . bin2hex(random_bytes(4));
    if (@file_put_contents($tmp, $inhalt, LOCK_EX) === false) return false;
    @chmod($tmp, 0600);
    if (!@rename($tmp, $pfad)) { @unlink($tmp); return false; }
    return true;
}

// ── Index ────────────────────────────────────────────────────────────────
// Damit „was hat sich geändert?" EINE Anfrage ist. Ohne ihn müsste der Client
// für 709 Touren 709 Dateien abfragen.

function rz_index_lesen(): array {
    $p = rz_pfad('index.json');
    if (!is_file($p)) return [];
    $d = json_decode((string)@file_get_contents($p), true);
    return is_array($d) ? $d : [];
}

/** Index verändern — unter Sperre, damit zwei Geräte sich nicht überschreiben. */
function rz_index_aendern(callable $fn): array {
    $sperre = rz_pfad('index.lock');
    $fh = @fopen($sperre, 'c');
    if ($fh === false) rz_fehler('Index lässt sich nicht sperren.', 500);
    @flock($fh, LOCK_EX);
    try {
        $index = rz_index_lesen();
        $index = $fn($index);
        rz_schreiben(rz_pfad('index.json'), json_encode($index, JSON_UNESCAPED_SLASHES));
        return $index;
    } finally {
        @flock($fh, LOCK_UN);
        @fclose($fh);
    }
}

// ── Zugang ───────────────────────────────────────────────────────────────

function rz_ist_eingerichtet(): bool {
    return is_file(rz_pfad('zugang.php')) && is_file(rz_pfad('archiv.json'));
}

function rz_schluessel_hash_lesen(): ?string {
    $p = rz_pfad('zugang.php');
    if (!is_file($p)) return null;
    // Die Datei beginnt mit einer Zeile, die PHP sofort beendet; der Hash
    // steht in der zweiten. (Die Abbruch-Zeile hier nicht ausschreiben —
    // die schließende Klammer würde den PHP-Modus auch im Kommentar beenden.)
    $roh = (string)@file_get_contents($p);
    $pos = strpos($roh, "\n");
    return $pos === false ? null : trim(substr($roh, $pos + 1));
}

function rz_pruefe_zugang(): void {
    if (!rz_ist_eingerichtet()) {
        rz_fehler('Dieses Archiv ist noch nicht eingerichtet.', 409);
    }
    $soll = rz_schluessel_hash_lesen();
    $ist  = $_SERVER['HTTP_X_RZ_SCHLUESSEL'] ?? '';
    if (!$soll || !is_string($ist) || $ist === '') {
        rz_fehler('Kein Zugangsschlüssel mitgeschickt.', 401);
    }
    // hash_equals vergleicht in gleichbleibender Zeit — sonst ließe sich der
    // Schlüssel Zeichen für Zeichen erraten.
    if (!hash_equals($soll, hash('sha256', $ist))) {
        rz_fehler('Zugangsschlüssel stimmt nicht.', 403);
    }
}

// ── Namen ────────────────────────────────────────────────────────────────
// ⚠️ Der Client schickt ausschließlich sha256-Hexnamen. Alles andere wird
// abgewiesen — damit ist ein Ausbruch aus dem Ordner (`../../`) unmöglich,
// und der Server erfährt nebenbei nie, wie eine Tour heißt.

function rz_korb_datei(string $name, int $zeit): ?string {
    foreach (['.bin', '.alt.bin'] as $endung) {
        $q = rz_pfad('p', $name . '.' . $zeit . $endung);
        if (is_file($q)) return $q;
    }
    return null;
}

function rz_name_pruefen(string $name): string {
    if (!preg_match('/^[0-9a-f]{' . RZ_MAX_NAME . '}$/', $name)) {
        rz_fehler('Ungültiger Name.', 400);
    }
    return $name;
}

// ══════════════════════════════════════════════════════════════════════════
//  Aktionen
// ══════════════════════════════════════════════════════════════════════════

$was = (string)($_GET['was'] ?? '');

// ── info: ohne Zugang, damit die App überhaupt anfangen kann ──────────────
if ($was === 'info') {
    rz_json([
        'ok' => true,
        'dienst' => 'reisezoom-cloud',
        'format' => RZ_FORMAT,
        'eingerichtet' => rz_ist_eingerichtet(),
    ]);
}

// ── anlegen: genau einmal möglich ────────────────────────────────────────
if ($was === 'anlegen') {
    rz_ablage_anlegen();
    if (rz_ist_eingerichtet()) {
        // ⚠️ Ohne diese Sperre könnte ein Fremder das Archiv übernehmen,
        // indem er einfach neu einrichtet.
        rz_fehler('Dieses Archiv ist bereits eingerichtet. Zum Neuanfangen den '
                . 'Ordner ' . RZ_DATEN . ' auf dem Server löschen.', 409);
    }
    $verpackt = file_get_contents('php://input');
    if (!$verpackt || !json_decode($verpackt, true)) {
        rz_fehler('Es fehlt der verpackte Schlüssel im Rumpf der Anfrage.');
    }
    $schluessel = rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '=');
    $ok = rz_schreiben(rz_pfad('zugang.php'),
                       "<?php exit; ?>\n" . hash('sha256', $schluessel) . "\n")
       && rz_schreiben(rz_pfad('archiv.json'), $verpackt);
    if (!$ok) rz_fehler('Konnte nicht schreiben — Rechte prüfen.', 500);
    rz_index_aendern(fn(array $i) => $i);
    // Der Schlüssel wird genau hier ein einziges Mal ausgegeben.
    rz_json(['ok' => true, 'schluessel' => $schluessel, 'format' => RZ_FORMAT]);
}

// ── Ab hier: alles braucht den Zugang ────────────────────────────────────
rz_pruefe_zugang();

if ($was === 'archiv') {
    // Der verpackte Datenschlüssel — Gerät 2 holt ihn und öffnet ihn mit dem
    // Passwort. Ohne Passwort ist er wertlos.
    $roh = @file_get_contents(rz_pfad('archiv.json'));
    if ($roh === false) rz_fehler('archiv.json fehlt.', 500);
    header('Content-Type: application/json; charset=utf-8');
    echo $roh;
    exit;
}

if ($was === 'liste') {
    rz_json(['ok' => true, 'format' => RZ_FORMAT, 'eintraege' => rz_index_lesen()]);
}

if ($was === 'holen') {
    $name = rz_name_pruefen((string)($_GET['name'] ?? ''));
    $p = rz_pfad('u', $name . '.bin');
    if (!is_file($p)) rz_fehler('Nicht vorhanden.', 404);
    header('Content-Type: application/octet-stream');
    header('Content-Length: ' . (string)filesize($p));
    readfile($p);
    exit;
}

if ($was === 'legen') {
    $name  = rz_name_pruefen((string)($_GET['name'] ?? ''));
    $pruef = (string)($_GET['pruef'] ?? '');
    if (!preg_match('/^[0-9a-f]{64}$/', $pruef)) rz_fehler('Prüfsumme fehlt.');
    $inhalt = file_get_contents('php://input');
    if ($inhalt === false || $inhalt === '') rz_fehler('Leerer Umschlag.');
    if (substr($inhalt, 0, 4) !== 'RZC1') {
        // Kein Inhaltsverständnis, nur eine Plausibilitätsprüfung: Was hier
        // ankommt, muss ein Umschlag dieser App sein.
        rz_fehler('Das ist kein Umschlag dieser App.');
    }
    rz_ablage_anlegen();
    $ziel = rz_pfad('u', $name . '.bin');
    if (is_file($ziel)) {
        // Versionierung (22.08.2026): der bisherige Stand wandert als „älterer
        // Stand" in den Papierkorb, statt überschrieben zu werden. Er ist dort
        // wie ein gelöschter Eintrag wiederherstellbar; je Umschlag bleiben
        // die letzten RZ_VERSIONEN Stände, Ältere räumt die Papierkorb-Frist.
        $alt_pfad = rz_pfad('p', $name . '.' . time() . '.alt.bin');
        @rename($ziel, $alt_pfad);
        @touch($alt_pfad);   // Papierkorb-Frist läuft ab JETZT, nicht ab dem alten Upload
        $alte = glob(rz_pfad('p', $name . '.*.alt.bin')) ?: [];
        if (count($alte) > RZ_VERSIONEN) {
            sort($alte);   // Zeitstempel gleich lang → lexikalisch = chronologisch
            foreach (array_slice($alte, 0, count($alte) - RZ_VERSIONEN) as $f) @unlink($f);
        }
    }
    if (!rz_schreiben($ziel, $inhalt)) {
        rz_fehler('Konnte nicht schreiben.', 500);
    }
    $index = rz_index_aendern(function (array $i) use ($name, $pruef, $inhalt) {
        $nummer = (int)($i[$name]['nummer'] ?? 0) + 1;
        $i[$name] = ['pruef' => $pruef, 'groesse' => strlen($inhalt),
                     'zeit' => time(), 'nummer' => $nummer];
        return $i;
    });
    rz_json(['ok' => true, 'nummer' => $index[$name]['nummer']]);
}

if ($was === 'loeschen') {
    $name = rz_name_pruefen((string)($_GET['name'] ?? ''));
    $q = rz_pfad('u', $name . '.bin');
    if (is_file($q)) {
        rz_ablage_anlegen();
        // In den Papierkorb statt weg — Marc am 15.08.2026: „ja weg aber
        // papierkorb auf dem server".
        @rename($q, rz_pfad('p', $name . '.' . time() . '.bin'));
    }
    rz_index_aendern(function (array $i) use ($name) { unset($i[$name]); return $i; });
    rz_json(['ok' => true]);
}

if ($was === 'papierkorb') {
    // Aufräumen. Die Dauer bestimmt der Client (in den Einstellungen wählbar).
    $tage = (int)($_GET['tage'] ?? RZ_PAPIERKORB_TAGE_VORGABE);
    if ($tage < 1) $tage = RZ_PAPIERKORB_TAGE_VORGABE;
    $grenze = time() - $tage * 86400;
    $weg = 0;
    foreach (glob(rz_pfad('p', '*.bin')) ?: [] as $f) {
        if (@filemtime($f) < $grenze && @unlink($f)) $weg++;
    }
    rz_json(['ok' => true, 'geloescht' => $weg, 'tage' => $tage]);
}

if ($was === 'papierkorb_liste') {
    // Was liegt im Papierkorb? Nur Hex-Name + Zeitpunkt + Größe — der Server
    // kennt keine Klarnamen (Zweck der Verschlüsselung). Die App übersetzt
    // die Namen lokal zurück, soweit sie sie kennt.
    $aus = [];
    foreach (glob(rz_pfad('p', '*.bin')) ?: [] as $f) {
        $b = basename($f, '.bin');
        // Ablageform: <hexname>.<unixzeit>[.alt]  — „.alt" = älterer Stand
        $alt = false;
        if (substr($b, -4) === '.alt') { $alt = true; $b = substr($b, 0, -4); }
        $punkt = strrpos($b, '.');
        if ($punkt === false) continue;
        $aus[] = ['name' => substr($b, 0, $punkt),
                  'zeit' => (int)substr($b, $punkt + 1),
                  'groesse' => (int)@filesize($f),
                  'art' => $alt ? 'version' : 'geloescht'];
    }
    usort($aus, fn($a, $b2) => $b2['zeit'] <=> $a['zeit']);
    rz_json(['ok' => true, 'eintraege' => $aus]);
}

if ($was === 'papierkorb_holen') {
    // Einen Papierkorb-Eintrag AUSLIEFERN (verschlüsselt, wie er ist).
    // Wiederherstellen macht die App: holen → entschlüsseln/prüfen → normal
    // wieder ablegen → Eintrag hier löschen. So braucht der Server nie die
    // Prüfsumme des Klartexts zu kennen.
    $name = rz_name_pruefen((string)($_GET['name'] ?? ''));
    $zeit = (int)($_GET['zeit'] ?? 0);
    $q = rz_korb_datei($name, $zeit);
    if ($q === null) rz_fehler('Nicht im Papierkorb.', 404);
    header('Content-Type: application/octet-stream');
    readfile($q);
    exit;
}

if ($was === 'papierkorb_weg') {
    // Einen EINZELNEN Papierkorb-Eintrag endgültig löschen (nach dem
    // Wiederherstellen, oder gezielt von Hand).
    $name = rz_name_pruefen((string)($_GET['name'] ?? ''));
    $zeit = (int)($_GET['zeit'] ?? 0);
    $q = rz_korb_datei($name, $zeit);
    $weg = $q !== null && @unlink($q);
    rz_json(['ok' => true, 'geloescht' => $weg ? 1 : 0]);
}

rz_fehler('Unbekannte Aktion ' . ($was === '' ? '(keine)' : $was) . '.', 404);
