<?php
declare(strict_types=1);
require __DIR__ . '/lib.php';

// Raw bytes of one site file, for the promoter. Read through PHP rather than
// fetched by URL so .htaccess redirects (/index.html -> /) never get in the way.
$p = (string) ($_GET['p'] ?? '');
$root = realpath(site_docroot());
$full = site_path_ok($p) ? realpath($root . '/' . $p) : false;
if ($full === false || !str_starts_with($full, $root . '/') || !is_file($full) || is_link($root . '/' . $p)) {
    http_response_code(404);
    exit;
}
header('Content-Type: application/octet-stream');
header('Content-Length: ' . filesize($full));
header('Cache-Control: no-store');
readfile($full);
