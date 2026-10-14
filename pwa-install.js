// ─── Bannière d'installation PWA ───────────────────────────────────
// Reprise de Rikiki : bannière discrète sur mobile tant que l'app n'est pas
// installée, masquée 30 jours après un refus, guide illustré iOS / Android.
// Autonome : styles et HTML injectés, réglages lus sur la balise <script>.
//   data-app     nom affiché          data-key   préfixe localStorage
//   data-icon    icône 192 px         data-accent couleur principale
//   data-font    police des titres    data-sub-fr / data-sub-en  sous-titre
(function () {
  const cfg = document.currentScript.dataset;
  const APP = cfg.app;
  const DISMISS_KEY = `${cfg.key}.install.dismissedUntil`;
  let deferredPrompt = null;  // rempli par `beforeinstallprompt` (Chrome Android)

  const TEXTS = {
    fr: {
      title: `Installer ${APP}`,
      sub: cfg.subFr || 'Accès rapide depuis votre écran d\'accueil',
      cta: 'Installer',
      close: 'Fermer',
      guideTitle: 'Installer l\'app',
      intro: `Ajoutez ${APP} à votre écran d'accueil pour l'ouvrir en un geste, comme une vraie app.`,
      ios: [
        ['Appuyez sur le bouton de partage', 'L\'icône carrée avec une flèche vers le haut, en bas de l\'écran (en haut sur iPad).'],
        ['Touchez « En voir plus »', 'Sous la rangée d\'applications, en bas du menu de partage.'],
        ['Choisissez « Sur l\'écran d\'accueil »', 'Dans la liste d\'actions qui s\'ouvre, faites défiler si besoin.'],
        ['Appuyez sur « Ajouter »', `L'icône ${APP} apparaît sur votre écran d'accueil.`],
      ],
      android: [
        ['Ouvrez le menu du navigateur', 'Les trois points (⋮) en haut à droite.'],
        ['Sélectionnez « Installer l\'application »', 'Ou « Ajouter à l\'écran d\'accueil » selon le navigateur.'],
        ['Confirmez l\'installation', `L'icône ${APP} apparaît sur votre écran d'accueil.`],
      ],
      more: 'En voir plus',
      home: 'Sur l\'écran d\'accueil',
      install: 'Installer l\'application',
      why: ['Ouverture instantanée depuis l\'écran d\'accueil', 'Plein écran, sans la barre du navigateur'],
      now: 'Installer maintenant',
    },
    en: {
      title: `Install ${APP}`,
      sub: cfg.subEn || 'Quick access from your home screen',
      cta: 'Install',
      close: 'Close',
      guideTitle: 'Install the app',
      intro: `Add ${APP} to your home screen to open it in one tap, like a real app.`,
      ios: [
        ['Tap the share button', 'The square icon with an up arrow, at the bottom of the screen (top on iPad).'],
        ['Tap "View More"', 'Below the row of apps, at the bottom of the share menu.'],
        ['Choose "Add to Home Screen"', 'In the list of actions that opens, scroll if needed.'],
        ['Tap "Add"', `The ${APP} icon appears on your home screen.`],
      ],
      android: [
        ['Open the browser menu', 'The three dots (⋮) at the top right.'],
        ['Select "Install app"', 'Or "Add to Home screen" depending on the browser.'],
        ['Confirm the installation', `The ${APP} icon appears on your home screen.`],
      ],
      more: 'View More',
      home: 'Add to Home Screen',
      install: 'Install app',
      why: ['Opens instantly from your home screen', 'Full screen, without the browser bar'],
      now: 'Install now',
    },
  };

  function lang() {
    const l = typeof window.getLang === 'function' ? window.getLang() : 'fr';
    return TEXTS[l] ? l : 'fr';
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  }

  function isDismissed() {
    try {
      return Date.now() < parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
    } catch (e) {
      return false;
    }
  }

  function rememberDismissal(ms) {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now() + ms)); } catch (e) { /* noop */ }
  }

  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

  // Illustrations : barre d'adresse, menu de partage, ligne d'action.
  const ILLU = {
    shareBar: () => `<svg viewBox="0 0 220 56"><rect x="2" y="6" width="216" height="44" rx="22" class="pwa-bar"/><text x="96" y="33" text-anchor="middle" class="pwa-t">${esc(location.host)}</text><g transform="translate(184, 15)"><circle cx="13" cy="13" r="18" fill="none" class="pwa-ring"/><path d="M13 4 L13 18 M7 10 L13 4 L19 10 M5 14 L5 22 L21 22 L21 14" class="pwa-ic"/></g></svg>`,
    more: label => `<svg viewBox="0 0 220 50"><rect x="2" y="4" width="216" height="42" rx="10" class="pwa-sheet"/><circle cx="30" cy="25" r="13" fill="none" class="pwa-ring"/><circle cx="24" cy="25" r="1.8" class="pwa-dot"/><circle cx="30" cy="25" r="1.8" class="pwa-dot"/><circle cx="36" cy="25" r="1.8" class="pwa-dot"/><text x="54" y="30" class="pwa-t pwa-strong">${esc(label)}</text></svg>`,
    home: label => `<svg viewBox="0 0 220 50"><rect x="2" y="4" width="216" height="42" rx="10" class="pwa-sheet"/><text x="16" y="30" class="pwa-t pwa-strong">${esc(label)}</text><g transform="translate(184, 13)"><rect x="0" y="0" width="22" height="22" rx="5" fill="none" class="pwa-ic"/><path d="M11 5 L11 17 M5 11 L17 11" class="pwa-ic"/></g></svg>`,
    menuBar: () => `<svg viewBox="0 0 220 56"><rect x="2" y="6" width="216" height="44" rx="22" class="pwa-bar"/><text x="100" y="33" text-anchor="middle" class="pwa-t">${esc(location.host)}</text><circle cx="197" cy="28" r="15" fill="none" class="pwa-ring"/><circle cx="197" cy="21" r="2.2" class="pwa-dot"/><circle cx="197" cy="28" r="2.2" class="pwa-dot"/><circle cx="197" cy="35" r="2.2" class="pwa-dot"/></svg>`,
    install: label => `<svg viewBox="0 0 220 50"><rect x="2" y="4" width="216" height="42" rx="10" class="pwa-sheet"/><g transform="translate(16, 14)"><rect x="0" y="0" width="14" height="22" rx="3" fill="none" class="pwa-ic"/><path d="M7 6 L7 15 M3.5 11.5 L7 15 L10.5 11.5" class="pwa-ic"/></g><text x="42" y="30" class="pwa-t pwa-strong">${esc(label)}</text></svg>`,
  };

  function steps(list, illus) {
    return list.map(([title, text], i) => `
      <li><span class="pwa-num">${i + 1}</span><div>
        <div class="pwa-step-title">${esc(title)}</div>
        <div class="pwa-step-text">${esc(text)}</div>
        ${illus[i] ? `<div class="pwa-illu" aria-hidden="true">${illus[i]}</div>` : ''}
      </div></li>`).join('');
  }

  const CSS = `
    .pwa-root { --pwa-accent: ${cfg.accent || '#ef5a46'}; --pwa-font: ${cfg.font ? `'${cfg.font}', ` : ''}system-ui, sans-serif;
      --pwa-surface: #fff; --pwa-surface2: #f4f3f0; --pwa-surface3: #e6e3de; --pwa-text: #1e1e24; --pwa-text2: #5d5b66; --pwa-text3: #9a98a3; --pwa-border: rgba(0,0,0,0.08);
      font-family: var(--pwa-font); color: var(--pwa-text); }
    .pwa-root *, .pwa-root *::before, .pwa-root *::after { box-sizing: border-box; margin: 0; padding: 0; }
    .pwa-banner { display: none; position: fixed; left: 50%; bottom: calc(16px + env(safe-area-inset-bottom)); transform: translateX(-50%);
      width: calc(100% - 24px); max-width: 456px; background: var(--pwa-surface); border: 1px solid var(--pwa-border); border-radius: 20px;
      box-shadow: 0 10px 32px rgba(0,0,0,0.18); padding: 10px 12px 10px 8px; z-index: 9000; align-items: center; gap: 10px;
      animation: pwaSlide .45s cubic-bezier(.2,.8,.2,1); }
    .pwa-banner.show { display: flex; }
    @keyframes pwaSlide { from { opacity: 0; transform: translate(-50%, 16px); } to { opacity: 1; transform: translate(-50%, 0); } }
    .pwa-x { background: none; border: none; cursor: pointer; font-size: 12px; color: var(--pwa-text3); width: 28px; height: 28px; border-radius: 50%;
      flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-family: inherit; }
    .pwa-x:hover { background: var(--pwa-surface2); color: var(--pwa-text); }
    .pwa-logo { width: 44px; height: 44px; flex-shrink: 0; border-radius: 11px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); display: block; }
    .pwa-body { flex: 1; min-width: 0; }
    .pwa-title { font-weight: 700; font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pwa-sub { font-size: 12px; color: var(--pwa-text3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pwa-cta { flex-shrink: 0; background: var(--pwa-accent); color: #fff; border: none; cursor: pointer; font-family: inherit; font-weight: 700;
      font-size: 14px; padding: 9px 16px; border-radius: 99px; }
    .pwa-cta:hover { filter: brightness(0.93); }
    .pwa-backdrop { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
      z-index: 9001; align-items: center; justify-content: center; padding: 16px;
      padding-top: max(16px, env(safe-area-inset-top)); padding-bottom: max(16px, env(safe-area-inset-bottom)); }
    .pwa-backdrop.show { display: flex; }
    .pwa-modal { background: var(--pwa-surface); border-radius: 22px; width: 100%; max-width: 520px; max-height: 100%; display: flex; flex-direction: column;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3); animation: pwaIn .25s cubic-bezier(.2,.8,.2,1); }
    @keyframes pwaIn { from { opacity: 0; transform: translateY(12px) scale(0.98); } to { opacity: 1; transform: none; } }
    .pwa-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 18px 18px 12px; }
    .pwa-head h2 { font-size: 20px; font-weight: 700; }
    .pwa-mbody { padding: 4px 18px 18px; overflow-y: auto; flex: 1; min-height: 0; }
    .pwa-hdr { text-align: center; margin-bottom: 18px; }
    .pwa-hdr p { font-size: 14px; color: var(--pwa-text2); line-height: 1.5; }
    .pwa-icon { width: 72px; height: 72px; border-radius: 18px; display: block; margin: 0 auto 12px; box-shadow: 0 6px 18px rgba(0,0,0,0.18); }
    .pwa-steps { list-style: none; display: flex; flex-direction: column; gap: 14px; }
    .pwa-steps li { display: flex; gap: 12px; align-items: flex-start; }
    .pwa-steps li > div { flex: 1; min-width: 0; }
    .pwa-num { width: 28px; height: 28px; flex-shrink: 0; border-radius: 50%; background: color-mix(in srgb, var(--pwa-accent) 14%, transparent);
      color: var(--pwa-accent); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; }
    .pwa-step-title { font-weight: 600; font-size: 15px; margin-bottom: 2px; }
    .pwa-step-text { font-size: 13px; color: var(--pwa-text2); line-height: 1.5; }
    .pwa-illu { margin-top: 10px; padding: 10px 12px; background: var(--pwa-surface2); border-radius: 10px; }
    .pwa-illu svg { display: block; width: 100%; height: auto; }
    .pwa-bar { fill: var(--pwa-surface3); }
    .pwa-sheet { fill: var(--pwa-surface); stroke: var(--pwa-surface3); stroke-width: 1; }
    .pwa-t { font-family: var(--pwa-font); font-size: 13px; fill: var(--pwa-text2); }
    .pwa-strong { fill: var(--pwa-text); font-weight: 600; }
    .pwa-ring { stroke: var(--pwa-accent); stroke-width: 2.5; }
    .pwa-ic { stroke: var(--pwa-text); stroke-width: 2; fill: none; stroke-linecap: round; stroke-linejoin: round; }
    .pwa-dot { fill: var(--pwa-text); }
    .pwa-why { list-style: none; margin-top: 18px; padding: 12px 14px; background: var(--pwa-surface2); border-radius: 12px; display: flex; flex-direction: column; gap: 6px; }
    .pwa-why li { font-size: 13px; color: var(--pwa-text2); padding-left: 18px; position: relative; }
    .pwa-why li::before { content: '✓'; position: absolute; left: 0; color: var(--pwa-accent); font-weight: 700; }
    .pwa-now { display: none; width: 100%; margin-top: 16px; background: var(--pwa-accent); color: #fff; border: none; cursor: pointer; font-family: inherit;
      font-weight: 700; font-size: 15px; padding: 13px; border-radius: 99px; }
    @media (prefers-reduced-motion: reduce) { .pwa-banner, .pwa-modal { animation: none; } }
  `;

  let root, banner, backdrop;

  function build() {
    if (root) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    root = document.createElement('div');
    root.className = 'pwa-root';
    root.innerHTML = `
      <div class="pwa-banner" role="dialog" aria-labelledby="pwa-banner-title">
        <button class="pwa-x" data-act="dismiss">✕</button>
        <img class="pwa-logo" src="${cfg.icon}" alt="" aria-hidden="true">
        <div class="pwa-body"><div class="pwa-title" id="pwa-banner-title"></div><div class="pwa-sub"></div></div>
        <button class="pwa-cta" data-act="open"></button>
      </div>
      <div class="pwa-backdrop" data-act="backdrop">
        <div class="pwa-modal" role="dialog" aria-modal="true" aria-labelledby="pwa-guide-title"></div>
      </div>`;
    document.body.appendChild(root);
    banner = root.querySelector('.pwa-banner');
    backdrop = root.querySelector('.pwa-backdrop');
    root.addEventListener('click', e => {
      const act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'backdrop' && e.target !== backdrop) return;
      ({ dismiss, open: openGuide, close: closeGuide, backdrop: closeGuide, now: triggerNative })[act.dataset.act]();
    });
  }

  function showBanner() {
    build();
    const T = TEXTS[lang()];
    banner.querySelector('.pwa-x').setAttribute('aria-label', T.close);
    banner.querySelector('.pwa-title').textContent = T.title;
    banner.querySelector('.pwa-sub').textContent = T.sub;
    banner.querySelector('.pwa-cta').textContent = T.cta;
    banner.classList.add('show');
  }

  function dismiss() {
    banner.classList.remove('show');
    rememberDismissal(30 * 24 * 60 * 60 * 1000);
  }

  function openGuide() {
    const T = TEXTS[lang()];
    const ios = isIOS();
    const list = ios
      ? steps(T.ios, [ILLU.shareBar(), ILLU.more(T.more), ILLU.home(T.home)])
      : steps(T.android, [ILLU.menuBar(), ILLU.install(T.install)]);
    backdrop.firstElementChild.innerHTML = `
      <div class="pwa-head"><h2 id="pwa-guide-title">${esc(T.guideTitle)}</h2><button class="pwa-x" data-act="close" aria-label="${esc(T.close)}">✕</button></div>
      <div class="pwa-mbody">
        <div class="pwa-hdr"><img class="pwa-icon" src="${cfg.icon}" alt="" aria-hidden="true"><p>${esc(T.intro)}</p></div>
        <ol class="pwa-steps">${list}</ol>
        <ul class="pwa-why">${T.why.map(w => `<li>${esc(w)}</li>`).join('')}</ul>
        <button class="pwa-now" data-act="now">${esc(T.now)}</button>
      </div>`;
    backdrop.querySelector('.pwa-now').style.display = (!ios && deferredPrompt) ? 'block' : 'none';
    backdrop.classList.add('show');
    banner.classList.remove('show');
  }

  function closeGuide() {
    backdrop.classList.remove('show');
  }

  async function triggerNative() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try {
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        closeGuide();
        rememberDismissal(10 * 365 * 24 * 60 * 60 * 1000);
      }
    } catch (e) { /* noop */ }
    deferredPrompt = null;
  }

  function maybeShow() {
    if (isStandalone() || isDismissed()) return;
    const isMobile = isIOS() || /Android/i.test(navigator.userAgent);
    if (!isMobile) return;
    setTimeout(showBanner, 1200);
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && backdrop) closeGuide();
  });

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
  });

  window.addEventListener('appinstalled', () => {
    if (banner) banner.classList.remove('show');
    deferredPrompt = null;
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', maybeShow);
  else maybeShow();

  // Pour les tests : window.pwaInstall.show() force la bannière sur ordinateur.
  window.pwaInstall = { show: showBanner, open: () => { build(); openGuide(); } };
})();
