<?php
declare(strict_types=1);
require __DIR__ . '/lib.php';

header('Content-Type: application/json');
header('Cache-Control: no-store');
echo json_encode(['files' => site_manifest(site_docroot())], JSON_UNESCAPED_SLASHES);
