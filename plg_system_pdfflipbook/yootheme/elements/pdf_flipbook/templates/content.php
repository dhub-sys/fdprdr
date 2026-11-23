<?php if (!empty($props['pdf'])) : ?>
<p><a href="<?= htmlspecialchars($props['pdf'], ENT_QUOTES, 'UTF-8') ?>"><?= htmlspecialchars($props['title'] ?: basename($props['pdf']), ENT_QUOTES, 'UTF-8') ?></a></p>
<?php endif ?>
