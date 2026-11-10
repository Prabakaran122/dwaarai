<?php
declare(strict_types=1);
require __DIR__ . '/../_staging/lib.php';

$fail = 0;
function check(string $name, bool $ok): void {
    global $fail;
    echo ($ok ? 'ok   ' : 'FAIL ') . $name . "\n";
    if (!$ok) $fail++;
}

check('signature matches the Node vector',
    site_sign('test-secret', 1700000000, 'post', '/_site/promote', '{"by":"asha"}')
    === '069ff57a44f13ebbce58104ce4adbe2161b6d1e64c965358f78cfa9f09234c57');

foreach (['index.html', 'careers/index.html', 'a b.jpg'] as $p) check("path ok: $p", site_path_ok($p));
foreach (['', '/index.html', '../x.html', 'a//b', '.htaccess', 'x/.git/c', '_staging/lib.php', 'promote/index.php', "a\\b"] as $p) {
    check("path refused: $p", !site_path_ok($p));
}

$root = sys_get_temp_dir() . '/sp-php-' . bin2hex(random_bytes(4));
foreach (['index.html' => 'home', 'b/x.css' => 'x{}', '_staging/lib.php' => 'php', 'promote/index.php' => 'p',
          '.htaccess' => 'h', 'blog/.secret.txt' => 's', 'error_log' => 'e'] as $rel => $body) {
    @mkdir(dirname("$root/$rel"), 0777, true);
    file_put_contents("$root/$rel", $body);
}
$m = site_manifest($root);
check('manifest lists only promotable files', array_column($m, 'path') === ['b/x.css', 'index.html']);
check('manifest checksum', $m[1]['sha256'] === hash('sha256', 'home') && $m[1]['size'] === 4);

$ok = site_refusal('index.html', 100) === null && site_refusal('a b/Img-1.PNG', 5) === null;
check('refusal: ordinary files pass', $ok);
check('refusal: protected path', site_refusal('apps/x.html', 1) === 'managed by the app deploy, not the website'
    && site_refusal('install.html', 1) === 'managed by the app deploy, not the website');
check('refusal: .php', site_refusal('shell.php', 1) === '.php files are not allowed');
check('refusal: no extension', site_refusal('README', 1) === '.(none) files are not allowed');
check('refusal: odd character', site_refusal('My File#1.html', 1) === 'unusual characters in the name'
    && site_refusal('caf' . "\xc3\xa9" . '.html', 1) === 'unusual characters in the name');
check('refusal: oversize', site_refusal('big.mp4', 50 * 1024 * 1024 + 1) === 'larger than 50 MB'
    && site_refusal('big.mp4', 50 * 1024 * 1024) === null);

$words = fn(int $st, array $b) => site_error_words(['status' => $st, 'body' => $b]);
check('error words: signature', str_contains($words(401, ['error' => 'bad_signature']), 'check the shared secret'));
check('error words: busy', $words(409, ['error' => 'busy']) === 'Another promote or undo is already running');
check('error words: unreachable', $words(0, ['error' => 'Could not reach dwaarai.com: x']) === 'Could not reach dwaarai.com: x');
check('error words: other keeps the code', $words(500, ['error' => 'boom']) === 'boom');

echo $fail ? "\n$fail failed\n" : "\nall passed\n";
exit($fail ? 1 : 0);
