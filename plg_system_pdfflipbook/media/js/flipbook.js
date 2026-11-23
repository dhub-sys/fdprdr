/*!
 * PDF Flipbook viewer for Joomla / YOOtheme Pro.
 * Renders PDF pages with pdf.js (Apache-2.0) and turns them like a printed publication.
 */
(function () {
  'use strict';

  var CFG = window.PDFFlipbookConfig || {};
  var T = Object.assign({
    prev: 'Previous page', next: 'Next page', first: 'First page', last: 'Last page',
    zoomIn: 'Zoom in', zoomOut: 'Zoom out', fullscreen: 'Full screen', exitFullscreen: 'Exit full screen',
    download: 'Download PDF', close: 'Close', closeEsc: 'Esc', print: 'Print', preparingPrint: 'Preparing to print…', thumbnails: 'Pages', page: 'Page', of: 'of', loading: 'Loading…',
    error: 'The document could not be loaded.', openPdf: 'Open the PDF', goToPage: 'Go to page'
  }, CFG.i18n || {});

  var ZOOMS = [1, 1.5, 2, 3, 4];
  var FLIP_MS = 750;
  // iOS limits canvas memory: keep zoomed pages smaller on touch devices.
  var MAX_CANVAS_PX = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ? 3000 * 3000 : 4096 * 4096;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var ICONS = {
    prev: '<path d="M15 4l-8 8 8 8"/>',
    next: '<path d="M9 4l8 8-8 8"/>',
    first: '<path d="M17 5l-7 7 7 7M7 5v14"/>',
    last: '<path d="M7 5l7 7-7 7M17 5v14"/>',
    zoomIn: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M10.5 7.5v6M7.5 10.5h6"/>',
    zoomOut: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M7.5 10.5h6"/>',
    fullscreen: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
    exitFullscreen: '<path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    print: '<path d="M7 9V4h10v5M7 17H4.5v-7.5h15V17H17"/><rect x="7" y="14" width="10" height="6"/>',
    thumbnails: '<rect x="4" y="4" width="6.5" height="6.5"/><rect x="13.5" y="4" width="6.5" height="6.5"/><rect x="4" y="13.5" width="6.5" height="6.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5"/>'
  };

  function icon(name) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + ICONS[name] + '</svg>';
  }

  function h(tag, cls, attrs) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (attrs) Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }

  function button(cls, name, label) {
    var b = h('button', 'pdfflip__btn ' + cls, { type: 'button', title: label, 'aria-label': label });
    b.innerHTML = icon(name);
    return b;
  }

  var pdfjsPromise = null;
  function loadPdfjs() {
    if (!pdfjsPromise) {
      pdfjsPromise = import(CFG.pdfjs).then(function (lib) {
        lib.GlobalWorkerOptions.workerSrc = CFG.worker;
        return lib;
      });
    }
    return pdfjsPromise;
  }

  /* ------------------------------------------------------------------ */

  function Flipbook(root) {
    this.root = root;
    try {
      this.opts = JSON.parse(root.getAttribute('data-pdfflip') || '{}');
    } catch (e) {
      this.opts = {};
    }
    this.zoom = 1;
    this.index = 0;
    this.spreads = [];
    this.cache = new Map();   // "page@width" -> Promise<pageEl>
    this.sizes = {};          // page -> {w, h} at scale 1
    this.anim = null;
    this.build();
  }

  Flipbook.prototype.build = function () {
    var r = this.root, o = this.opts, self = this;
    r.classList.add('pdfflip--ready');
    r.setAttribute('tabindex', '0');
    r.setAttribute('role', 'region');
    r.setAttribute('aria-roledescription', 'flipbook');
    if (o.title) r.setAttribute('aria-label', o.title);
    r.innerHTML = '';

    this.stage = h('div', 'pdfflip__stage');
    this.book = h('div', 'pdfflip__book');
    this.left = h('div', 'pdfflip__slot pdfflip__slot--left');
    this.right = h('div', 'pdfflip__slot pdfflip__slot--right');
    this.book.append(this.left, this.right);
    this.stage.append(this.book);

    this.prevBtn = button('pdfflip__nav pdfflip__nav--prev', 'prev', T.prev);
    this.nextBtn = button('pdfflip__nav pdfflip__nav--next', 'next', T.next);

    this.loader = h('div', 'pdfflip__loader');
    this.loader.innerHTML = '<span class="pdfflip__spinner"></span><span class="pdfflip__progress">' + T.loading + '</span>';

    var bar = h('div', 'pdfflip__bar');
    var groupL = h('div', 'pdfflip__group');
    var groupC = h('div', 'pdfflip__group pdfflip__group--pager');
    var groupR = h('div', 'pdfflip__group');

    this.thumbBtn = button('', 'thumbnails', T.thumbnails);
    if (o.thumbs !== false) groupL.append(this.thumbBtn);
    // The title sits in the toolbar, so the page can use the full height above it.
    if (o.title) {
      var title = h('div', 'pdfflip__title', { title: o.title });
      title.textContent = o.title;
      groupL.append(title);
    }

    this.firstBtn = button('', 'first', T.first);
    this.prevSmall = button('', 'prev', T.prev);
    this.nextSmall = button('', 'next', T.next);
    this.lastBtn = button('', 'last', T.last);
    this.pageInput = h('input', 'pdfflip__input', { type: 'text', inputmode: 'numeric', 'aria-label': T.goToPage, size: '5' });
    this.pageTotal = h('span', 'pdfflip__total');
    var pager = h('label', 'pdfflip__pager');
    pager.append(this.pageInput, this.pageTotal);
    groupC.append(this.firstBtn, this.prevSmall, pager, this.nextSmall, this.lastBtn);

    this.zoomOutBtn = button('pdfflip__zoom', 'zoomOut', T.zoomOut);
    this.zoomInBtn = button('pdfflip__zoom', 'zoomIn', T.zoomIn);
    this.fsBtn = button('pdfflip__fsbtn', 'fullscreen', T.fullscreen);
    groupR.append(this.zoomOutBtn, this.zoomInBtn, this.fsBtn);
    if (o.print !== false) {
      this.printBtn = button('', 'print', T.print);
      this.printBtn.addEventListener('click', function () { self.print(); });
      groupR.append(this.printBtn);
    }
    if (o.download !== false) {
      var dl = h('a', 'pdfflip__btn', { href: o.src, download: '', target: '_blank', rel: 'noopener', title: T.download, 'aria-label': T.download });
      dl.innerHTML = icon('download');
      groupR.append(dl);
    }
    var closePos = o.modal ? (o.close || 'top') : '';
    if (closePos === 'bar' || closePos === 'both') {
      this.closeBtn = button('pdfflip__close', 'close', T.close);
      this.closeBtn.addEventListener('click', function () { if (self.onClose) self.onClose(); });
      groupR.append(this.closeBtn);
    }
    if (closePos === 'top' || closePos === 'both') {
      // Large, always visible close button in the top right corner of the modal.
      var top = h('button', 'pdfflip__close-top', { type: 'button', title: T.close + ' (Esc)', 'aria-label': T.close });
      top.innerHTML = (o.escHint !== false ? '<span class="pdfflip__close-label">' + T.close + '</span><kbd class="pdfflip__close-kbd">' + T.closeEsc + '</kbd>' : '')
        + '<span class="pdfflip__close-icon">' + icon('close') + '</span>';
      if (o.escHint !== false) top.classList.add('pdfflip__close-top--hint');
      top.classList.add(o.closeColor === 'dark' ? 'pdfflip__close-top--dark' : 'pdfflip__close-top--light');
      top.addEventListener('click', function () { if (self.onClose) self.onClose(); });
      top.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      r.classList.add('pdfflip--close-top');
      this.closeTop = top;
    }
    bar.append(groupL, groupC, groupR);

    this.thumbs = h('div', 'pdfflip__thumbs', { 'aria-label': T.thumbnails });
    this.live = h('div', 'pdfflip__sr', { 'aria-live': 'polite' });

    r.append(this.stage, this.prevBtn, this.nextBtn, this.thumbs, bar, this.loader, this.live);
    if (this.closeTop) r.append(this.closeTop);

    this.prevBtn.addEventListener('click', function () { self.prev(); });
    this.nextBtn.addEventListener('click', function () { self.next(); });
    this.prevSmall.addEventListener('click', function () { self.prev(); });
    this.nextSmall.addEventListener('click', function () { self.next(); });
    this.firstBtn.addEventListener('click', function () { self.go(0); });
    this.lastBtn.addEventListener('click', function () { self.go(self.spreads.length - 1); });
    this.zoomInBtn.addEventListener('click', function () { self.setZoom(self.zoomStep(1)); });
    this.zoomOutBtn.addEventListener('click', function () { self.setZoom(self.zoomStep(-1)); });
    this.fsBtn.addEventListener('click', function () { self.toggleFullscreen(); });
    this.thumbBtn.addEventListener('click', function () { self.toggleThumbs(); });
    this.pageInput.addEventListener('focus', function () { this.select(); });
    this.pageInput.addEventListener('change', function () {
      var n = parseInt(this.value, 10);
      if (n > 0) self.goToPage(n); else self.updateUi();
    });
    this.pageInput.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') this.blur(); });

    r.addEventListener('keydown', function (e) { self.onKey(e); });
    this.bindPointer();

    document.addEventListener('fullscreenchange', function () { self.onFullscreenChange(); });
    document.addEventListener('webkitfullscreenchange', function () { self.onFullscreenChange(); });
  };

  Flipbook.prototype.load = function () {
    var self = this, o = this.opts;
    if (this.loading) return;
    this.loading = true;

    loadPdfjs().then(function (lib) {
      self.lib = lib;
      var task = lib.getDocument({
        url: o.src,
        cMapUrl: CFG.cmaps,
        cMapPacked: true,
        standardFontDataUrl: CFG.fonts,
        wasmUrl: CFG.wasm,
        iccUrl: CFG.iccs,
        isEvalSupported: false,
        enableScripting: false,
        disableAutoFetch: true,
        rangeChunkSize: 262144
      });
      task.onProgress = function (p) {
        if (p.total) self.loader.querySelector('.pdfflip__progress').textContent = Math.min(100, Math.round(p.loaded / p.total * 100)) + '%';
      };
      return task.promise;
    }).then(function (pdf) {
      self.pdf = pdf;
      self.pages = pdf.numPages;
      // Page-change effect only from a minimum number of pages; shorter PDFs use another (or no) effect.
      if (o.transitionMin && self.pages < o.transitionMin) o.transition = o.transitionShort || 'none';
      return pdf.getPage(1);
    }).then(function (page) {
      var vp = page.getViewport({ scale: 1 });
      self.base = { w: vp.width, h: vp.height };
      self.sizes[1] = self.base;
      self.layout(true);
      var startSpread = self.spreadOf(Math.min(self.pages, o.start || 1));
      self.index = startSpread;
      return self.show(startSpread, 0);
    }).then(function () {
      self.root.classList.add('pdfflip--loaded');
      self.observeResize();
    }).catch(function (err) {
      if (window.console) console.error('[PDF Flipbook]', err);
      self.loader.innerHTML = '<p>' + T.error + '</p><a href="' + encodeURI(o.src) + '" target="_blank" rel="noopener">' + T.openPdf + '</a>';
      self.root.classList.add('pdfflip--error');
    });
  };

  /* ---------------- layout ---------------- */

  Flipbook.prototype.isDouble = function () {
    var m = this.opts.mode || 'auto';
    if (m === 'single') return false;
    if (m === 'double') return this.stage.clientWidth >= 480;
    var w = this.stage.clientWidth, hgt = this.stage.clientHeight;
    var aspect = this.base.w / this.base.h;
    // Two pages are used when they still end up reasonably large.
    return w >= 720 && (w / 2) / hgt >= aspect * 0.62;
  };

  Flipbook.prototype.buildSpreads = function (dbl) {
    var s = [], n = this.pages, i;
    if (!dbl) {
      for (i = 1; i <= n; i++) s.push([i]);
    } else {
      i = 1;
      if (this.opts.cover !== false) { s.push([null, 1]); i = 2; }
      for (; i <= n; i += 2) s.push([i, i + 1 <= n ? i + 1 : null]);
    }
    return s;
  };

  Flipbook.prototype.spreadOf = function (page) {
    for (var i = 0; i < this.spreads.length; i++) {
      if (this.spreads[i].indexOf(page) !== -1) return i;
    }
    return 0;
  };

  Flipbook.prototype.layout = function (initial) {
    var currentPage = !initial && this.spreads.length ? this.firstPage(this.index) : null;
    var dbl = this.isDouble();
    var changed = dbl !== this.double || initial;
    this.double = dbl;
    this.root.classList.toggle('pdfflip--double', dbl);
    this.root.classList.toggle('pdfflip--single', !dbl);

    if (changed) {
      this.spreads = this.buildSpreads(dbl);
      if (currentPage) this.index = this.spreadOf(currentPage);
      this.buildThumbs();
    }

    var narrow = this.stage.clientWidth < 640;
    var padX = narrow ? 8 : 72, padY = narrow ? 8 : 14;
    var availW = Math.max(100, this.stage.clientWidth - padX * 2);
    var availH = Math.max(100, this.stage.clientHeight - padY * 2);
    var cols = dbl ? 2 : 1;
    var scale = Math.min(availW / (this.base.w * cols), availH / this.base.h);
    this.fit = scale;
    this.pageW = Math.floor(this.base.w * scale);
    this.pageH = Math.floor(this.base.h * scale);
    this.applySize();
  };

  Flipbook.prototype.applySize = function () {
    var cols = this.double ? 2 : 1;
    var w = this.pageW * this.zoom, hh = this.pageH * this.zoom;
    this.book.style.width = (w * cols) + 'px';
    this.book.style.height = hh + 'px';
    this.root.classList.toggle('pdfflip--zoomed', this.zoom > 1);
  };

  Flipbook.prototype.renderWidth = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    return Math.round(this.pageW * this.zoom * dpr);
  };

  Flipbook.prototype.observeResize = function () {
    var self = this, timer;
    if (!window.ResizeObserver) {
      window.addEventListener('resize', function () { clearTimeout(timer); timer = setTimeout(function () { self.relayout(); }, 150); });
      return;
    }
    var last = this.stage.clientWidth + 'x' + this.stage.clientHeight;
    this.ro = new ResizeObserver(function () {
      var now = self.stage.clientWidth + 'x' + self.stage.clientHeight;
      if (now === last) return;
      last = now;
      clearTimeout(timer);
      timer = setTimeout(function () { self.relayout(); }, 150);
    });
    this.ro.observe(this.stage);
  };

  Flipbook.prototype.destroy = function () {
    this.destroyed = true;
    this.token = (this.token || 0) + 1;
    this.finishAnimation();
    if (this.ro) this.ro.disconnect();
    if (this.thumbObserver) this.thumbObserver.disconnect();
    this.cache.clear();
    if (this.pdf) this.pdf.destroy();
    this.pdf = null;
  };

  Flipbook.prototype.relayout = function () {
    if (!this.pdf) return;
    this.finishAnimation();
    this.layout(false);
    this.show(this.index, 0);
  };

  /* ---------------- rendering ---------------- */

  Flipbook.prototype.pageEl = function (num) {
    var width = this.renderWidth();
    var key = num + '@' + width;
    if (this.cache.has(key)) return this.cache.get(key);
    var self = this;

    var p = this.pdf.getPage(num).then(function (page) {
      var vp1 = page.getViewport({ scale: 1 });
      self.sizes[num] = { w: vp1.width, h: vp1.height };
      var scale = width / vp1.width;
      if (vp1.width * scale * vp1.height * scale > MAX_CANVAS_PX) scale = Math.sqrt(MAX_CANVAS_PX / (vp1.width * vp1.height));
      var vp = page.getViewport({ scale: scale });

      var el = h('div', 'pdfflip__page');
      el.setAttribute('data-page', num);
      var canvas = h('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      el.append(canvas);

      var ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      return page.render({ canvas: canvas, canvasContext: ctx, viewport: vp, annotationMode: self.lib.AnnotationMode.ENABLE_FORMS }).promise
        .then(function () { return self.addLinks(page, vp1, el); })
        .then(function () { return el; });
    });

    this.cache.set(key, p);
    p.catch(function () { self.cache.delete(key); });
    this.trimCache();
    return p;
  };

  Flipbook.prototype.trimCache = function () {
    var max = 16;
    while (this.cache.size > max) {
      var oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
  };

  // Clickable links from the PDF (web links and links to other pages).
  Flipbook.prototype.addLinks = function (page, vp1, el) {
    var self = this;
    return page.getAnnotations({ intent: 'display' }).then(function (annots) {
      annots.forEach(function (a) {
        if (a.subtype !== 'Link' || !a.rect || (!a.url && !a.dest)) return;
        var r = vp1.convertToViewportRectangle(a.rect);
        var x = Math.min(r[0], r[2]), y = Math.min(r[1], r[3]);
        var w = Math.abs(r[2] - r[0]), hh = Math.abs(r[3] - r[1]);
        var link = h('a', 'pdfflip__link');
        link.style.left = (x / vp1.width * 100) + '%';
        link.style.top = (y / vp1.height * 100) + '%';
        link.style.width = (w / vp1.width * 100) + '%';
        link.style.height = (hh / vp1.height * 100) + '%';
        if (a.url) {
          link.href = a.url;
          link.target = '_blank';
          link.rel = 'noopener';
        } else {
          link.href = '#';
          link.addEventListener('click', function (e) {
            e.preventDefault();
            self.goToDest(a.dest);
          });
        }
        link.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
        el.append(link);
      });
    }).catch(function () {});
  };

  Flipbook.prototype.goToDest = function (dest) {
    var self = this;
    var p = typeof dest === 'string' ? this.pdf.getDestination(dest) : Promise.resolve(dest);
    p.then(function (d) {
      if (!d || !d.length) return;
      var ref = d[0];
      return (typeof ref === 'number' ? Promise.resolve(ref) : self.pdf.getPageIndex(ref)).then(function (i) {
        self.goToPage(i + 1);
      });
    }).catch(function () {});
  };

  /* ---------------- showing & flipping ---------------- */

  Flipbook.prototype.firstPage = function (i) {
    var s = this.spreads[i] || [];
    return s[0] || s[1] || 1;
  };

  Flipbook.prototype.spreadEls = function (i) {
    var self = this;
    return Promise.all(this.spreads[i].map(function (n) { return n ? self.pageEl(n) : null; }));
  };

  Flipbook.prototype.place = function (slot, el) {
    slot.innerHTML = '';
    if (el) slot.append(el);
    slot.classList.toggle('pdfflip__slot--empty', !el);
  };

  // Shifts a lone cover (or back page) to the middle, like a closed book.
  Flipbook.prototype.shiftFor = function (spread) {
    if (!this.double) return 0;
    if (!spread[0] && spread[1]) return -25;
    if (spread[0] && !spread[1]) return 25;
    return 0;
  };

  Flipbook.prototype.show = function (i, dir) {
    var self = this;
    i = Math.max(0, Math.min(this.spreads.length - 1, i));
    var from = this.index;
    this.index = i;
    this.updateUi();
    var token = this.token = (this.token || 0) + 1;

    return this.spreadEls(i).then(function (els) {
      if (token !== self.token) return;
      self.loader.hidden = true;
      var spread = self.spreads[i];
      var animate = dir && !reduceMotion && self.zoom === 1 && from !== i;

      // flip (3D, two-page spreads only) | slide | fade | none
      var tr = self.opts.transition || 'flip';

      if (animate && self.double && tr === 'flip') {
        self.flip(dir, els, spread);
      } else {
        self.finishAnimation();
        if (self.double) {
          self.place(self.left, els[0]);
          self.place(self.right, els[1]);
        } else {
          self.place(self.left, els[0]);
          self.place(self.right, null);
        }
        self.book.style.transform = 'translateX(' + self.shiftFor(spread) + '%)';
        if (animate && tr !== 'none') {
          var frames = tr === 'fade'
            ? [{ opacity: 0 }, { opacity: 1 }]
            : [{ opacity: 0, transform: 'translateX(' + (dir * 40) + 'px)' }, { opacity: 1, transform: 'none' }];
          (self.double ? [self.left, self.right] : [self.left]).forEach(function (slot) {
            if (slot.animate) slot.animate(frames, { duration: tr === 'fade' ? 320 : 280, easing: 'ease-out' });
          });
        }
      }
      self.preload(i);
    });
  };

  Flipbook.prototype.flip = function (dir, els, spread) {
    var self = this;
    this.finishAnimation();

    var oldLeft = this.left.firstChild, oldRight = this.right.firstChild;
    var leaf = h('div', 'pdfflip__leaf pdfflip__leaf--' + (dir > 0 ? 'next' : 'prev'));
    leaf.style.setProperty('--pdfflip-flip', FLIP_MS + 'ms');
    var front = h('div', 'pdfflip__face pdfflip__face--front');
    var back = h('div', 'pdfflip__face pdfflip__face--back');
    leaf.append(front, back);

    var turning, revealed;
    if (dir > 0) {
      // The right page turns over to the left; the new right page is underneath.
      turning = oldRight;
      revealed = els[0];
      if (turning) front.append(turning);
      if (revealed) back.append(revealed);
      this.place(this.right, els[1]);
    } else {
      turning = oldLeft;
      revealed = els[1];
      if (turning) front.append(turning);
      if (revealed) back.append(revealed);
      this.place(this.left, els[0]);
    }
    front.classList.toggle('pdfflip__face--blank', !turning);
    back.classList.toggle('pdfflip__face--blank', !revealed);
    this.book.append(leaf);

    var shift = this.shiftFor(spread);
    this.book.style.transition = 'transform ' + FLIP_MS + 'ms cubic-bezier(.4,.1,.2,1)';
    this.book.style.transform = 'translateX(' + shift + '%)';

    var to = dir > 0 ? -180 : 180;
    var done = function () {
      if (self.anim !== state) return;
      self.anim = null;
      leaf.remove();
      self.book.style.transition = '';
      if (dir > 0) self.place(self.left, els[0]);
      else self.place(self.right, els[1]);
    };
    var state = { done: done, anim: null };
    this.anim = state;

    if (leaf.animate) {
      state.anim = leaf.animate([
        { transform: 'rotateY(0deg)' },
        { transform: 'rotateY(' + to + 'deg)' }
      ], { duration: FLIP_MS, easing: 'cubic-bezier(.45,.05,.35,1)', fill: 'forwards' });
      state.anim.onfinish = done;
    } else {
      setTimeout(done, 0);
    }
  };

  Flipbook.prototype.finishAnimation = function () {
    if (this.anim) {
      var s = this.anim;
      if (s.anim) s.anim.finish();
      s.done();
    }
  };

  Flipbook.prototype.preload = function (i) {
    var self = this;
    [i + 1, i - 1, i + 2].forEach(function (j) {
      if (j >= 0 && j < self.spreads.length) self.spreadEls(j).catch(function () {});
    });
  };

  Flipbook.prototype.go = function (i) {
    if (!this.pdf || i === this.index) return;
    this.show(i, i > this.index ? 1 : -1);
  };
  Flipbook.prototype.next = function () { if (this.index < this.spreads.length - 1) this.go(this.index + 1); };
  Flipbook.prototype.prev = function () { if (this.index > 0) this.go(this.index - 1); };
  Flipbook.prototype.goToPage = function (n) {
    n = Math.max(1, Math.min(this.pages, n));
    this.go(this.spreadOf(n));
    this.updateUi();
  };

  Flipbook.prototype.updateUi = function () {
    if (!this.spreads.length) return;
    var s = this.spreads[this.index].filter(Boolean);
    var label = s.length > 1 ? s[0] + '–' + s[1] : String(s[0]);
    this.pageInput.value = label;
    this.pageInput.size = Math.max(2, label.length + 1);
    this.pageTotal.textContent = ' / ' + this.pages;
    var atStart = this.index === 0, atEnd = this.index === this.spreads.length - 1;
    this.prevBtn.disabled = this.prevSmall.disabled = this.firstBtn.disabled = atStart;
    this.nextBtn.disabled = this.nextSmall.disabled = this.lastBtn.disabled = atEnd;
    this.zoomOutBtn.disabled = this.zoom <= ZOOMS[0];
    this.zoomInBtn.disabled = this.zoom >= ZOOMS[ZOOMS.length - 1];
    this.live.textContent = T.page + ' ' + label + ' ' + T.of + ' ' + this.pages;

    var self = this;
    Array.prototype.forEach.call(this.thumbs.children, function (t) {
      var on = s.indexOf(+t.getAttribute('data-page')) !== -1;
      t.classList.toggle('pdfflip__thumb--active', on);
      if (on && self.root.classList.contains('pdfflip--thumbs')) {
        t.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
      }
    });
  };

  /* ---------------- zoom ---------------- */

  Flipbook.prototype.zoomStep = function (d) {
    var z = this.zoom, i;
    if (d > 0) {
      for (i = 0; i < ZOOMS.length; i++) if (ZOOMS[i] > z + 0.01) return ZOOMS[i];
      return ZOOMS[ZOOMS.length - 1];
    }
    for (i = ZOOMS.length - 1; i >= 0; i--) if (ZOOMS[i] < z - 0.01) return ZOOMS[i];
    return ZOOMS[0];
  };

  // Position (0–1) inside the book of a point given in client coordinates.
  Flipbook.prototype.bookPoint = function (cx, cy) {
    var b = this.book.getBoundingClientRect();
    return { fx: (cx - b.left) / b.width, fy: (cy - b.top) / b.height };
  };

  // Zooms so that the book point (fx, fy) ends up under the client point (cx, cy).
  Flipbook.prototype.zoomAt = function (z, fx, fy, cx, cy) {
    var st = this.stage;
    this.zoom = z;
    this.book.style.transform = 'translateX(' + this.shiftFor(this.spreads[this.index]) + '%)';
    this.applySize();
    var b = this.book.getBoundingClientRect();
    st.scrollLeft += (b.left + fx * b.width) - cx;
    st.scrollTop += (b.top + fy * b.height) - cy;
  };

  Flipbook.prototype.setZoom = function (z, cx, cy, live) {
    z = Math.max(ZOOMS[0], Math.min(ZOOMS[ZOOMS.length - 1], z));
    if (!this.pdf || Math.abs(z - this.zoom) < 0.001) return;
    this.finishAnimation();
    var rect = this.stage.getBoundingClientRect();
    if (cx === undefined) { cx = rect.left + rect.width / 2; cy = rect.top + rect.height / 2; }
    var pt = this.bookPoint(cx, cy);
    this.zoomAt(z, pt.fx, pt.fy, cx, cy);
    this.updateUi();
    if (!live) this.rerenderSoon();
  };

  // Sharp pages for the new zoom level once zooming has stopped.
  Flipbook.prototype.rerenderSoon = function () {
    var self = this;
    clearTimeout(this.zoomTimer);
    this.zoomTimer = setTimeout(function () {
      var width = '@' + self.renderWidth();
      self.cache.forEach(function (v, k) { if (k.slice(k.indexOf('@')) !== width) self.cache.delete(k); });
      self.show(self.index, 0);
    }, 250);
  };

  /* ---------------- input ---------------- */

  Flipbook.prototype.onKey = function (e) {
    if (e.target && /^(input|textarea|select)$/i.test(e.target.tagName)) return;
    var k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown') { this.next(); e.preventDefault(); }
    else if (k === 'ArrowLeft' || k === 'PageUp') { this.prev(); e.preventDefault(); }
    else if (k === 'Home') { this.go(0); e.preventDefault(); }
    else if (k === 'End') { this.go(this.spreads.length - 1); e.preventDefault(); }
    else if (k === '+' || k === '=') { this.setZoom(this.zoomStep(1)); e.preventDefault(); }
    else if (k === '-') { this.setZoom(this.zoomStep(-1)); e.preventDefault(); }
    else if (k === 'Escape' && this.root.classList.contains('pdfflip--fs-fallback')) { this.toggleFullscreen(); }
    else if (k === 'Escape' && this.onClose) { this.onClose(); }
  };

  Flipbook.prototype.bindPointer = function () {
    var self = this, st = this.stage, start = null, lastTap = 0;
    var pointers = new Map(), pinch = null, afterPinch = false, inertia = 0;

    var stopInertia = function () { cancelAnimationFrame(inertia); inertia = 0; };
    var pageZoomed = function () { return window.visualViewport && window.visualViewport.scale > 1.01; };

    st.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      stopInertia();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (e.pointerType !== 'mouse' || self.zoom > 1) {
        try { st.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      }

      if (pointers.size === 2 && self.pdf) {
        // Two fingers: pinch to zoom inside the viewer.
        var pts = Array.from(pointers.values());
        var mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2;
        var pt = self.bookPoint(mx, my);
        pinch = { d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1, z: self.zoom, fx: pt.fx, fy: pt.fy };
        self.finishAnimation();
        start = null;
        afterPinch = true;
        return;
      }
      if (pointers.size > 1) return;
      afterPinch = false;
      start = { x: e.clientX, y: e.clientY, sl: st.scrollLeft, st: st.scrollTop, moved: false, id: e.pointerId, type: e.pointerType, track: [{ x: e.clientX, y: e.clientY, t: performance.now() }] };
      if (self.zoom > 1) st.classList.add('pdfflip__stage--drag');
    });

    st.addEventListener('pointermove', function (e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pinch && pointers.size >= 2) {
        e.preventDefault();
        var pts = Array.from(pointers.values());
        var d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        var mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2;
        var z = Math.max(1, Math.min(ZOOMS[ZOOMS.length - 1], pinch.z * d / pinch.d));
        // Zoom around the fingers and follow them when they move together.
        self.zoomAt(z, pinch.fx, pinch.fy, mx, my);
        return;
      }

      if (!start || e.pointerId !== start.id) return;
      var dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) start.moved = true;
      if (self.zoom > 1) {
        // One finger (or the mouse) moves the zoomed page.
        e.preventDefault();
        st.scrollLeft = start.sl - dx;
        st.scrollTop = start.st - dy;
        start.track.push({ x: e.clientX, y: e.clientY, t: performance.now() });
        if (start.track.length > 5) start.track.shift();
      }
    });

    var end = function (e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      st.classList.remove('pdfflip__stage--drag');

      if (pinch) {
        if (pointers.size < 2) {
          pinch = null;
          if (self.zoom < 1.08) self.setZoom(1); else { self.updateUi(); self.rerenderSoon(); }
        }
        return;
      }
      if (afterPinch) { if (!pointers.size) afterPinch = false; return; }
      if (!start || e.pointerId !== start.id) return;
      var s = start;
      start = null;
      var dx = e.clientX - s.x, dy = e.clientY - s.y;

      // Flick: the zoomed page keeps gliding for a moment.
      if (self.zoom > 1 && s.moved && s.type !== 'mouse' && e.type !== 'pointercancel') {
        var a = s.track[0], b = s.track[s.track.length - 1], dt = Math.max(1, b.t - a.t);
        var cap = function (v) { return Math.max(-50, Math.min(50, v)); };
        var vx = cap((b.x - a.x) / dt * 16), vy = cap((b.y - a.y) / dt * 16);
        var step = function () {
          vx *= 0.94; vy *= 0.94;
          st.scrollLeft -= vx; st.scrollTop -= vy;
          if (Math.abs(vx) > 0.4 || Math.abs(vy) > 0.4) inertia = requestAnimationFrame(step);
        };
        if (performance.now() - b.t < 80) inertia = requestAnimationFrame(step);
        return;
      }

      if (self.zoom === 1 && !pageZoomed() && s.type !== 'mouse' && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        if (dx < 0) self.next(); else self.prev();
        return;
      }
      if (s.moved || e.type === 'pointercancel') return;

      // Double click / double tap toggles zoom.
      var now = Date.now();
      if (now - lastTap < 300) {
        lastTap = 0;
        clearTimeout(self.tapTimer);
        self.setZoom(self.zoom > 1 ? 1 : 2.5, e.clientX, e.clientY);
        return;
      }
      lastTap = now;

      if (self.zoom > 1) return;
      // A single click on a page turns it, like Adobe Publish Online.
      var target = e.target, x = e.clientX;
      self.tapTimer = setTimeout(function () {
        // Modal: a click on the empty area around the pages closes it (if enabled).
        if (self.onClose && self.opts.backdropClose && !self.book.contains(target)) {
          self.onClose();
          return;
        }
        if (!self.double) {
          if (!self.left.contains(target)) return;
          var r = self.left.getBoundingClientRect();
          if (x < r.left + r.width / 3) self.prev(); else self.next();
        } else if (self.left.contains(target)) self.prev();
        else if (self.right.contains(target)) self.next();
      }, 260);
    };
    st.addEventListener('pointerup', end);
    st.addEventListener('pointercancel', end);

    // Ctrl + wheel and trackpad pinch.
    st.addEventListener('wheel', function (e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      self.setZoom(self.zoom * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    }, { passive: false });

    // Safari's own pinch gesture events: keep them from zooming the whole web page.
    st.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    st.addEventListener('gesturechange', function (e) { e.preventDefault(); });
  };

  /* ---------------- thumbnails ---------------- */

  Flipbook.prototype.buildThumbs = function () {
    var self = this;
    if (this.opts.thumbs === false) return;
    if (this.thumbObserver) this.thumbObserver.disconnect();
    this.thumbs.innerHTML = '';

    var io = window.IntersectionObserver ? new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        self.renderThumb(en.target);
      });
    }, { root: this.thumbs, rootMargin: '0px 300px' }) : null;
    this.thumbObserver = io;

    this.spreads.forEach(function (spread) {
      spread.forEach(function (n, idx) {
        if (!n) return;
        var t = h('button', 'pdfflip__thumb', { type: 'button', 'data-page': n, 'aria-label': T.page + ' ' + n });
        if (self.double && spread.length === 2 && spread[0] && spread[1]) t.classList.add(idx === 0 ? 'pdfflip__thumb--l' : 'pdfflip__thumb--r');
        t.innerHTML = '<span class="pdfflip__thumb-img"></span><span class="pdfflip__thumb-num">' + n + '</span>';
        t.addEventListener('click', function () { self.goToPage(n); });
        self.thumbs.append(t);
        if (io) io.observe(t); else self.renderThumb(t);
      });
    });
  };

  Flipbook.prototype.renderThumb = function (t) {
    var n = +t.getAttribute('data-page');
    if (t.getAttribute('data-done')) return;
    t.setAttribute('data-done', '1');
    this.pdf.getPage(n).then(function (page) {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var vp1 = page.getViewport({ scale: 1 });
      var vp = page.getViewport({ scale: 96 * dpr / vp1.height });
      var c = h('canvas');
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      var ctx = c.getContext('2d', { alpha: false });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      return page.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise.then(function () {
        t.querySelector('.pdfflip__thumb-img').append(c);
      });
    }).catch(function () { t.removeAttribute('data-done'); });
  };

  Flipbook.prototype.toggleThumbs = function () {
    var on = this.root.classList.toggle('pdfflip--thumbs');
    this.thumbBtn.classList.toggle('pdfflip__btn--active', on);
    this.thumbBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) this.updateUi();
  };

  /* ---------------- print ---------------- */

  var isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // Prints only the PDF: every page is rendered to an image inside a hidden iframe, which is then printed.
  Flipbook.prototype.print = function () {
    var self = this, pdf = this.pdf;
    if (!pdf || this.printing) return;

    // iOS Safari cannot print a single iframe; its own PDF viewer prints the document instead.
    if (isIOS) {
      window.open(this.opts.src, '_blank', 'noopener');
      return;
    }

    this.printing = true;
    this.printBtn.disabled = true;
    var status = this.loader.querySelector('.pdfflip__progress');
    var progress = function (n) {
      if (status) status.textContent = T.preparingPrint + ' ' + n + ' / ' + pdf.numPages;
    };
    this.loader.hidden = false;
    this.root.classList.add('pdfflip--printing');
    progress(0);

    var DPI = 180, urls = [], first = null;
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d', { alpha: false });

    var renderPage = function (n) {
      return pdf.getPage(n).then(function (page) {
        var vp1 = page.getViewport({ scale: 1 });
        if (!first) first = vp1;
        var scale = DPI / 72;
        if (vp1.width * vp1.height * scale * scale > MAX_CANVAS_PX) scale = Math.sqrt(MAX_CANVAS_PX / (vp1.width * vp1.height));
        var vp = page.getViewport({ scale: scale });
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return page.render({ canvas: canvas, canvasContext: ctx, viewport: vp, intent: 'print', annotationMode: self.lib.AnnotationMode.ENABLE_STORAGE }).promise;
      }).then(function () {
        return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', 0.92); });
      }).then(function (blob) {
        urls.push(URL.createObjectURL(blob));
        progress(n);
      });
    };

    var chain = Promise.resolve();
    for (var i = 1; i <= pdf.numPages; i++) chain = chain.then(renderPage.bind(null, i));

    var cleanup = function (frame) {
      setTimeout(function () {
        if (frame) frame.remove();
        urls.forEach(function (u) { URL.revokeObjectURL(u); });
      }, 1000);
    };
    var finish = function () {
      self.printing = false;
      self.printBtn.disabled = false;
      self.loader.hidden = true;
      self.root.classList.remove('pdfflip--printing');
      if (status) status.textContent = '';
    };

    chain.then(function () {
      var frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
      document.body.append(frame);
      var doc = frame.contentDocument;
      var landscape = first && first.width > first.height;
      doc.open();
      doc.write('<!doctype html><html><head><meta charset="utf-8"><title>' + (self.opts.title || '').replace(/</g, '&lt;') + '</title><style>'
        + '@page{size:' + (first ? first.width + 'pt ' + first.height + 'pt' : (landscape ? 'landscape' : 'auto')) + ';margin:0}'
        + 'html,body{margin:0;padding:0;background:#fff}'
        + 'img{display:block;width:100%;height:100vh;object-fit:contain;break-after:page;page-break-after:always}'
        + 'img:last-child{break-after:auto;page-break-after:auto}'
        + '</style></head><body>' + urls.map(function (u) { return '<img src="' + u + '" alt="">'; }).join('') + '</body></html>');
      doc.close();
      var imgs = Array.prototype.slice.call(doc.images);
      return Promise.all(imgs.map(function (img) {
        return img.decode ? img.decode().catch(function () {}) : Promise.resolve();
      })).then(function () {
        finish();
        var win = frame.contentWindow;
        win.addEventListener('afterprint', function () { cleanup(frame); });
        win.focus();
        win.print();
        // Fallback cleanup for browsers that do not fire afterprint.
        setTimeout(function () { cleanup(frame); }, 120000);
      });
    }).catch(function (err) {
      if (window.console) console.error('[PDF Flipbook] print', err);
      finish();
      cleanup(null);
      window.open(self.opts.src, '_blank', 'noopener');
    });
  };

  /* ---------------- fullscreen ---------------- */

  Flipbook.prototype.isFullscreen = function () {
    return (document.fullscreenElement || document.webkitFullscreenElement) === this.root
      || this.root.classList.contains('pdfflip--fs-fallback');
  };

  Flipbook.prototype.toggleFullscreen = function () {
    var r = this.root;
    if (this.isFullscreen()) {
      if (r.classList.contains('pdfflip--fs-fallback')) {
        r.classList.remove('pdfflip--fs-fallback');
        document.documentElement.classList.remove('pdfflip-lock');
        this.onFullscreenChange();
      } else if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
      return;
    }
    var req = r.requestFullscreen || r.webkitRequestFullscreen;
    if (req) {
      try {
        var p = req.call(r);
        if (p && p.catch) p.catch(this.fallbackFullscreen.bind(this));
        return;
      } catch (e) { /* fall through */ }
    }
    this.fallbackFullscreen();
  };

  // iPhone Safari has no element fullscreen: cover the window instead.
  Flipbook.prototype.fallbackFullscreen = function () {
    if (this.opts.modal) return; // the modal already covers the window
    this.root.classList.add('pdfflip--fs-fallback');
    document.documentElement.classList.add('pdfflip-lock');
    this.onFullscreenChange();
  };

  Flipbook.prototype.onFullscreenChange = function () {
    if (this.destroyed || !this.root.isConnected) return;
    var fs = this.isFullscreen();
    this.root.classList.toggle('pdfflip--fs', fs);
    this.fsBtn.innerHTML = icon(fs ? 'exitFullscreen' : 'fullscreen');
    var label = fs ? T.exitFullscreen : T.fullscreen;
    this.fsBtn.title = label;
    this.fsBtn.setAttribute('aria-label', label);
    if (fs) this.root.focus({ preventScroll: true });
    if (this.pdf) this.relayout();
  };

  /* ------------------------------------------------------------------ */

  var lazy = window.IntersectionObserver ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      lazy.unobserve(en.target);
      en.target.pdfflip.load();
    });
  }, { rootMargin: '400px 0px' }) : null;

  function init(scope) {
    var nodes = (scope || document).querySelectorAll ? (scope || document).querySelectorAll('.pdfflip[data-pdfflip]') : [];
    if (scope && scope.matches && scope.matches('.pdfflip[data-pdfflip]')) nodes = [scope];
    Array.prototype.forEach.call(nodes, function (el) {
      if (el.pdfflip) return;
      el.pdfflip = new Flipbook(el);
      if (lazy) lazy.observe(el); else el.pdfflip.load();
    });
    fitScreens();
  }

  /* ---------------- fit to screen height ---------------- */

  function visible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  // Height of the site's sticky header (YOOtheme Pro, Cassiopeia or any fixed/sticky <header>).
  function headerOffset() {
    var max = 0;
    var sel = '.tm-header [uk-sticky], .tm-header-mobile [uk-sticky], .tm-header[uk-sticky], .tm-header-mobile[uk-sticky],'
      + ' .tm-header, .tm-header-mobile, header, .uk-navbar-container';
    Array.prototype.forEach.call(document.querySelectorAll(sel), function (el) {
      if (!visible(el) || el.closest('.pdfflip')) return;
      var pos = window.getComputedStyle(el).position;
      var sticky = el.hasAttribute('uk-sticky') || pos === 'fixed' || pos === 'sticky';
      if (!sticky) return;
      if (pos === 'fixed' && el.getBoundingClientRect().top > 5) return;
      max = Math.max(max, el.offsetHeight);
    });
    return Math.min(max, Math.round(window.innerHeight * 0.4));
  }

  function fitScreens() {
    var roots = document.querySelectorAll('.pdfflip--screen');
    if (!roots.length) return;
    var off = headerOffset() + 'px';
    Array.prototype.forEach.call(roots, function (r) {
      if (r.style.getPropertyValue('--pdfflip-offset') !== off) r.style.setProperty('--pdfflip-offset', off);
    });
  }

  var fitTimer;
  function fitSoon() { clearTimeout(fitTimer); fitTimer = setTimeout(fitScreens, 120); }
  window.addEventListener('resize', fitSoon);
  window.addEventListener('orientationchange', fitSoon);
  window.addEventListener('load', fitScreens);

  /* ---------------- links to PDFs open in a full-screen modal ---------------- */

  var modal = null;

  function linkOptions(a, url) {
    var d = a.dataset, o = {};
    var text = (a.getAttribute('title') || a.textContent || '').replace(/\s+/g, ' ').trim();
    var file = decodeURIComponent(url.pathname.split('/').pop() || '');
    o.title = d.pdfflipTitle || (text && text.length <= 120 ? text : file);
    if (d.pdfflipMode) o.mode = d.pdfflipMode;
    if (d.pdfflipCover) o.cover = d.pdfflipCover !== '0';
    var page = d.pdfflipStart || (/(?:^|&)page=(\d+)/.exec(url.hash.slice(1)) || [])[1];
    if (page) o.start = parseInt(page, 10) || 1;
    return o;
  }

  function openModal(src, opts, trigger) {
    closeModal(true);
    var D = CFG.defaults || {};
    var M = CFG.modalOptions || {};
    var o = Object.assign({
      mode: D.mode || 'auto', cover: D.cover !== false, start: 1, transition: D.transition || 'flip',
      download: D.download !== false, print: D.print !== false, thumbs: true,
      close: M.close || 'top', closeColor: M.closeColor || 'light', escHint: M.escHint !== false, backdropClose: !!M.backdropClose,
      transitionMin: D.transitionMin || 0, transitionShort: D.transitionShort || 'none'
    }, opts, { src: src, modal: true });

    var overlay = h('div', 'pdfflip-overlay', { role: 'dialog', 'aria-modal': 'true' });
    if (o.title) overlay.setAttribute('aria-label', o.title);
    // Background colour with opacity, and a blur of the web page behind it.
    var bg = withAlpha(M.color || '#111111', M.opacity === undefined ? 85 : M.opacity);
    overlay.style.background = bg;
    var blur = parseInt(M.blur === undefined ? 8 : M.blur, 10) || 0;
    if (blur > 0) {
      overlay.style.setProperty('-webkit-backdrop-filter', 'blur(' + blur + 'px)');
      overlay.style.setProperty('backdrop-filter', 'blur(' + blur + 'px)');
    }
    var root = h('div', 'pdfflip pdfflip--modal');
    root.setAttribute('data-pdfflip', JSON.stringify(o));
    root.style.setProperty('--pdfflip-bg', bg);
    if (D.accent) root.style.setProperty('--pdfflip-accent', D.accent);
    overlay.append(root);

    var fb = root.pdfflip = new Flipbook(root); // set before insertion, so auto-init skips it
    fb.onClose = function () { closeModal(false); };
    document.body.append(overlay);
    document.documentElement.classList.add('pdfflip-lock');

    modal = { overlay: overlay, fb: fb, trigger: trigger, pushed: false };
    document.addEventListener('keydown', onModalKey, true);
    // The phone's Back button closes the modal instead of leaving the page.
    try { history.pushState({ pdfflipModal: true }, ''); modal.pushed = true; } catch (e) { /* ignore */ }

    requestAnimationFrame(function () { overlay.classList.add('pdfflip-overlay--open'); });
    root.focus({ preventScroll: true });
    fb.load();
  }

  function closeModal(fromHistory) {
    if (!modal) return;
    var m = modal;
    modal = null;
    var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl && m.overlay.contains(fsEl)) {
      try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) { /* ignore */ }
    }
    document.removeEventListener('keydown', onModalKey, true);
    m.fb.destroy();
    m.overlay.remove();
    document.documentElement.classList.remove('pdfflip-lock');
    if (m.pushed && !fromHistory) history.back();
    if (m.trigger && m.trigger.focus) m.trigger.focus({ preventScroll: true });
  }

  // Esc closes the modal wherever the focus is (but first leaves real fullscreen, which the browser handles).
  function onModalKey(e) {
    if (e.key !== 'Escape' || !modal) return;
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    e.preventDefault();
    e.stopPropagation();
    closeModal(false);
  }

  // '#rrggbb' / '#rgb' + opacity 0–100 → rgba(); other colour formats use color-mix().
  function withAlpha(color, opacity) {
    var a = Math.max(0, Math.min(100, Number(opacity))) / 100;
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
    if (m) {
      var hex = m[1].length === 3 ? m[1].replace(/(.)/g, '$1$1') : m[1];
      var n = parseInt(hex, 16);
      return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
    }
    return 'color-mix(in srgb, ' + color + ' ' + (a * 100) + '%, transparent)';
  }

  window.addEventListener('popstate', function () { if (modal) closeModal(true); });

  // Which links open in the modal: CFG.modal = 'all' (every PDF link to this site), 'class' (only links
  // with, or inside an element with, the class "pdfflip-modal"), or 'off'.
  function modalTarget(a) {
    var mode = CFG.modal || 'class';
    if (mode === 'off' || a.hasAttribute('download') || a.closest('.pdfflip, .pdfflip-ignore')) return null;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#') return null;
    var url;
    try { url = new URL(href, location.href); } catch (e) { return null; }
    if (!/^https?:$/.test(url.protocol)) return null;
    var isPdf = /\.pdf$/i.test(url.pathname);
    var optIn = a.closest('.pdfflip-modal');
    if (a.hasAttribute('data-pdfflip-modal') || (optIn && isPdf)) return url;
    if (mode === 'all' && isPdf && url.origin === location.origin) return url;
    return null;
  }

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var url = modalTarget(a);
    if (!url) return;
    e.preventDefault();
    e.stopPropagation(); // keep UIkit lightboxes or other scripts from opening it as well
    var src = url.href.replace(/#.*$/, '');
    openModal(src, linkOptions(a, url), a);
  }, true);

  window.PDFFlipbook = { init: init, fit: fitScreens, open: function (src, opts) { openModal(src, opts || {}, null); }, close: function () { closeModal(false); } };

  function start() {
    init(document);
    // Flipbooks added later (YOOtheme customizer preview, AJAX content, modals).
    if (window.MutationObserver) {
      new MutationObserver(function (muts) {
        muts.forEach(function (m) {
          Array.prototype.forEach.call(m.addedNodes, function (n) { if (n.nodeType === 1) init(n); });
        });
      }).observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
