<?php
declare(strict_types=1);
require dirname(__DIR__) . '/_staging/lib.php';

session_start();
$me = $_SERVER['REMOTE_USER'] ?? $_SERVER['REDIRECT_REMOTE_USER'] ?? $_SERVER['PHP_AUTH_USER'] ?? 'unknown';
if (empty($_SESSION['csrf'])) {
    $_SESSION['csrf'] = bin2hex(random_bytes(16));
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!hash_equals($_SESSION['csrf'], (string) ($_POST['csrf'] ?? ''))) {
        http_response_code(400);
        exit('This form expired. Go back and reload the page.');
    }
    $action = (string) ($_POST['action'] ?? '');
    $r = match ($action) {
        'promote' => site_call('POST', '/_site/promote', ['by' => $me]),
        'rollback' => site_call('POST', '/_site/rollback', ['by' => $me, 'backup' => (string) ($_POST['backup'] ?? '')]),
        default => ['status' => 400, 'body' => ['error' => 'Unknown action']],
    };
    $_SESSION['flash'] = $r['status'] === 202
        ? 'Started. This page refreshes by itself until it finishes.'
        : 'Could not start: ' . site_error_words($r);
    header('Location: ./', true, 303);
    exit;
}

$flash = $_SESSION['flash'] ?? null;
unset($_SESSION['flash']);

$status = site_call('GET', '/_site/status');
$liveRes = site_call('GET', '/_site/manifest');
$running = $status['status'] === 200 ? $status['body']['running'] : null;

$changes = null;
$refused = [];
if ($liveRes['status'] === 200) {
    $l = array_column($liveRes['body']['files'], 'sha256', 'path');
    $sm = site_manifest(site_docroot());
    // Files the live site would refuse (and refuse the whole promote over).
    $refused = [];
    foreach ($sm as $f) {
        if (($why = site_refusal($f['path'], $f['size'])) !== null) {
            $refused[$f['path']] = $why;
        }
    }
    $s = array_diff_key(array_column($sm, 'sha256', 'path'), $refused);
    $changes = [
        'New' => array_keys(array_diff_key($s, $l)),
        'Changed' => array_keys(array_filter(array_intersect_key($s, $l), fn($h, $p) => $l[$p] !== $h, ARRAY_FILTER_USE_BOTH)),
        'Removed' => array_keys(array_diff_key($l, $s)),
    ];
}
$total = $changes ? count($changes['New']) + count($changes['Changed']) + count($changes['Removed']) : 0;
$h = fn($v) => htmlspecialchars((string) $v, ENT_QUOTES);
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<?php if ($running): ?><meta http-equiv="refresh" content="3"><?php endif; ?>
<title>Promote to dwaarai.com</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 760px; margin: 32px auto; padding: 0 16px; color: #111827; background: #f9fafb; }
  h1 { font-size: 22px; } h2 { font-size: 16px; margin-top: 28px; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; margin: 12px 0; }
  .flash { background: #ecfdf5; border-color: #a7f3d0; }
  .bad { background: #fef2f2; border-color: #fecaca; }
  button { font: inherit; padding: 10px 18px; border-radius: 8px; border: 0; cursor: pointer; }
  .go { background: #0f766e; color: #fff; font-weight: 600; } .go:disabled { opacity: .4; cursor: default; }
  .quiet { background: #fff; border: 1px solid #d1d5db; }
  ul { margin: 4px 0 0; padding-left: 20px; } li { word-break: break-all; }
  small { color: #6b7280; }
</style>
</head>
<body>
<h1>Promote staging to dwaarai.com</h1>
<p><small>Signed in as <?= $h($me) ?>.</small></p>

<?php if ($flash): ?><div class="card flash"><?= $h($flash) ?></div><?php endif; ?>

<?php if ($running): ?>
  <div class="card flash"><strong><?= $h(ucfirst($running['kind'])) ?> in progress</strong>, started by <?= $h($running['by']) ?>. This page refreshes every few seconds.</div>
<?php elseif ($changes === null): ?>
  <div class="card bad">Could not reach dwaarai.com to compare: <?= $h(site_error_words($liveRes)) ?></div>
<?php else: ?>
  <div class="card">
    <?php if ($total === 0 && !$refused): ?>
      <p>Staging and the live site are the same. Nothing to promote.</p>
    <?php elseif ($total > 0): ?>
      <p><strong><?= $total ?> file<?= $total === 1 ? '' : 's' ?></strong> will change on the live site.</p>
      <?php foreach ($changes as $label => $paths): if (!$paths) continue; ?>
        <p><?= $h($label) ?> (<?= count($paths) ?>)</p>
        <ul><?php foreach (array_slice($paths, 0, 100) as $p): ?><li><?= $h($p) ?></li><?php endforeach; ?></ul>
      <?php endforeach; ?>
    <?php endif; ?>
    <?php if ($refused): ?>
      <div class="card bad">
        <p><strong>Will be refused (<?= count($refused) ?>)</strong> — fix or delete these on staging before promoting.</p>
        <ul><?php foreach (array_slice($refused, 0, 100, true) as $p => $why): ?><li><?= $h($p) ?>: <?= $h($why) ?></li><?php endforeach; ?></ul>
      </div>
    <?php endif; ?>
    <form method="post" style="margin-top:16px">
      <input type="hidden" name="csrf" value="<?= $h($_SESSION['csrf']) ?>">
      <input type="hidden" name="action" value="promote">
      <button class="go" <?= ($total === 0 || $refused) ? 'disabled' : '' ?>>Promote to live</button>
      <small>&nbsp;The live site is backed up first.</small>
    </form>
  </div>
<?php endif; ?>

<?php if ($status['status'] === 200): ?>
  <h2>Recent history</h2>
  <?php foreach ($status['body']['log'] as $e): ?>
    <div class="card <?= $e['ok'] ? '' : 'bad' ?>">
      <strong><?= $h(ucfirst($e['kind'])) ?></strong> by <?= $h($e['by']) ?>, <?= $h(gmdate('j M Y, H:i', strtotime($e['at']))) ?> UTC.
      <?php if ($e['ok']): ?>
        <?= (int) ($e['changed'] ?? 0) ?> changed, <?= (int) ($e['removed'] ?? 0) ?> removed.
      <?php else: ?>
        Failed: <?= $h($e['error']) ?>
        <?php if (!empty($e['details'])): ?><ul><?php foreach ($e['details'] as $d): ?><li><?= $h($d) ?></li><?php endforeach; ?></ul><?php endif; ?>
      <?php endif; ?>
    </div>
  <?php endforeach; ?>

  <?php if ($status['body']['backups']): ?>
    <h2>Undo</h2>
    <p><small>Each backup is the live site just before a promote. Restoring one also backs up the current site first.</small></p>
    <?php foreach ($status['body']['backups'] as $b): ?>
      <form method="post" class="card" style="display:flex;justify-content:space-between;align-items:center">
        <span><?= $h($b) ?></span>
        <input type="hidden" name="csrf" value="<?= $h($_SESSION['csrf']) ?>">
        <input type="hidden" name="action" value="rollback">
        <input type="hidden" name="backup" value="<?= $h($b) ?>">
        <button class="quiet" <?= $running ? 'disabled' : '' ?>>Restore this</button>
      </form>
    <?php endforeach; ?>
  <?php endif; ?>
<?php endif; ?>
</body>
</html>
