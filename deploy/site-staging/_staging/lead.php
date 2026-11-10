<?php
declare(strict_types=1);
require __DIR__ . '/lib.php';

// /lead on staging. The live lead mailer runs on the AWS box, so a staging
// form is relayed there with its subject marked, and sales can tell a test
// from a customer at a glance.
header('Content-Type: application/json');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo '{"success":false}';
    exit;
}
$data = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($data)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Bad form data']);
    exit;
}
$data['subject'] = '[STAGING] ' . (string) ($data['subject'] ?? 'Website enquiry');

$ch = curl_init(site_config()['live'] . '/lead');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($data),
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 20,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json'],
]);
$raw = curl_exec($ch);
$code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
curl_close($ch);
if ($raw === false) {
    http_response_code(502);
    echo json_encode(['success' => false, 'message' => 'Could not reach the live lead mailer']);
    exit;
}
http_response_code($code ?: 502);
echo $raw;
