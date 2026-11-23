<?php

/**
 * YOOtheme Pro module: registers the "PDF Flipbook" builder element.
 *
 * The element is shipped inside the plg_system_pdfflipbook plugin, so updating YOOtheme Pro or Joomla
 * never overwrites it.
 */

use YOOtheme\Builder;

return [
    'extend' => [
        Builder::class => function (Builder $builder) {
            $builder->addTypePath(__DIR__ . '/elements/*/element.json');
        },
    ],
];
