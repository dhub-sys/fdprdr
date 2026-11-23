<?php

/**
 * @package     PDF Flipbook
 * @license     GNU General Public License version 2 or later
 */

\defined('_JEXEC') or die;

use Dhub\Plugin\System\PdfFlipbook\Extension\PdfFlipbook;
use Joomla\CMS\Extension\PluginInterface;
use Joomla\CMS\Factory;
use Joomla\CMS\Plugin\PluginHelper;
use Joomla\DI\Container;
use Joomla\DI\ServiceProviderInterface;

return new class () implements ServiceProviderInterface {
    public function register(Container $container): void
    {
        $container->set(
            PluginInterface::class,
            function (Container $container) {
                $plugin = new PdfFlipbook((array) PluginHelper::getPlugin('system', 'pdfflipbook'));
                $plugin->setApplication(Factory::getApplication());

                return $plugin;
            }
        );
    }
};
