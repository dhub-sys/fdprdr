<?php

/**
 * @package     PDF Flipbook
 * @license     GNU General Public License version 2 or later
 */

namespace Dhub\Plugin\System\PdfFlipbook\Extension;

use Joomla\CMS\Language\Text;
use Joomla\CMS\Plugin\CMSPlugin;
use Joomla\CMS\Uri\Uri;
use Joomla\Event\SubscriberInterface;
use Joomla\Registry\Registry;

\defined('_JEXEC') or die;

/**
 * Embeds PDF files as a page-turning flipbook.
 *
 * - Registers the "PDF Flipbook" element in the YOOtheme Pro page builder. The element lives inside this
 *   plugin, so YOOtheme Pro and Joomla updates never touch it.
 * - Replaces {pdfflipbook src="images/file.pdf"} shortcodes anywhere in the rendered page.
 * - Loads the viewer assets only on pages that contain a flipbook.
 */
final class PdfFlipbook extends CMSPlugin implements SubscriberInterface
{
    public const MEDIA = 'media/plg_system_pdfflipbook';

    protected $autoloadLanguage = true;

    /** Plugin parameters shared with the YOOtheme element template. */
    private static ?Registry $settings = null;

    public static function getSubscribedEvents(): array
    {
        return [
            'onAfterInitialise' => 'onAfterInitialise',
            'onAfterRender'     => 'onAfterRender',
        ];
    }

    public function onAfterInitialise(): void
    {
        self::$settings = $this->params;

        // Register the YOOtheme Pro builder element (only when YOOtheme Pro is installed and loaded).
        if (class_exists(\YOOtheme\Application::class)) {
            \YOOtheme\Application::getInstance()->load(\dirname(__DIR__, 2) . '/yootheme/bootstrap.php');
        }
    }

    public function onAfterRender(): void
    {
        $app = $this->getApplication();

        if (!$app->isClient('site') || $app->getDocument()?->getType() !== 'html') {
            return;
        }

        $body = $app->getBody();

        if (str_contains($body, '{pdfflipbook')) {
            $body = $this->replaceShortcodes($body);
        }

        $modal  = (string) $this->params->get('modal_links', 'all');
        $needed = preg_match('#class="pdfflip[" ]#', $body) === 1
            || ($modal !== 'off' && (str_contains($body, 'pdfflip-modal') || str_contains($body, 'data-pdfflip-modal')))
            || ($modal === 'all' && preg_match('#href=["\'][^"\']+\.pdf(?:[?\#][^"\']*)?["\']#i', $body) === 1)
            || (bool) $this->params->get('always_load', 0)
            || self::isYoothemeCustomizer();

        if ($needed && !str_contains($body, 'id="pdfflip-config"') && stripos($body, '</head>') !== false) {
            $body = preg_replace('#</head>#i', $this->assetTags() . "\n</head>", $body, 1);
        }

        $app->setBody($body);
    }

    /**
     * Returns the viewer markup. Used by the shortcode and the YOOtheme element.
     *
     * @param  array  $options  src, title, height, mode (auto|double|single), cover, start, download, print, thumbs,
     *                          background, accent
     */
    public static function markup(array $options): string
    {
        $defaults = self::$settings ?? new Registry();
        $src      = self::resolveUrl((string) ($options['src'] ?? ''));

        if ($src === '') {
            return '';
        }

        $bool = static function ($value, $default): bool {
            if ($value === null || $value === '') {
                return (bool) $default;
            }

            return !\in_array(strtolower((string) $value), ['0', 'false', 'no', 'off'], true);
        };

        $mode = strtolower((string) ($options['mode'] ?? ''));
        $mode = \in_array($mode, ['auto', 'double', 'single'], true) ? $mode : $defaults->get('mode', 'auto');

        $config = [
            'src'      => $src,
            'title'    => trim((string) ($options['title'] ?? '')),
            'mode'     => $mode,
            'cover'    => $bool($options['cover'] ?? null, $defaults->get('cover', 1)),
            'start'    => max(1, (int) ($options['start'] ?? 1)),
            'download' => $bool($options['download'] ?? null, $defaults->get('download', 1)),
            'print'    => $bool($options['print'] ?? null, $defaults->get('print', 1)),
            'thumbs'   => $bool($options['thumbs'] ?? null, 1),
            'transition' => self::transition((string) ($options['transition'] ?? ''), (string) $defaults->get('transition', 'flip')),
            'transitionMin'   => max(0, (int) (($options['transition_min'] ?? '') !== '' ? $options['transition_min'] : $defaults->get('transition_min', 0))),
            'transitionShort' => self::transition((string) ($options['transition_short'] ?? ''), (string) $defaults->get('transition_short', 'none')),
        ];

        $height = self::cssLength((string) ($options['height'] ?? ''), (string) $defaults->get('height', 'screen'));

        $style = [
            '--pdfflip-height:' . ($height === 'screen' ? '100vh' : $height),
            '--pdfflip-bg:' . self::cssColor((string) ($options['background'] ?? ''), (string) $defaults->get('background', '#2b2b2b')),
            '--pdfflip-accent:' . self::cssColor((string) ($options['accent'] ?? ''), (string) $defaults->get('accent', '#ffffff')),
        ];

        $label = $config['title'] !== '' ? $config['title'] : Text::_('PLG_SYSTEM_PDFFLIPBOOK_OPEN_PDF');
        $json  = json_encode($config, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        // "screen": the viewer fills the screen height below the site's sticky header (set by flipbook.js).
        $class = $height === 'screen' ? 'pdfflip pdfflip--screen' : 'pdfflip';

        return '<div class="' . $class . '" data-pdfflip="' . htmlspecialchars($json, ENT_QUOTES, 'UTF-8') . '"'
            . ' style="' . htmlspecialchars(implode(';', $style), ENT_QUOTES, 'UTF-8') . '">'
            . '<a class="pdfflip__fallback" href="' . htmlspecialchars($src, ENT_QUOTES, 'UTF-8') . '" target="_blank" rel="noopener">'
            . htmlspecialchars($label, ENT_QUOTES, 'UTF-8') . '</a>'
            . '</div>';
    }

    /** Replaces {pdfflipbook ...} shortcodes, but never inside <textarea> (e.g. front-end editors). */
    private function replaceShortcodes(string $body): string
    {
        $parts = preg_split('#(<textarea\b.*?</textarea>)#is', $body, -1, PREG_SPLIT_DELIM_CAPTURE);

        foreach ($parts as $i => $part) {
            if ($i % 2 === 1 || !str_contains($part, '{pdfflipbook')) {
                continue;
            }

            // An editor usually wraps a shortcode on its own line in <p>…</p>; drop that wrapper.
            $parts[$i] = preg_replace_callback(
                '#(?:<p[^>]*>\s*)?\{pdfflipbook\s+([^}]*)\}(?:\s*</p>)?#i',
                static function (array $match): string {
                    $attributes = html_entity_decode(strip_tags($match[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8');
                    $options    = [];

                    preg_match_all('#([a-z_]+)\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|(\S+))#i', $attributes, $pairs, PREG_SET_ORDER);

                    foreach ($pairs as $pair) {
                        $options[strtolower($pair[1])] = $pair[2] !== '' ? $pair[2] : (($pair[3] ?? '') !== '' ? $pair[3] : ($pair[4] ?? ''));
                    }

                    // Keep an unbalanced <p> intact if only one side of it was matched.
                    $prefix = '';
                    $suffix = '';

                    if (preg_match('#^<p#i', $match[0]) && !preg_match('#</p>$#i', $match[0])) {
                        preg_match('#^<p[^>]*>\s*#i', $match[0], $open);
                        $prefix = $open[0];
                    } elseif (!preg_match('#^<p#i', $match[0]) && preg_match('#</p>$#i', $match[0])) {
                        $suffix = '</p>';
                    }

                    return $prefix . PdfFlipbook::markup($options) . $suffix;
                },
                $part
            );
        }

        return implode('', $parts);
    }

    private function assetTags(): string
    {
        $base    = Uri::root(true) . '/' . self::MEDIA;
        $version = @filemtime(JPATH_ROOT . '/' . self::MEDIA . '/js/flipbook.js') ?: '1';

        $keys = [
            'prev', 'next', 'first', 'last', 'zoomIn', 'zoomOut', 'fullscreen', 'exitFullscreen',
            'download', 'close', 'closeEsc', 'print', 'preparingPrint', 'thumbnails', 'page', 'of', 'loading', 'error', 'openPdf', 'goToPage',
        ];
        $i18n = [];

        foreach ($keys as $key) {
            $i18n[$key] = Text::_('PLG_SYSTEM_PDFFLIPBOOK_JS_' . strtoupper($key));
        }

        $config = [
            'pdfjs'  => $base . '/vendor/pdfjs/pdf.min.js?v=' . $version,
            'worker' => $base . '/vendor/pdfjs/pdf.worker.min.js?v=' . $version,
            'cmaps'  => $base . '/vendor/pdfjs/cmaps/',
            'fonts'  => $base . '/vendor/pdfjs/standard_fonts/',
            'wasm'   => $base . '/vendor/pdfjs/wasm/',
            'iccs'   => $base . '/vendor/pdfjs/iccs/',
            'i18n'   => $i18n,
            'modal'  => (string) $this->params->get('modal_links', 'all'),
            'modalOptions' => [
                'close'         => \in_array($this->params->get('modal_close', 'top'), ['top', 'bar', 'both'], true) ? $this->params->get('modal_close', 'top') : 'top',
                'closeColor'    => $this->params->get('modal_close_color', 'light') === 'dark' ? 'dark' : 'light',
                'escHint'       => (bool) $this->params->get('modal_esc_hint', 1),
                'backdropClose' => (bool) $this->params->get('modal_backdrop_close', 0),
                'color'         => self::cssColor('', (string) $this->params->get('modal_color', '#111111')),
                'opacity'       => max(0, min(100, (int) $this->params->get('modal_opacity', 85))),
                'blur'          => max(0, min(40, (int) $this->params->get('modal_blur', 8))),
            ],
            'defaults' => [
                'mode'       => (string) $this->params->get('mode', 'auto'),
                'transition' => self::transition('', (string) $this->params->get('transition', 'flip')),
                'transitionMin'   => max(0, (int) $this->params->get('transition_min', 0)),
                'transitionShort' => self::transition('', (string) $this->params->get('transition_short', 'none')),
                'cover'      => (bool) $this->params->get('cover', 1),
                'download'   => (bool) $this->params->get('download', 1),
                'print'      => (bool) $this->params->get('print', 1),
                'background' => self::cssColor('', (string) $this->params->get('background', '#2b2b2b')),
                'accent'     => self::cssColor('', (string) $this->params->get('accent', '#ffffff')),
            ],
        ];

        $json = json_encode($config, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP);

        return '<link rel="stylesheet" href="' . $base . '/css/flipbook.css?v=' . $version . '">' . "\n"
            . '<script id="pdfflip-config">window.PDFFlipbookConfig=' . $json . ';</script>' . "\n"
            . '<script src="' . $base . '/js/flipbook.js?v=' . $version . '" defer></script>';
    }

    private static function resolveUrl(string $url): string
    {
        $url = trim(html_entity_decode($url, ENT_QUOTES | ENT_HTML5, 'UTF-8'));

        // Joomla media field values may carry an adapter suffix: images/file.pdf#joomlaImage://local-images/...
        $url = preg_replace('/#joomlaImage:.*$/', '', $url);

        if ($url === '' || preg_match('#^(javascript|data|vbscript):#i', $url)) {
            return '';
        }

        if (preg_match('#^(https?:)?//#i', $url) || str_starts_with($url, '/')) {
            return $url;
        }

        return Uri::root() . ltrim(preg_replace('#^\./#', '', $url), '/');
    }

    private static function cssLength(string $value, string $default): string
    {
        foreach ([strtolower(trim($value)), strtolower(trim($default))] as $candidate) {
            if (\in_array($candidate, ['screen', 'auto', 'fit'], true)) {
                return 'screen';
            }

            if (preg_match('/^\d+(\.\d+)?$/', $candidate)) {
                return $candidate . 'px';
            }

            if (preg_match('/^\d+(\.\d+)?(px|vh|svh|dvh|vw|em|rem|%)$/', $candidate)) {
                return $candidate;
            }
        }

        return 'screen';
    }

    private static function transition(string $value, string $default): string
    {
        foreach ([strtolower(trim($value)), strtolower(trim($default))] as $candidate) {
            if (\in_array($candidate, ['flip', 'slide', 'fade', 'none'], true)) {
                return $candidate;
            }
        }

        return 'flip';
    }

    private static function cssColor(string $value, string $default): string
    {
        foreach ([trim($value), trim($default)] as $candidate) {
            if (preg_match('/^#[0-9a-f]{3,8}$/i', $candidate) || preg_match('/^(rgb|hsl)a?\([0-9.,%\s\/]+\)$/i', $candidate)) {
                return $candidate;
            }
        }

        return '#2b2b2b';
    }

    private static function isYoothemeCustomizer(): bool
    {
        try {
            if (\function_exists('YOOtheme\app') && class_exists(\YOOtheme\Config::class)) {
                $config = \YOOtheme\app(\YOOtheme\Config::class);

                return (bool) $config('app.isCustomizer');
            }
        } catch (\Throwable $e) {
        }

        return false;
    }
}
