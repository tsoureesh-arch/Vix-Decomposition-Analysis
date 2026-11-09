/**
 * Presentation-only refinements for the MarketScope interface.
 * Keeps the application logic untouched while normalizing generated headings.
 */
(function () {
  'use strict';

  const LEADING_EMOJI = /^[\s\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F\u200D\u{1F1E6}-\u{1F1FF}]+/u;
  const TAB_ICONS = {
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    askdata: '<path d="M12 3l1.15 3.1L16 7.25l-2.85 1.15L12 11.5l-1.15-3.1L8 7.25l2.85-1.15L12 3Z"/><path d="M6.5 13l.78 2.22L9.5 16l-2.22.78L6.5 19l-.78-2.22L3.5 16l2.22-.78L6.5 13Z"/><path d="M18 13l.7 1.8 1.8.7-1.8.7L18 18l-.7-1.8-1.8-.7 1.8-.7L18 13Z"/>',
    compare: '<path d="M8 4v16M16 4v16M4 8l4-4 4 4M12 16l4 4 4-4"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
    riskreversal: '<path d="M4 19V5M4 19h16"/><path d="m7 15 4-5 3 3 5-7"/>',
    optionsoi: '<path d="M4 20V9M9.3 20V4M14.7 20v-7M20 20V7"/><path d="M2.5 20h19"/>',
    drivers: '<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2.1 4.9-4.9 2.1 2.1-4.9 4.9-2.1Z"/>',
    pulse: '<circle cx="12" cy="12" r="9"/><path d="M3 12h4l2-4 3.2 8 2.2-4H21"/>',
    vixterm: '<path d="M3 17c2.5-7 5-7 7.5-2s5 5 10.5-8"/><path d="M3 21h18"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>',
    stocks: '<path d="M5 21V7l7-4 7 4v14M9 9h2M13 9h2M9 13h2M13 13h2M10 21v-4h4v4"/>',
    economics: '<path d="M4 20v-5h3v5M10.5 20V9h3v11M17 20V4h3v16M2 20h20"/>',
    research: '<path d="M4 19V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14"/><path d="M4 17h16M8 7h8M8 11h6M2 21h20"/>',
  };
  const REVEAL_SELECTOR = [
    '.tab-panel > .glass-card',
    '.tab-panel > .dashboard-grid > .glass-card',
    '.overview-grid > .metric-card',
    '.options-summary-grid > .options-stat-card',
    '.options-chart-grid > .glass-card',
    '.driver-hot-grid > .driver-card',
    '.driver-grid > .driver-card',
    '.pulse-grid > .pulse-card',
  ].join(',');

  if (window.Chart) {
    window.Chart.defaults.devicePixelRatio = Math.min(3, Math.max(2, window.devicePixelRatio || 1));
    window.Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif';
    window.Chart.defaults.font.size = 12;
  }

  function decorateTabs() {
    document.querySelectorAll('.tab-btn[data-tab]').forEach(button => {
      const holder = button.querySelector('.tab-icon');
      const paths = TAB_ICONS[button.dataset.tab];
      if (!holder || !paths || holder.dataset.vectorIcon === 'true') return;
      holder.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
      holder.dataset.vectorIcon = 'true';
      holder.setAttribute('aria-hidden', 'true');
    });
  }

  function initTabIndicator() {
    const tabBar = document.getElementById('tab-bar');
    if (!tabBar) return;

    const indicator = document.createElement('span');
    indicator.className = 'tab-active-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    tabBar.prepend(indicator);

    const positionIndicator = () => {
      const active = tabBar.querySelector('.tab-btn.active');
      if (!active) return;
      indicator.style.width = `${active.offsetWidth}px`;
      indicator.style.height = `${active.offsetHeight}px`;
      indicator.style.transform = `translate3d(${active.offsetLeft}px, ${active.offsetTop}px, 0)`;
      indicator.classList.add('is-ready');
    };

    requestAnimationFrame(positionIndicator);
    tabBar.addEventListener('click', () => requestAnimationFrame(positionIndicator));
    window.addEventListener('resize', positionIndicator, { passive: true });

    const classObserver = new MutationObserver(positionIndicator);
    tabBar.querySelectorAll('.tab-btn').forEach(button => {
      classObserver.observe(button, { attributes: true, attributeFilter: ['class'] });
    });

    if ('ResizeObserver' in window) {
      const resizeObserver = new ResizeObserver(positionIndicator);
      resizeObserver.observe(tabBar);
      tabBar.querySelectorAll('.tab-btn').forEach(button => resizeObserver.observe(button));
    }
  }

  function registerPointerLight(root) {
    const cards = [];
    if (root && root.matches && root.matches('.glass-card')) cards.push(root);
    if (root && root.querySelectorAll) cards.push(...root.querySelectorAll('.glass-card'));
    cards.forEach(card => {
      if (card.dataset.pointerLight === 'true') return;
      card.dataset.pointerLight = 'true';
      card.addEventListener('pointermove', event => {
        if (event.pointerType === 'touch') return;
        const bounds = card.getBoundingClientRect();
        card.style.setProperty('--card-light-x', `${event.clientX - bounds.left}px`);
        card.style.setProperty('--card-light-y', `${event.clientY - bounds.top}px`);
      }, { passive: true });
      card.addEventListener('pointerleave', () => {
        card.style.setProperty('--card-light-x', '-25%');
        card.style.setProperty('--card-light-y', '-25%');
      }, { passive: true });
    });
  }

  const revealObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        });
      }, { threshold: 0.06, rootMargin: '0px 0px -5% 0px' })
    : null;

  function registerReveal(root) {
    const elements = [];
    if (root && root.matches && root.matches(REVEAL_SELECTOR)) elements.push(root);
    if (root && root.querySelectorAll) elements.push(...root.querySelectorAll(REVEAL_SELECTOR));
    elements.forEach((element, index) => {
      if (element.dataset.motionReady === 'true') return;
      element.dataset.motionReady = 'true';
      element.classList.add('refined-reveal');
      element.style.setProperty('--reveal-order', String(index % 8));
      if (revealObserver) revealObserver.observe(element);
      else element.classList.add('is-visible');
    });
  }

  function cleanHeading(heading) {
    if (!heading) return;
    const first = heading.firstChild;
    if (first && first.nodeType === Node.TEXT_NODE) {
      const cleaned = first.textContent.replace(LEADING_EMOJI, '');
      if (cleaned !== first.textContent) first.textContent = cleaned;
    }
  }

  function polish(root) {
    if (root && root.matches && root.matches('h2, h3, h4')) cleanHeading(root);
    if (root && root.querySelectorAll) root.querySelectorAll('h2, h3, h4').forEach(cleanHeading);
  }

  document.documentElement.classList.add('marketscope-refined');
  polish(document);
  decorateTabs();
  initTabIndicator();
  registerReveal(document);
  registerPointerLight(document);
  requestAnimationFrame(() => document.documentElement.classList.add('motion-ready'));

  const observer = new MutationObserver(records => {
    records.forEach(record => {
      if (record.target && record.target.matches && record.target.matches('h2, h3, h4')) {
        cleanHeading(record.target);
      }
      record.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          polish(node);
          registerReveal(node);
          registerPointerLight(node);
        }
        if (node.nodeType === Node.TEXT_NODE && node.parentElement && node.parentElement.matches('h2, h3, h4')) {
          cleanHeading(node.parentElement);
        }
      });
    });
  });
  observer.observe(document.getElementById('app-main') || document.body, { childList: true, subtree: true });
})();
