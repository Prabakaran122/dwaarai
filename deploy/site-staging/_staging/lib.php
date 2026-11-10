<?php
declare(strict_types=1);

/**
 * Staging's half of the promote. The other half is services/site-promoter on
 * the AWS box; site_sign() here and signHeader() there are tested against the
 * same vector, so they cannot drift apart unnoticed.
 */

// Never promoted. Mirrors STAGING_ONLY in services/site-promoter/src/policy.js.
const SITE_STAGING_ONLY = ['_staging/', 'promote/', 'cgi-bin/'];

// Mirror ALLOWED_EXT, PROTECTED and LIMITS in services/site-promoter/src/policy.js.
const SITE_ALLOWED_EXT = [
    'html', 'htm', 'css', 'js', 'mjs', 'json', 'txt', 'xml', 'webmanifest', 'ico',
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif',
    'woff', 'woff2', 'ttf', 'otf', 'eot',
    'pdf', 'mp4', 'webm', 'mp3', 'csv', 'md',
];
const SITE_PROTECTED = ['apps/', 'install.html', 'scripts/'];
const SITE_MAX_FILE_BYTES = 50 * 1024 * 1024;

function site_docroot(): string
{
    return dirname(__DIR__);
}

function site_config(): array
{
    static $cfg = null;
    if ($cfg === null) {
        // One level above the staging folder: outside every web root, so the
        // secret cannot be downloaded.
        $file = dirname(__DIR__, 2) . '/site-promote-config.php';
        if (!is_file($file)) {
            throw new RuntimeException('site-promote-config.php is missing next to the staging folder');
        }
        $cfg = require $file;
        foreach (['secret', 'live'] as $key) {
            if (!is_array($cfg) || !isset($cfg[$key]) || !is_string($cfg[$key]) || trim($cfg[$key]) === '') {
                $cfg = null;
                throw new RuntimeException("site-promote-config.php has no '$key' value");
            }
        }
        $cfg['live'] = rtrim($cfg['live'], '/');
    }
    return $cfg;
}

function site_sign(string $secret, int $t, string $method, string $path, string $body = ''): string
{
    return hash_hmac('sha256', $t . '.' . strtoupper($method) . '.' . $path . '.' . $body, $secret);
}

function site_path_ok(string $p): bool
{
    if ($p === '' || strlen($p) > 300 || $p[0] === '/' || str_contains($p, '\\') || str_contains($p, "\0")) {
        return false;
    }
    foreach (explode('/', $p) as $s) {
        if ($s === '' || $s === '.' || $s === '..' || $s[0] === '.') {
            return false;
        }
    }
    foreach (SITE_STAGING_ONLY as $x) {
        if (str_starts_with($p, $x)) {
            return false;
        }
    }
    return true;
}

/**
 * Why the live site would refuse this staging file, or null if it would take it.
 * Same rules and wording as isProtected + checkPath + the file size limit in
 * policy.js, so the promote page can say so before anyone presses the button.
 */
function site_refusal(string $path, int $size): ?string
{
    foreach (SITE_PROTECTED as $x) {
        if (str_ends_with($x, '/') ? str_starts_with($path, $x) : $path === $x) {
            return 'managed by the app deploy, not the website';
        }
    }
    if ($path === '') {
        return 'empty path';
    }
    if (strlen($path) > 300) {
        return 'path too long';
    }
    if ($path[0] === '/' || str_contains($path, '\\')) {
        return 'not a relative path';
    }
    $segs = explode('/', $path);
    foreach ($segs as $s) {
        if ($s === '' || $s === '.' || $s === '..') {
            return 'not a clean path';
        }
        if ($s[0] === '.') {
            return 'hidden file';
        }
        if (!preg_match('/^[\w .,()@+\-]+$/D', $s)) {
            return 'unusual characters in the name';
        }
    }
    foreach (SITE_STAGING_ONLY as $x) {
        if (str_starts_with($path, $x)) {
            return 'staging-only file';
        }
    }
    $name = end($segs);
    $ext = str_contains($name, '.') ? strtolower(substr($name, strrpos($name, '.') + 1)) : '';
    if (!in_array($ext, SITE_ALLOWED_EXT, true)) {
        return '.' . ($ext === '' ? '(none)' : $ext) . ' files are not allowed';
    }
    if ($size > SITE_MAX_FILE_BYTES) {
        return 'larger than 50 MB';
    }
    return null;
}

/** Plain words for a failed call to dwaarai.com. */
function site_error_words(array $r): string
{
    $code = (string) ($r['body']['error'] ?? '');
    if ($r['status'] === 0) {
        return $code;
    }
    if ($r['status'] === 401 || $code === 'bad_signature') {
        return 'dwaarai.com refused the request signature — check the shared secret and this server\'s clock';
    }
    if ($r['status'] === 409 || $code === 'busy') {
        return 'Another promote or undo is already running';
    }
    return $code !== '' ? $code : 'error ' . $r['status'];
}

function site_manifest(string $root): array
{
    $root = rtrim($root, '/');
    $filter = function (SplFileInfo $f) use ($root): bool {
        if ($f->isLink()) {
            return false;
        }
        $rel = substr($f->getPathname(), strlen($root) + 1);
        // A directory is tested as "<dir>/x" so the staging-only prefixes
        // ("promote/") and hidden-segment rule apply to it too.
        return $f->isDir() ? site_path_ok($rel . '/x') : (site_path_ok($rel) && basename($rel) !== 'error_log');
    };
    $it = new RecursiveIteratorIterator(new RecursiveCallbackFilterIterator(
        new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), $filter));
    $out = [];
    foreach ($it as $f) {
        if (!$f->isFile()) {
            continue;
        }
        $out[] = [
            'path' => substr($f->getPathname(), strlen($root) + 1),
            'sha256' => hash_file('sha256', $f->getPathname()),
            'size' => $f->getSize(),
        ];
    }
    usort($out, fn($a, $b) => strcmp($a['path'], $b['path']));
    return $out;
}

function site_call(string $method, string $path, ?array $payload = null): array
{
    $cfg = site_config();
    $body = $payload === null ? '' : json_encode($payload, JSON_UNESCAPED_SLASHES);
    $t = time();
    $ch = curl_init($cfg['live'] . $path);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 25,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'X-Site-Signature: t=' . $t . ',v1=' . site_sign($cfg['secret'], $t, $method, $path, $body),
        ],
    ]);
    if ($body !== '') {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($raw === false) {
        return ['status' => 0, 'body' => ['error' => "Could not reach dwaarai.com: $err"]];
    }
    return ['status' => $code, 'body' => json_decode((string) $raw, true) ?? ['error' => "Unexpected reply ($code)"]];
}
