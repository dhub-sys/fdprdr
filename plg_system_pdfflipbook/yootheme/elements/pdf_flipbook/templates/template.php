<?php

use Dhub\Plugin\System\PdfFlipbook\Extension\PdfFlipbook;

if (!class_exists(PdfFlipbook::class) || empty($props['pdf'])) {
    return;
}

$html = PdfFlipbook::markup([
    'src'        => $props['pdf'],
    'title'      => $props['title'] ?? '',
    'height'     => $props['viewer_height'] ?? '',
    'mode'       => $props['layout'] ?? '',
    'cover'      => !empty($props['cover']) ? '1' : '0',
    'start'      => $props['start_page'] ?? 1,
    'download'   => !empty($props['show_download']) ? '1' : '0',
    'thumbs'     => !empty($props['show_thumbnails']) ? '1' : '0',
    'background' => $props['background'] ?? '',
    'accent'     => $props['accent'] ?? '',
]);

$el = $this->el('div');

?>
<?= $el($props, $attrs) ?>
<?= $html ?>
<?= $el->end() ?>
