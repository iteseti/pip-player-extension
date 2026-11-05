/* PiP Player — content script (release build)
 * Находит видео, добавляет кнопку PiP и открывает Document PiP окно
 * с собственными контролами.
 */
(() => {
  if (window.__pipPlayerInjected) return;
  window.__pipPlayerInjected = true;

  const BTN_ID = 'pip-player-btn';
  const PLACEHOLDER_ATTR = 'data-pip-placeholder';
  const DEFAULTS = {
    speed: 1,
    volume: null,
    pipWidth: 420,
    pipHeight: 240,
    autoButton: true,
    rememberVolume: false,
    fitMode: 'contain',
    miniMode: false
  };

  let settings = { ...DEFAULTS };
  let pipState = null;
  let applyMiniMode = null;
  let storageBroken = false;

  // безопасная обёртка: если контекст расширения инвалидирован — не падаем
  const safeStorage = {
    get(defaults, cb) {
      if (storageBroken || !chrome?.storage?.sync) { cb(defaults); return; }
      try { chrome.storage.sync.get(defaults, cb); }
      catch (_) { storageBroken = true; cb(defaults); }
    },
    set(obj) {
      if (storageBroken || !chrome?.storage?.sync) return;
      try { chrome.storage.sync.set(obj); }
      catch (_) { storageBroken = true; }
    }
  };

  safeStorage.get(DEFAULTS, (s) => { settings = { ...DEFAULTS, ...s }; });

  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const k in changes) settings[k] = changes[k].newValue;
      if (changes.miniMode && applyMiniMode) applyMiniMode(!!changes.miniMode.newValue);
    });
  }

  /* ---------- поиск видео ---------- */
  function visibleVideos() {
    return [...document.querySelectorAll('video')].filter((v) => {
      const r = v.getBoundingClientRect();
      return r.width >= 120 && r.height >= 80 && !v.dataset.pipHosted;
    });
  }

  /* ---------- плавающая кнопка ---------- */
  let btn = null;
  function ensureButton() {
    if (btn) return btn;
    btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.title = 'Картинка в картинке';
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
        <path d="M19 7h-8v6h8V7zm2-4H3C1.9 3 1 3.9 1 5v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z"/>
      </svg>`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); e.preventDefault();
      const v = btn.__video;
      if (v) openPip(v);
    });
    document.documentElement.appendChild(btn);
    return btn;
  }

  let currentHoverVideo = null;
  function videoAtPoint(x, y) {
    let best = null, bestArea = 0;
    for (const v of visibleVideos()) {
      const r = v.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        const area = r.width * r.height;
        if (area > bestArea) { bestArea = area; best = v; }
      }
    }
    return best;
  }

  let moveTimer = null;
  document.addEventListener('mousemove', (e) => {
    if (!settings.autoButton) return;
    if (moveTimer) return;
    moveTimer = setTimeout(() => { moveTimer = null; }, 100);
    const v = videoAtPoint(e.clientX, e.clientY);
    if (v) { currentHoverVideo = v; showButtonOver(v); }
    else if (currentHoverVideo) { currentHoverVideo = null; hideButtonSoon(); }
  }, true);

  let hideTimer = null;
  function hideButtonSoon() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (btn) btn.classList.remove('pip-visible'); }, 1200);
  }

  function showButtonOver(video) {
    const b = ensureButton();
    b.__video = video;
    const r = video.getBoundingClientRect();
    b.style.top = `${window.scrollY + r.top + 10}px`;
    b.style.left = `${window.scrollX + r.right - 46}px`;
    b.classList.add('pip-visible');
    clearTimeout(hideTimer);
    hideButtonSoon();
  }

  ['scroll', 'resize'].forEach((ev) =>
    window.addEventListener(ev, () => {
      if (btn && btn.classList.contains('pip-visible') && currentHoverVideo) showButtonOver(currentHoverVideo);
      if (centerBtn && centerBtn.__video && !pipState) positionCenterButton();
    }, { passive: true })
  );

  /* ---------- центральная кнопка ---------- */
  let centerBtn = null;
  let centerBtnTimer = null;

  function removeCenterPipButton() {
    clearTimeout(centerBtnTimer);
    if (centerBtn) { centerBtn.remove(); centerBtn = null; }
  }

  function positionCenterButton() {
    if (!centerBtn || !centerBtn.__video) return;
    const r = centerBtn.__video.getBoundingClientRect();
    centerBtn.style.top = `${window.scrollY + r.top + r.height / 2}px`;
    centerBtn.style.left = `${window.scrollX + r.left + r.width / 2}px`;
  }

  function showCenterPipButton(video, label = 'Открыть в окне PiP') {
    removeCenterPipButton();
    centerBtn = document.createElement('button');
    centerBtn.id = 'pip-player-center-btn';
    centerBtn.__video = video;
    centerBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true">
        <path d="M19 7h-8v6h8V7zm2-4H3C1.9 3 1 3.9 1 5v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z"/>
      </svg>
      <span>${label}</span>`;
    centerBtn.addEventListener('click', (e) => {
      e.stopPropagation(); e.preventDefault();
      const v = centerBtn?.__video || video;
      removeCenterPipButton();
      openPip(v);
    }, { once: true });
    document.documentElement.appendChild(centerBtn);
    positionCenterButton();
    centerBtnTimer = setTimeout(removeCenterPipButton, 10000);
  }

  /* ---------- toast ---------- */
  function toast(text, targetDoc) {
    const d = targetDoc || document;
    const t = d.createElement('div');
    t.textContent = text;
    if (targetDoc) {
      t.style.cssText =
        'position:fixed;bottom:56px;left:50%;transform:translateX(-50%);z-index:9999;' +
        'background:rgba(24,24,28,0.95);color:#fff;font:13px/1.4 system-ui,sans-serif;' +
        'padding:8px 14px;border-radius:10px;pointer-events:none;';
    } else {
      t.className = 'pip-player-toast';
    }
    (targetDoc ? d.body : d.documentElement).appendChild(t);
    if (!targetDoc) requestAnimationFrame(() => t.classList.add('pip-toast-visible'));
    setTimeout(() => {
      t.classList.remove('pip-toast-visible');
      setTimeout(() => t.remove(), 300);
    }, 3000);
  }

  /* ---------- CSS PiP-окна ---------- */
  const PIP_WINDOW_CSS = `
    html, body { height: 100%; }
    .pip-player-body {
      margin: 0; background: #000; overflow: hidden;
      display: flex; flex-direction: column; height: 100vh;
      overscroll-behavior: none;
    }
    .pip-stage {
      flex: 1 1 0; min-height: 0; position: relative;
      display: flex; flex-direction: column; background: #000;
      touch-action: none;
    }
    .pip-stage:fullscreen { background: #000; }
    .pip-player-video {
      flex: 1 1 0; width: 100% !important; height: 100% !important;
      min-height: 0; object-fit: contain; background: #000;
    }
    .pip-controls {
      position: absolute; left: 0; right: 0; bottom: 0; z-index: 20;
      background: linear-gradient(transparent, rgba(24, 24, 24, 0.95) 35%);
      color: #fff; padding: 14px 8px 6px;
      font: 12px/1.4 system-ui, sans-serif; user-select: none;
      opacity: 0; transition: opacity 0.2s ease;
    }
    .pip-stage.ui-show .pip-controls { opacity: 1; }
    .pip-row { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
    .pip-btn {
      background: none; border: none; color: #fff; cursor: pointer;
      padding: 4px; border-radius: 6px; display: inline-flex; align-items: center;
    }
    .pip-btn:hover { background: rgba(255, 255, 255, 0.15); }
    .pip-time { min-width: 82px; text-align: center; color: #ccc; }
    .pip-seek { width: 100%; height: 4px; accent-color: #e33; cursor: pointer; }
    .pip-volume { display: flex; align-items: center; gap: 2px; }
    .pip-volume input[type='range'] { width: 70px; accent-color: #fff; cursor: pointer; }
    .pip-speed {
      background: #2a2a2a; color: #fff; border: 1px solid #444;
      border-radius: 6px; padding: 2px 4px; cursor: pointer;
    }
    .pip-stage.pip-mini .pip-controls { display: none; }
    .pip-mini-overlay {
      position: absolute; inset: 0; z-index: 10;
      display: none; cursor: pointer;
    }
    .pip-stage.pip-mini .pip-mini-overlay { display: block; }
    .pip-mini-btns {
      position: absolute; top: 6px; right: 6px;
      display: flex; gap: 4px;
      opacity: 0; transition: opacity 0.15s ease;
      z-index: 30;
    }
    .pip-mini-overlay:hover .pip-mini-btns { opacity: 1; }
    .pip-mini-btns .pip-btn { background: rgba(0, 0, 0, 0.55); }
    .pip-mini-hint {
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 0, 0, 0.55); border-radius: 50%;
      padding: 16px; color: #fff;
      display: flex; align-items: center; justify-content: center;
      opacity: 0; pointer-events: none; transition: opacity 0.2s ease;
      z-index: 15;
    }
    .pip-mini-hint.show { opacity: 1; }
    .pip-stage.fit-cover .pip-player-video,
    .pip-stage.fit-cover .pip-mini-overlay { cursor: grab; }
    .pip-stage.fit-cover .pip-mini-overlay:active { cursor: grabbing; }
    .pip-crop-btns {
      position: absolute; top: 6px; right: 6px; z-index: 25;
      display: none; gap: 4px;
      opacity: 0; transition: opacity 0.15s ease;
    }
    .pip-stage.crop-active .pip-crop-btns { display: flex; }
    .pip-stage.crop-active:hover .pip-crop-btns { opacity: 1; }
    .pip-crop-btns .pip-btn { background: rgba(0, 0, 0, 0.55); }
  `;

  /* ---------- открытие PiP ---------- */
  let pendingMaximize = false; // переоткрыть окно сразу на весь экран
  async function openPip(video) {
    if (pipState) { closePip(); return; }

    if (!('documentPictureInPicture' in window)) {
      try {
        await video.requestPictureInPicture();
        toast('Открыт стандартный PiP (нужен Chrome 116+ для расширенных контролов)');
      } catch (err) {
        console.warn('[PiP Player] classic PiP failed:', err);
        toast('Не удалось открыть PiP: ' + (err.message || err));
      }
      return;
    }

    // размеры: обычные из настроек, либо «на весь экран» (хак для старых Chrome,
    // где resizeTo на PiP-окне запрещён, а начальный размер задать можно)
    let w = Number(settings.pipWidth) || 420;
    let h = Number(settings.pipHeight) || 240;
    const maximized = pendingMaximize;
    pendingMaximize = false;
    if (maximized) {
      w = screen.availWidth;
      h = screen.availHeight;
    }
    let pipWin;
    try {
      pipWin = await documentPictureInPicture.requestWindow({ width: w, height: h });
    } catch (err) {
      console.warn('[PiP Player] requestWindow failed:', err.name, err.message);
      if (err.name === 'NotAllowedError') {
        if (maximized) pendingMaximize = true; // сохраняем намерение до клика по кнопке
        showCenterPipButton(video, maximized ? 'Открыть на весь экран' : 'Открыть в окне PiP');
        toast(maximized
          ? 'Нажми кнопку на видео — окно откроется на весь экран'
          : 'Нажмите кнопку на видео или Alt+P — Chrome требует жест по странице');
      } else {
        toast('Не удалось открыть окно PiP: ' + (err.message || err.name || String(err)));
      }
      return;
    }

    const doc = pipWin.document;
    const styleEl = doc.createElement('style');
    styleEl.textContent = PIP_WINDOW_CSS;
    doc.head.appendChild(styleEl);
    doc.title = 'PiP Player';

    doc.body.className = 'pip-player-body';
    doc.body.style.cssText = 'margin:0;background:#000;overflow:hidden;height:100vh;display:flex;flex-direction:column;';

    // placeholder
    const placeholder = document.createElement('div');
    placeholder.setAttribute(PLACEHOLDER_ATTR, '');
    placeholder.className = 'pip-player-placeholder';
    placeholder.textContent = '▶ Видео открыто в окне «картинка в картинке»';
    const parent = video.parentNode;
    const next = video.nextSibling;
    parent.insertBefore(placeholder, video);

    // stage создаём ДО функций, которые на него ссылаются
    const stage = doc.createElement('div');
    stage.className = 'pip-stage';

    const fitModeRef = { value: settings.fitMode === 'cover' ? 'cover' : 'contain' };
    const pan = { x: 50, y: 50 };
    const crop = { x: 0, y: 0, w: 1, h: 1 };

    const forcedStyle = () => {
      if (fitModeRef.value === 'crop') {
        return 'flex:1 1 0;width:100%!important;height:100%!important;min-height:0;' +
          'object-fit:fill!important;transform-origin:0 0!important;position:static!important;' +
          'inset:auto!important;background:#000;max-width:none!important;max-height:none!important;' +
          `transform:translate(${(-crop.x / crop.w) * 100}%, ${(-crop.y / crop.h) * 100}%) scale(${1 / crop.w}, ${1 / crop.h})!important;`;
      }
      return 'flex:1 1 0;width:100%!important;height:100%!important;min-height:0;' +
        `object-fit:${fitModeRef.value}!important;object-position:${pan.x}% ${pan.y}%!important;` +
        'background:#000;position:static!important;' +
        'inset:auto!important;transform:none!important;max-width:none!important;max-height:none!important;';
    };

    let fixingAttrs = false;
    const applyStyle = () => {
      fixingAttrs = true;
      video.setAttribute('style', forcedStyle());
      fixingAttrs = false;
    };

    const origStyle = video.getAttribute('style');
    video.dataset.pipHosted = '1';
    video.classList.add('pip-player-video');
    applyStyle();
    video.removeAttribute('width');
    video.removeAttribute('height');

    const attrGuard = new MutationObserver(() => {
      if (fixingAttrs) return;
      fixingAttrs = true;
      if (video.getAttribute('style') !== forcedStyle()) video.setAttribute('style', forcedStyle());
      if (video.hasAttribute('width')) video.removeAttribute('width');
      if (video.hasAttribute('height')) video.removeAttribute('height');
      fixingAttrs = false;
    });
    attrGuard.observe(video, { attributes: true, attributeFilter: ['style', 'width', 'height'] });

    const setFitMode = (mode) => {
      fitModeRef.value = mode;
      stage.classList.toggle('fit-cover', mode === 'cover');
      applyStyle();
      safeStorage.set({ fitMode: mode });
    };
    const setCrop = (r) => {
      if (r) { Object.assign(crop, r); fitModeRef.value = 'crop'; }
      else { fitModeRef.value = settings.fitMode === 'cover' ? 'cover' : 'contain'; }
      stage.classList.toggle('fit-cover', fitModeRef.value === 'cover');
      applyStyle();
    };
    const getFitMode = () => fitModeRef.value;

    if (fitModeRef.value === 'cover') stage.classList.add('fit-cover');
    stage.appendChild(video);
    doc.body.appendChild(stage);

    const safeSpeed = Number(settings.speed);
    if (isFinite(safeSpeed) && safeSpeed > 0 && safeSpeed <= 4) video.playbackRate = safeSpeed;
    if (settings.rememberVolume && settings.volume != null) {
      const v = Number(settings.volume);
      if (isFinite(v) && v >= 0 && v <= 1) video.volume = v;
    }

    pipState = { win: pipWin, video, parent, next, placeholder, origStyle, attrGuard };
    pipWin.addEventListener('pagehide', () => restoreVideo(), { once: true });

    buildControls(pipWin, video, stage, { setFitMode, getFitMode, pan, applyStyle, setCrop });
  }

  function restoreVideo() {
    if (!pipState) return;
    const st = pipState;
    pipState = null; // ставим СРАЗУ, чтобы повторный вызов (pagehide) вышел
    applyMiniMode = null;
    try { st.attrGuard?.disconnect(); } catch (_) {}
    try {
      st.video.classList.remove('pip-player-video');
      delete st.video.dataset.pipHosted;
      if (st.origStyle) st.video.setAttribute('style', st.origStyle);
      else st.video.removeAttribute('style');
      if (st.parent && st.parent.isConnected) st.parent.insertBefore(st.video, st.next);
      st.placeholder.remove();
    } catch (err) { console.warn('[PiP Player] restore:', err); }
  }

  function closePip() {
    if (!pipState) return;
    const win = pipState.win;
    restoreVideo();
    try { win.close(); } catch (_) {}
    try { documentPictureInPicture.window?.close(); } catch (_) {}
  }

  /* ---------- переоткрытие PiP с другим размером (хак для старых Chrome) ---------- */
  async function reopenPip(maximizeIt) {
    if (!pipState) return;
    const v = pipState.video;
    const win = pipState.win;
    restoreVideo();
    try { win.close(); } catch (_) {}
    pendingMaximize = !!maximizeIt;
    await openPip(v);
    if (!pipState) return; // не открылось — на странице уже есть кнопка и подсказка
    if (maximizeIt) {
      toast('Окно развёрнуто на весь экран. Если смещено — нажми Win+↑');
    }
  }

  /* ---------- fallback: полный экран на странице (без потери видео) ---------- */
  function fullscreenOnPage() {
    if (!pipState) return;
    const { video } = pipState;

    // Сначала пытаемся запросить fullscreen, пока окно ещё открыто и есть жест.
    // Если не вышло — окно PiP остаётся, видео не теряем.
    const tryFs = (el) => {
      try {
        const p = el?.requestFullscreen?.();
        return p instanceof Promise ? p : Promise.reject(new Error('no fullscreen api'));
      } catch (e) { return Promise.reject(e); }
    };
    const target = video.closest('.html5-video-player, .video-js, .plyr, [class*="player"]') || video;
    tryFs(target)
      .catch(() => tryFs(video))
      .catch((err) => {
        console.warn('[PiP Player] fullscreen fallback failed:', err);
        toast('Не удалось развернуть на весь экран. Нажми кнопку полного экрана в плеере страницы.', pipState?.win?.document);
      });
  }

  /* ---------- контролы ---------- */
  function buildControls(pipWin, video, stage, opts = {}) {
    const doc = pipWin.document;
    const { setFitMode, getFitMode, pan, applyStyle, setCrop } = opts;

    /* --- панорамирование --- */
    let suppressClick = false;
    const clamp = (v) => Math.max(0, Math.min(100, v));
    const panOverflow = () => {
      const w = stage.clientWidth, h = stage.clientHeight;
      const vr = (video.videoWidth && video.videoHeight) ? video.videoWidth / video.videoHeight : 16 / 9;
      const cr = w / h;
      return vr > cr ? { x: vr * h - w, y: 0 } : { x: 0, y: w / vr - h };
    };
    let drag = null;
    stage.addEventListener('pointerdown', (e) => {
      if (getFitMode?.() !== 'cover') return;
      if (e.target.closest('.pip-controls, .pip-mini-btns, .pip-crop-btns')) return;
      if (e.button !== 0) return;
      e.preventDefault();
      drag = { x: e.clientX, y: e.clientY, moved: false };
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      drag.moved = true;
      suppressClick = true;
      const ov = panOverflow();
      if (pan && applyStyle) {
        if (ov.x > 0) pan.x = clamp(pan.x - (dx / ov.x) * 100);
        if (ov.y > 0) pan.y = clamp(pan.y - (dy / ov.y) * 100);
        applyStyle();
      }
      drag.x = e.clientX; drag.y = e.clientY;
    });
    const endDrag = () => {
      if (drag?.moved) setTimeout(() => { suppressClick = false; }, 0);
      else suppressClick = false;
      drag = null;
    };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);
    stage.addEventListener('dblclick', (e) => {
      if (e.target.closest('.pip-controls, .pip-mini-btns, .pip-crop-btns')) return;
      if (pan && applyStyle) { pan.x = 50; pan.y = 50; applyStyle(); }
    });

    const bar = doc.createElement('div');
    bar.className = 'pip-controls';

    // play/pause
    const playBtn = mkBtn(doc, svgPlay(), 'Пауза / воспроизведение (Space)');
    const syncPlayIcon = () => { playBtn.innerHTML = video.paused ? svgPlay() : svgPause(); };
    video.addEventListener('play', syncPlayIcon);
    video.addEventListener('pause', syncPlayIcon);
    syncPlayIcon();
    playBtn.addEventListener('click', () => (video.paused ? video.play() : video.pause()));

    // время
    const time = doc.createElement('span');
    time.className = 'pip-time';
    const fmt = (s) => {
      if (!isFinite(s)) return '--:--';
      s = Math.max(0, Math.floor(s));
      const m = Math.floor(s / 60), sec = s % 60;
      return `${m}:${String(sec).padStart(2, '0')}`;
    };
    const syncTime = () => { time.textContent = `${fmt(video.currentTime)} / ${fmt(video.duration)}`; };
    video.addEventListener('timeupdate', syncTime);
    video.addEventListener('loadedmetadata', syncTime);
    syncTime();

    // seek
    const seek = doc.createElement('input');
    seek.type = 'range';
    seek.className = 'pip-seek';
    seek.min = 0; seek.max = 1000; seek.value = 0;
    video.addEventListener('timeupdate', () => {
      if (isFinite(video.duration) && video.duration > 0)
        seek.value = Math.round((video.currentTime / video.duration) * 1000);
    });
    seek.addEventListener('input', () => {
      if (isFinite(video.duration)) video.currentTime = (seek.value / 1000) * video.duration;
    });

    // громкость (с дебаунсом записи)
    const volWrap = doc.createElement('div');
    volWrap.className = 'pip-volume';
    const muteBtn = mkBtn(doc, svgVol(video.volume, video.muted), 'Звук вкл/выкл (M)');
    const vol = doc.createElement('input');
    vol.type = 'range'; vol.min = 0; vol.max = 1; vol.step = 0.01;
    vol.value = video.muted ? 0 : video.volume;
    let volSaveTimer = null;
    const syncVol = () => {
      vol.value = video.muted ? 0 : video.volume;
      muteBtn.innerHTML = svgVol(video.volume, video.muted);
      if (settings.rememberVolume) {
        clearTimeout(volSaveTimer);
        volSaveTimer = setTimeout(() => safeStorage.set({ volume: video.volume }), 400);
      }
    };
    vol.addEventListener('input', () => { video.muted = false; video.volume = +vol.value; });
    muteBtn.addEventListener('click', () => { video.muted = !video.muted; });
    video.addEventListener('volumechange', syncVol);
    volWrap.append(muteBtn, vol);

    // скорость
    const speed = doc.createElement('select');
    speed.className = 'pip-speed';
    speed.title = 'Скорость воспроизведения';
    [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].forEach((s) => {
      const o = doc.createElement('option');
      o.value = s; o.textContent = `${s}×`;
      if (s === video.playbackRate) o.selected = true;
      speed.appendChild(o);
    });
    speed.addEventListener('change', () => {
      const val = Number(speed.value);
      if (isFinite(val) && val > 0) {
        video.playbackRate = val;
        safeStorage.set({ speed: val });
      }
    });

    // режим кадра
    const fitBtn = mkBtn(doc, '', 'Вписать / заполнить (C)');
    const syncFitIcon = () => {
      const mode = getFitMode?.() || 'contain';
      fitBtn.innerHTML = mode === 'cover' ? svgFitContain() : svgFitCover();
      fitBtn.title = mode === 'cover'
        ? 'Режим: заполнить окно — нажать, чтобы вписать (C)'
        : 'Режим: вписать — нажать, чтобы заполнить (C)';
    };
    syncFitIcon();
    fitBtn.addEventListener('click', () => {
      if (cropActive) setCropActive(false);
      const nextMode = getFitMode?.() === 'cover' ? 'contain' : 'cover';
      setFitMode?.(nextMode);
      syncFitIcon();
    });

    // кадрирование
    let cropActive = false;
    const cropBtn = mkBtn(doc, svgCrop(), 'Выбрать область видео');
    function syncCropBtn() {
      cropBtn.innerHTML = cropActive ? svgClose() : svgCrop();
      cropBtn.title = cropActive ? 'Сбросить область (показать всё видео)' : 'Выбрать область видео';
    }
    function setCropActive(on) {
      cropActive = on;
      syncCropBtn();
      stage.classList.toggle('crop-active', on);
    }
    syncCropBtn();
    cropBtn.addEventListener('click', () => {
      if (cropActive) { setCrop?.(null); setCropActive(false); }
      else startCropSelect();
    });

    function startCropSelect() {
      const sel = doc.createElement('div');
      sel.style.cssText =
        'position:absolute;inset:0;z-index:30;cursor:crosshair;' +
        'background:rgba(0,0,0,0.15);touch-action:none;user-select:none;overscroll-behavior:none;';
      stage.appendChild(sel);
      toast('Растяни рамку по нужной области видео. Esc — отмена', doc);
      let start = null, box = null;

      const contentRect = () => {
        const r = video.getBoundingClientRect();
        const vw = video.videoWidth, vh = video.videoHeight;
        if (!vw || !vh) return r;
        const mode = getFitMode?.() || 'contain';
        if (mode !== 'contain') return r;
        const vr = vw / vh, er = r.width / r.height;
        if (vr > er) {
          const h = r.width / vr;
          const top = r.top + (r.height - h) / 2;
          return { left: r.left, top, width: r.width, height: h, right: r.right, bottom: top + h };
        }
        const w = r.height * vr;
        const left = r.left + (r.width - w) / 2;
        return { left, top: r.top, width: w, height: r.height, right: left + w, bottom: r.bottom };
      };

      const block = (e) => { e.preventDefault(); e.stopPropagation(); };
      sel.addEventListener('wheel', block, { passive: false });
      sel.addEventListener('touchmove', block, { passive: false });
      sel.addEventListener('dragstart', block);
      sel.addEventListener('contextmenu', block);

      const cancel = () => {
        sel.remove();
        doc.removeEventListener('keydown', onKey, true);
      };
      const onKey = (e) => { if (e.code === 'Escape') { e.stopPropagation(); cancel(); } };
      doc.addEventListener('keydown', onKey, true);

      sel.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        start = { x: e.clientX, y: e.clientY };
        box = doc.createElement('div');
        box.style.cssText = 'position:absolute;border:2px dashed #e33;background:rgba(226,51,51,0.12);pointer-events:none;';
        sel.appendChild(box);
        try { sel.setPointerCapture(e.pointerId); } catch (_) {}
      });
      sel.addEventListener('pointermove', (e) => {
        if (!start || !box) return;
        e.preventDefault();
        const sr = sel.getBoundingClientRect();
        box.style.left = (Math.min(start.x, e.clientX) - sr.left) + 'px';
        box.style.top = (Math.min(start.y, e.clientY) - sr.top) + 'px';
        box.style.width = Math.abs(e.clientX - start.x) + 'px';
        box.style.height = Math.abs(e.clientY - start.y) + 'px';
      });
      sel.addEventListener('pointerup', (e) => {
        e.preventDefault();
        if (!start) { cancel(); return; }
        const vr = contentRect();
        const x1 = Math.max(vr.left, Math.min(start.x, e.clientX));
        const y1 = Math.max(vr.top, Math.min(start.y, e.clientY));
        const x2 = Math.min(vr.right, Math.max(start.x, e.clientX));
        const y2 = Math.min(vr.bottom, Math.max(start.y, e.clientY));
        const w = x2 - x1, h = y2 - y1;
        if (vr.width > 0 && vr.height > 0 && w / vr.width > 0.05 && h / vr.height > 0.05) {
          setCrop?.({
            x: (x1 - vr.left) / vr.width,
            y: (y1 - vr.top) / vr.height,
            w: w / vr.width,
            h: h / vr.height
          });
          setCropActive(true);
          syncFitIcon();
          toast('Область выбрана. ✕ — выход из кадрирования', doc);
        }
        cancel();
      });
    }

    /* ---- Полный экран: надёжная проверка ---- */
    let savedRect = null;
    const fsBtn = mkBtn(doc, svgFs(), 'Развернуть на весь экран (F)');

    const screenRect = () => {
      const s = pipWin.screen || window.screen;
      return {
        W: s.availWidth || s.width,
        H: s.availHeight || s.height,
        L: s.availLeft ?? 0,
        T: s.availTop ?? 0
      };
    };
    // «развёрнуто» = занимает почти весь доступный экран.
    // Сравниваем и innerWidth/Height (они надёжнее в PiP), и outer*.
    const isMaximized = () => {
      const { W, H } = screenRect();
      const iw = pipWin.innerWidth, ih = pipWin.innerHeight;
      const ow = pipWin.outerWidth, oh = pipWin.outerHeight;
      const tol = 12;
      const near = (a, b) => Math.abs(a - b) <= tol;
      return (near(iw, W) && near(ih, H)) || (near(ow, W) && near(oh, H));
    };

    const restoreSize = () => {
      if (!savedRect) return false;
      try {
        pipWin.resizeTo(savedRect.w, savedRect.h);
      } catch (_) {}
      const ok = Math.abs(pipWin.innerWidth - savedRect.w) <= 20 ||
                 Math.abs(pipWin.outerWidth - savedRect.w) <= 20;
      savedRect = null;
      return ok;
    };

    const maximize = () => {
      const { W, H, L, T } = screenRect();
      const prevW = pipWin.innerWidth || pipWin.outerWidth;
      const prevH = pipWin.innerHeight || pipWin.outerHeight;
      savedRect = { w: prevW, h: prevH };
      try { pipWin.moveTo(L, T); } catch (_) {}
      try { pipWin.resizeTo(W, H); } catch (_) {}

      setTimeout(() => {
        if (!savedRect) return; // уже восстановили/отменили
        if (isMaximized()) return;
        // fallback: resizeBy
        try { pipWin.resizeBy(W - pipWin.innerWidth, H - pipWin.innerHeight); } catch (_) {}
        setTimeout(() => {
          if (savedRect && !isMaximized()) {
            // Chrome не даёт менять размер PiP-окна — ХАК: переоткрываем окно
            // сразу с размерами на весь экран (начальный размер задавать можно).
            savedRect = null;
            toast('Переоткрываю окно на весь экран…', doc);
            reopenPip(true);
          }
        }, 220);
      }, 220);
    };

    fsBtn.addEventListener('click', () => {
      try {
        if (savedRect && isMaximized()) { restoreSize(); return; }
        if (!savedRect && isMaximized()) {
          // окно уже на весь экран (переоткрытое) — сворачиваем обратно
          // тем же способом: переоткрыть с обычным размером
          toast('Возвращаю обычный размер…', doc);
          reopenPip(false);
          return;
        }
        maximize();
      } catch (err) {
        console.warn('[PiP Player] maximize:', err);
        toast('Не удалось развернуть окно: ' + (err.message || err.name || String(err)), doc);
      }
    });

    // закрыть
    const closeBtn = mkBtn(doc, svgClose(), 'Закрыть PiP');
    closeBtn.addEventListener('click', () => pipWin.close());

    // мини-режим
    const miniBtn = mkBtn(doc, '', 'Мини-режим');
    const syncMiniIcon = (on) => {
      miniBtn.innerHTML = on ? svgMiniExit() : svgMiniEnter();
      miniBtn.title = on ? 'Показать панель контролов' : 'Мини-режим (без панели)';
    };
    const setMini = (on) => {
      stage.classList.toggle('pip-mini', on);
      syncMiniIcon(on);
      safeStorage.set({ miniMode: on });
    };
    applyMiniMode = setMini;
    miniBtn.addEventListener('click', () => setMini(!stage.classList.contains('pip-mini')));
    syncMiniIcon(!!settings.miniMode);

    // оверлей + вспышка
    const overlay = doc.createElement('div');
    overlay.className = 'pip-mini-overlay';
    const hint = doc.createElement('div');
    hint.className = 'pip-mini-hint';
    hint.innerHTML = svgPause();
    let hintTimer = null;
    const flashHint = () => {
      hint.innerHTML = video.paused ? svgPlay() : svgPause();
      hint.classList.add('show');
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => hint.classList.remove('show'), 600);
    };

    stage.addEventListener('click', (e) => {
      if (suppressClick) return;
      if (e.target.closest('.pip-controls, .pip-mini-btns, .pip-crop-btns, .pip-btn, select, input')) return;
      video.paused ? video.play() : video.pause();
      flashHint();
    });

    const miniBtns = doc.createElement('div');
    miniBtns.className = 'pip-mini-btns';
    const miniFsBtn = mkBtn(doc, svgFs(), 'Развернуть на весь экран (F)');
    miniFsBtn.addEventListener('click', (e) => { e.stopPropagation(); fsBtn.click(); });
    const miniExpandBtn = mkBtn(doc, svgMiniExit(), 'Показать панель контролов');
    miniExpandBtn.addEventListener('click', (e) => { e.stopPropagation(); setMini(false); });
    miniBtns.append(miniFsBtn, miniExpandBtn);
    overlay.append(miniBtns);
    stage.append(overlay, hint);

    // кнопки кадрирования
    const cropBtns = doc.createElement('div');
    cropBtns.className = 'pip-crop-btns';
    const cropPauseBtn = mkBtn(doc, '', 'Пауза / воспроизведение (Space)');
    const syncCropPause = () => { cropPauseBtn.innerHTML = video.paused ? svgPlay() : svgPause(); };
    video.addEventListener('play', syncCropPause);
    video.addEventListener('pause', syncCropPause);
    syncCropPause();
    cropPauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      video.paused ? video.play() : video.pause();
    });
    const cropFsBtn = mkBtn(doc, svgFs(), 'Развернуть на весь экран (F)');
    cropFsBtn.addEventListener('click', (e) => { e.stopPropagation(); fsBtn.click(); });
    const cropExitBtn = mkBtn(doc, svgClose(), 'Выйти из кадрирования');
    cropExitBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setCrop?.(null);
      setCropActive(false);
      syncFitIcon();
    });
    cropBtns.append(cropPauseBtn, cropFsBtn, cropExitBtn);
    stage.appendChild(cropBtns);

    // автоскрытие панели
    let uiTimer = null;
    const showUiBriefly = () => {
      stage.classList.add('ui-show');
      clearTimeout(uiTimer);
      uiTimer = setTimeout(() => stage.classList.remove('ui-show'), 1800);
    };
    stage.addEventListener('mousemove', showUiBriefly);
    stage.addEventListener('mouseleave', () => {
      clearTimeout(uiTimer);
      stage.classList.remove('ui-show');
    });
    showUiBriefly();

    const row1 = doc.createElement('div');
    row1.className = 'pip-row';
    row1.append(seek);
    const row2 = doc.createElement('div');
    row2.className = 'pip-row';
    row2.append(playBtn, time, volWrap, speed, fitBtn, cropBtn, fsBtn, miniBtn, closeBtn);
    bar.append(row1, row2);
    stage.appendChild(bar);

    stage.classList.toggle('pip-mini', !!settings.miniMode);

    // клавиши
    doc.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT')) return;
      switch (e.code) {
        case 'Space': e.preventDefault(); video.paused ? video.play() : video.pause(); break;
        case 'KeyM': video.muted = !video.muted; break;
        case 'KeyF': fsBtn.click(); break;
        case 'KeyC': fitBtn.click(); break;
        case 'ArrowLeft': video.currentTime -= 5; break;
        case 'ArrowRight': video.currentTime += 5; break;
        case 'ArrowUp': video.volume = Math.min(1, video.volume + 0.05); break;
        case 'ArrowDown': video.volume = Math.max(0, video.volume - 0.05); break;
      }
    });

    // размер окна
    let resizeTimer = null;
    pipWin.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        safeStorage.set({ pipWidth: pipWin.innerWidth, pipHeight: pipWin.innerHeight });
      }, 400);
    });
  }

  function mkBtn(doc, html, title) {
    const b = doc.createElement('button');
    b.className = 'pip-btn';
    b.innerHTML = html;
    b.title = title;
    return b;
  }

  /* ---------- SVG ---------- */
  const svgPlay  = () => `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
  const svgPause = () => `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
  const svgFs    = () => `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>`;
  const svgFitCover   = () => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><rect x="3" y="7" width="18" height="10" fill="currentColor" stroke="none"/></svg>`;
  const svgFitContain = () => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><rect x="6" y="9" width="12" height="6" fill="currentColor" stroke="none"/></svg>`;
  const svgClose = () => `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
  const svgCrop = () => `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M17 15h2V7c0-1.1-.9-2-2-2H9v2h8v8zM7 17V1H5v4H1v2h4v10c0 1.1.9 2 2 2h10v4h2v-4h4v-2H7z"/></svg>`;
  const svgMiniEnter = () => `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>`;
  const svgMiniExit  = () => `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6 1.41 1.41z"/></svg>`;
  const svgVol = (v, m) => {
    if (m || v === 0) return `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16.5 12A4.5 4.5 0 0 0 14 8v2.2l2.4 2.4c.06-.2.1-.4.1-.6zm2.5 0c0 .9-.2 1.8-.6 2.6l1.5 1.5A8.7 8.7 0 0 0 21 12a9 9 0 0 0-7-8.8v2.1c2.9.9 5 3.6 5 6.7zM4.3 3 3 4.3 7.7 9H3v6h4l5 5v-6.7l4.3 4.2a7 7 0 0 1-2.3 1.2v2.1a9 9 0 0 0 3.7-1.8L19.7 21 21 19.7 4.3 3zM12 4 9.9 6.1 12 8.2V4z"/></svg>`;
    if (v < 0.5) return `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M5 9v6h4l5 5V4L9 9H5zm13.5 3A4.5 4.5 0 0 0 16 8v8a4.5 4.5 0 0 0 2.5-4z"/></svg>`;
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1c2.9.9 5 3.6 5 6.7s-2.1 5.8-5 6.7v2.1a9 9 0 0 0 0-17.6z"/></svg>`;
  };

  /* ---------- сообщения ---------- */
  if (chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      try {
        if (msg.type === 'PIP_TOGGLE') {
          if (pipState) { closePip(); sendResponse({ ok: true }); return true; }
          const v = visibleVideos().find((x) => !x.paused) || visibleVideos()[0];
          if (!v) { sendResponse({ ok: false, reason: 'no-video' }); return true; }
          const noGesture = navigator.userActivation && !navigator.userActivation.isActive;
          if (noGesture && 'documentPictureInPicture' in window) {
            showCenterPipButton(v);
            toast('Нажмите кнопку на видео или Alt+P — Chrome требует жест по странице');
          } else {
            openPip(v);
          }
          sendResponse({ ok: true });
        }
        if (msg.type === 'PIP_STATUS') sendResponse({ active: !!pipState });
      } catch (err) {
        console.warn('[PiP Player] message handler:', err);
        try { sendResponse({ ok: false, reason: String(err) }); } catch (_) {}
      }
      return true;
    });
  }

  /* ---------- Alt+P ---------- */
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.code === 'KeyP') {
      const v = visibleVideos().find((x) => !x.paused) || visibleVideos()[0];
      if (pipState) closePip();
      else if (v) openPip(v);
    }
  }, true);
})();