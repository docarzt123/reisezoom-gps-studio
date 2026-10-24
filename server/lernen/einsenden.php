<?php
// GPS Studio — Logbuch-Korrekturen annehmen (24.10.2026, core/lernen.py). Erzeugt von scripts/lernen_server.py — nicht
// von Hand ändern. Angenommen werden NUR Zahlen zu einem Abschnitt und die richtige Art; keine Orte, Zeiten, Namen.
// Die IP-Adresse wird nicht gespeichert: zur Begrenzung (MAX_STUNDE Sendungen je Stunde) zählt eine Datei, deren Name
// ein Hash aus IP und Tagessalz ist; sie wird nach zwei Stunden gelöscht.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
const FORMAT = 1;
const MAX_STUNDE = 30;
const MAX_JE = 200;
$ARTEN = ["fahrt", "rad", "laufen", "gehen", "uebersetzen", "wassersport"];
$MERKMALE = ["dauer_log", "strecke_log", "tempo_mittel", "tempo_p10", "tempo_p50", "tempo_p90", "stillstand", "beschl_p90", "auf_je_km", "ab_je_km", "steil_p90", "punktabstand_s", "weg_autobahn", "weg_strasse", "weg_weg", "weg_pfad", "weg_radweg", "weg_faehre", "weg_bahn", "weg_unbekannt", "tour_wandern", "tour_rad", "tour_laufen", "tour_fahrzeug", "tour_wasser", "tour_sonst"];
function nein($code, $grund) { http_response_code($code); echo json_encode(['ok' => false, 'error' => $grund]); exit; }
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') nein(405, 'nur POST');
$roh = file_get_contents('php://input', false, null, 0, 400000);
if ($roh === false || strlen($roh) >= 400000) nein(413, 'zu groß');
$d = json_decode($roh, true);
if (!is_array($d) || ($d['format'] ?? 0) !== FORMAT || !is_array($d['beispiele'] ?? null)) nein(400, 'Format');
$ordner = __DIR__ . '/../_lernen_daten';
if (!is_dir($ordner)) @mkdir($ordner, 0750, true);
$jetzt = time();
foreach (glob($ordner . '/limit-*') ?: [] as $alt) { if ($jetzt - @filemtime($alt) > 7200) @unlink($alt); }
$h = substr(hash('sha256', date('Y-m-d') . '|gps-studio|' . ($_SERVER['REMOTE_ADDR'] ?? '')), 0, 16);
$zf = $ordner . '/limit-' . date('YmdH') . '-' . $h;
$n = (int)@file_get_contents($zf);
if ($n >= MAX_STUNDE) nein(429, 'zu viele Sendungen');
@file_put_contents($zf, (string)($n + 1));
$app = substr(preg_replace('/[^0-9.]/', '', (string)($d['app'] ?? '')), 0, 12);
$zeilen = [];
foreach (array_slice($d['beispiele'], 0, MAX_JE) as $b) {
  if (!is_array($b)) continue;
  $art = (string)($b['art'] ?? '');
  if (!in_array($art, $ARTEN, true)) continue;
  $m = $b['merkmale'] ?? null;
  if (!is_array($m)) continue;
  $ok = [];
  foreach ($MERKMALE as $k) {
    $v = $m[$k] ?? null;
    if (!is_int($v) && !is_float($v)) continue 2;
    $v = (float)$v;
    if (!is_finite($v) || abs($v) > 1e6) continue 2;
    $ok[$k] = round($v, 4);
  }
  $zeilen[] = json_encode(['f' => FORMAT, 'art' => $art, 'app' => $app, 'm' => $ok]);
}
if ($zeilen) @file_put_contents($ordner . '/' . date('Y-m') . '.jsonl', implode("\n", $zeilen) . "\n", FILE_APPEND | LOCK_EX);
echo json_encode(['ok' => true, 'angenommen' => count($zeilen)]);
