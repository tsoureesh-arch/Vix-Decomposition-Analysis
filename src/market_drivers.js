/**
 * Market Drivers — cross-asset monitor for signals that can matter to the S&P 500.
 * Uses the shared quote API and the Market Pulse historical chart studio.
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const CATEGORIES = [
    { id: 'vol', title: 'Volatility & Tail Risk', icon: '🌡️' },
    { id: 'rates', title: 'Treasuries & Credit Stress', icon: '🏦' },
    { id: 'fx', title: 'Dollar & Global FX', icon: '💱' },
    { id: 'commodity', title: 'Energy & Commodities', icon: '🛢️' },
    { id: 'global', title: 'Major Global Indices', icon: '🌍' },
    { id: 'stock', title: 'Megacaps & Hot Single Names', icon: '⚡' },
    { id: 'us', title: 'US Equity Breadth', icon: '🇺🇸' },
  ];

  // Typical move is an approximate daily percentage move used only to surface unusual activity.
  const DRIVERS = [
    { s: '^VIX1D', n: 'VIX 1-Day', c: 'vol', t: 10, w: 1.05, r: 'inverse', note: 'Immediate event and overnight risk' },
    { s: '^VIX9D', n: 'VIX 9-Day', c: 'vol', t: 7, w: 1.15, r: 'inverse', note: 'Near-term event-risk premium' },
    { s: '^VIX', n: 'VIX 30-Day', c: 'vol', t: 6, w: 1.30, r: 'inverse', note: 'Core S&P 500 fear gauge' },
    { s: '^VIX3M', n: 'VIX 3-Month', c: 'vol', t: 4.5, w: 1.05, r: 'inverse', note: 'Medium-term equity uncertainty' },
    { s: '^VIX6M', n: 'VIX 6-Month', c: 'vol', t: 3.5, w: 0.85, r: 'inverse', note: 'Longer-horizon volatility pricing' },
    { s: '^VVIX', n: 'VVIX', c: 'vol', t: 5, w: 1.05, r: 'inverse', note: 'Demand for VIX optionality' },
    { s: '^SKEW', n: 'Cboe SKEW', c: 'vol', t: 1.2, w: 0.90, r: 'inverse', note: 'Tail-risk and crash protection pricing' },
    { s: '^COR1M', n: 'Cboe Implied Correlation', c: 'vol', t: 6, w: 1.15, r: 'inverse', note: 'Expected stock co-movement and systemic risk' },
    { s: '^MOVE', n: 'MOVE Bond Volatility', c: 'vol', t: 3.5, w: 1.15, r: 'inverse', note: 'Treasury-market volatility stress' },
    { s: '^VXN', n: 'Nasdaq 100 Volatility', c: 'vol', t: 6, w: 0.95, r: 'inverse', note: 'Technology volatility and risk appetite' },

    { s: '2YY=F', n: 'US 2-Year Yield', c: 'rates', t: 1.4, w: 1.15, r: 'inverse', note: 'Fed path and policy repricing' },
    { s: '^FVX', n: 'US 5-Year Yield', c: 'rates', t: 1.3, w: 1.05, r: 'inverse', note: 'Medium-term policy and growth expectations' },
    { s: '^TNX', n: 'US 10-Year Yield', c: 'rates', t: 1.2, w: 1.30, r: 'inverse', note: 'Key discount rate for equity valuations' },
    { s: '^TYX', n: 'US 30-Year Yield', c: 'rates', t: 1.1, w: 1.00, r: 'inverse', note: 'Long-duration inflation and term premium' },
    { s: 'TLT', n: 'Long Treasury ETF', c: 'rates', t: 0.9, w: 0.90, r: 'direct', note: 'Tradable long-duration Treasury signal' },
    { s: 'HYG', n: 'High-Yield Credit Proxy', c: 'rates', t: 0.55, w: 1.20, r: 'direct', note: 'Risk appetite and lower-quality credit stress' },
    { s: 'LQD', n: 'Investment-Grade Credit Proxy', c: 'rates', t: 0.45, w: 0.85, r: 'direct', note: 'Investment-grade funding conditions' },
    { s: 'KRE', n: 'Regional Banks ETF', c: 'rates', t: 1.5, w: 1.00, r: 'direct', note: 'Bank stress and credit availability' },

    { s: 'DX-Y.NYB', n: 'US Dollar Index', c: 'fx', t: 0.55, w: 1.20, r: 'inverse', note: 'Global liquidity and multinational earnings' },
    { s: 'JPY=X', n: 'USD / JPY', c: 'fx', t: 0.65, w: 1.10, r: 'context', note: 'Carry trades and Japanese policy risk' },
    { s: 'EURUSD=X', n: 'EUR / USD', c: 'fx', t: 0.55, w: 0.80, r: 'context', note: 'Dollar direction and European risk' },
    { s: 'CNH=X', n: 'USD / CNH', c: 'fx', t: 0.45, w: 1.00, r: 'inverse', note: 'China growth and global risk appetite' },
    { s: 'KRW=X', n: 'USD / KRW', c: 'fx', t: 0.75, w: 0.85, r: 'inverse', note: 'Asian technology and risk sentiment' },

    { s: 'CL=F', n: 'WTI Crude Oil', c: 'commodity', t: 2.2, w: 1.20, r: 'context', note: 'Inflation, geopolitics and energy earnings' },
    { s: 'BZ=F', n: 'Brent Crude Oil', c: 'commodity', t: 2.0, w: 1.00, r: 'context', note: 'Global oil and inflation impulse' },
    { s: 'GC=F', n: 'Gold', c: 'commodity', t: 1.0, w: 0.90, r: 'context', note: 'Real yields, dollar and safety demand' },
    { s: 'HG=F', n: 'Copper', c: 'commodity', t: 1.7, w: 0.90, r: 'direct', note: 'Global growth and China-sensitive demand' },
    { s: 'NG=F', n: 'Natural Gas', c: 'commodity', t: 4.0, w: 0.45, r: 'context', note: 'Energy inflation and utility input costs' },

    { s: '^KS11', n: 'KOSPI', c: 'global', t: 1.35, w: 1.15, r: 'direct', note: 'Asian semiconductors and global risk tone' },
    { s: '^N225', n: 'Nikkei 225', c: 'global', t: 1.2, w: 1.00, r: 'direct', note: 'Japan equities, yen and global cyclicals' },
    { s: '^TWII', n: 'Taiwan Weighted', c: 'global', t: 1.4, w: 1.10, r: 'direct', note: 'Semiconductor supply-chain sentiment' },
    { s: '^HSI', n: 'Hang Seng', c: 'global', t: 1.7, w: 0.95, r: 'direct', note: 'China growth and global risk appetite' },
    { s: '000001.SS', n: 'Shanghai Composite', c: 'global', t: 1.0, w: 0.75, r: 'direct', note: 'Mainland China risk and policy expectations' },
    { s: '^STOXX50E', n: 'Euro Stoxx 50', c: 'global', t: 1.1, w: 0.90, r: 'direct', note: 'Large-cap European risk tone' },
    { s: '^GDAXI', n: 'DAX', c: 'global', t: 1.1, w: 0.85, r: 'direct', note: 'European industrial and export cycle' },
    { s: '^FTSE', n: 'FTSE 100', c: 'global', t: 0.9, w: 0.65, r: 'direct', note: 'UK multinationals and commodities' },
    { s: '^NSEI', n: 'Nifty 50', c: 'global', t: 1.0, w: 0.65, r: 'direct', note: 'India equities and emerging-market flows' },
    { s: '^AXJO', n: 'ASX 200', c: 'global', t: 0.8, w: 0.55, r: 'direct', note: 'Asia-Pacific banks and commodities' },

    { s: 'NVDA', n: 'NVIDIA', c: 'stock', t: 2.4, w: 1.35, r: 'direct', note: 'AI leadership and index concentration' },
    { s: 'AAPL', n: 'Apple', c: 'stock', t: 1.6, w: 1.20, r: 'direct', note: 'Megacap index weight and consumer tech' },
    { s: 'MSFT', n: 'Microsoft', c: 'stock', t: 1.5, w: 1.25, r: 'direct', note: 'Cloud, AI and major index weight' },
    { s: 'AMZN', n: 'Amazon', c: 'stock', t: 1.9, w: 1.05, r: 'direct', note: 'Cloud, consumer and megacap breadth' },
    { s: 'META', n: 'Meta', c: 'stock', t: 2.0, w: 1.05, r: 'direct', note: 'Digital advertising and AI spending' },
    { s: 'GOOGL', n: 'Alphabet', c: 'stock', t: 1.8, w: 1.05, r: 'direct', note: 'Search, cloud and AI competition' },
    { s: 'AVGO', n: 'Broadcom', c: 'stock', t: 2.3, w: 1.05, r: 'direct', note: 'AI infrastructure and semiconductor breadth' },
    { s: 'TSLA', n: 'Tesla', c: 'stock', t: 3.2, w: 0.85, r: 'direct', note: 'High-beta growth and retail risk appetite' },
    { s: 'CRWV', n: 'CoreWeave', c: 'stock', t: 5.0, w: 0.95, r: 'direct', note: 'AI infrastructure and speculative appetite' },

    { s: 'SPY', n: 'S&P 500 ETF', c: 'us', t: 0.85, w: 0.70, r: 'direct', note: 'Headline US large-cap benchmark' },
    { s: 'QQQ', n: 'Nasdaq 100 ETF', c: 'us', t: 1.15, w: 1.05, r: 'direct', note: 'Growth and technology leadership' },
    { s: 'RSP', n: 'S&P 500 Equal Weight', c: 'us', t: 0.9, w: 1.00, r: 'direct', note: 'Breadth beyond the largest stocks' },
    { s: 'IWM', n: 'Russell 2000 ETF', c: 'us', t: 1.3, w: 0.95, r: 'direct', note: 'Domestic growth and small-cap conditions' },
  ];

  let quotes = new Map();
  let ranked = [];
  let activeCategory = 'all';
  let searchTerm = '';
  let timer = null;
  let loading = false;
  let initialized = false;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function fmt(value, digits = 2) {
    return Number.isFinite(Number(value))
      ? Number(value).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
      : '—';
  }

  function formatPrice(q) {
    if (!q || !q.ok || q.price == null) return 'Unavailable';
    const p = Number(q.price);
    const digits = Math.abs(p) < 10 ? 3 : (Math.abs(p) >= 1000 ? 1 : 2);
    return `${fmt(p, digits)}${q.currency ? ` ${escapeHtml(q.currency)}` : ''}`;
  }

  function moveText(q) {
    if (!q || !q.ok || q.change_pct == null) return 'No live quote';
    const sign = q.change_pct > 0 ? '+' : '';
    return `${sign}${fmt(q.change_pct, 2)}%`;
  }

  function score(meta, q) {
    if (!q || !q.ok || !Number.isFinite(Number(q.change_pct))) return 0;
    return Math.min(9.99, Math.abs(Number(q.change_pct)) / meta.t * meta.w);
  }

  function signal(meta, q) {
    if (!q || !q.ok || q.change_pct == null || Math.abs(q.change_pct) < 0.01) {
      return { text: 'Quiet', cls: 'neutral' };
    }
    if (meta.r === 'context') return { text: 'Watch closely', cls: 'watch' };
    const positiveForStocks = meta.r === 'direct' ? q.change_pct > 0 : q.change_pct < 0;
    return positiveForStocks
      ? { text: 'Potential support', cls: 'support' }
      : { text: 'Potential pressure', cls: 'pressure' };
  }

  function heatLabel(value) {
    if (value >= 2) return 'Very unusual';
    if (value >= 1.25) return 'Hot';
    if (value >= 0.75) return 'Notable';
    return 'Normal';
  }

  function sparkline(points, isUp) {
    const data = (points || []).filter(v => Number.isFinite(Number(v))).map(Number);
    if (data.length < 2) return '<div class="driver-spark-empty">No intraday line</div>';
    const w = 170, h = 38, pad = 2;
    const min = Math.min(...data), max = Math.max(...data), span = max - min || 1;
    const path = data.map((v, i) => {
      const x = pad + (i / (data.length - 1)) * (w - pad * 2);
      const y = h - pad - ((v - min) / span) * (h - pad * 2);
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const color = isUp ? '#10b981' : '#ef4444';
    return `<svg class="driver-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  function card(meta, rank = null) {
    const q = quotes.get(meta.s);
    const value = score(meta, q);
    const sig = signal(meta, q);
    const direction = q && Number(q.change_pct) >= 0 ? 'up' : 'down';
    const unavailable = !q || !q.ok;
    const hotClass = value >= 1.25 ? ' is-hot' : '';
    return `<button class="driver-card${hotClass}${unavailable ? ' is-unavailable' : ''}" data-symbol="${escapeHtml(meta.s)}" data-name="${escapeHtml(meta.n)}" type="button">
      <div class="driver-card-top">
        <span class="driver-symbol">${escapeHtml(meta.s)}</span>
        ${rank ? `<span class="driver-rank">#${rank}</span>` : `<span class="driver-heat heat-${value >= 1.25 ? 'hot' : value >= 0.75 ? 'notable' : 'normal'}">${heatLabel(value)}</span>`}
      </div>
      <div class="driver-card-name">${escapeHtml(meta.n)}</div>
      <div class="driver-quote-row">
        <strong>${formatPrice(q)}</strong>
        <span class="driver-change ${direction}">${moveText(q)}</span>
      </div>
      ${sparkline(q && q.sparkline, direction === 'up')}
      <div class="driver-signal ${sig.cls}">${sig.text}</div>
      <div class="driver-note">${escapeHtml(meta.note)}</div>
      ${rank ? `<div class="driver-score">Unusual-move score <strong>${fmt(value, 2)}×</strong></div>` : ''}
      <div class="driver-chart-hint">Open chart →</div>
    </button>`;
  }

  function renderHot() {
    const el = $('drivers-hot');
    if (!el) return;
    const available = ranked.filter(x => x.q && x.q.ok).slice(0, 3);
    el.innerHTML = available.length
      ? available.map((x, i) => card(x.meta, i + 1)).join('')
      : '<div class="driver-empty">Live quotes are temporarily unavailable. Try refresh in a moment.</div>';
  }

  function renderFocus() {
    const el = $('drivers-focus');
    if (!el) return;
    const top = ranked.find(x => x.q && x.q.ok);
    if (!top) {
      el.innerHTML = '<div class="driver-loading">Waiting for live market data…</div>';
      return;
    }
    const sig = signal(top.meta, top.q);
    const direction = top.q.change_pct >= 0 ? 'up' : 'down';
    el.innerHTML = `<div class="driver-focus-copy">
        <span class="driver-focus-kicker">STRONGEST LIVE SIGNAL</span>
        <h3>${escapeHtml(top.meta.n)} is the standout move</h3>
        <p><strong class="driver-change ${direction}">${moveText(top.q)}</strong> today — ${escapeHtml(top.meta.note)}. The board classifies this as <span class="driver-signal ${sig.cls}">${sig.text.toLowerCase()}</span> for equities.</p>
        <small>It is moving about ${fmt(top.value, 2)}× its typical daily range after relevance weighting.</small>
      </div>
      <button class="driver-focus-action driver-card" data-symbol="${escapeHtml(top.meta.s)}" data-name="${escapeHtml(top.meta.n)}" type="button">View ${escapeHtml(top.meta.s)} chart <span>→</span></button>`;
  }

  function matches(meta) {
    if (activeCategory !== 'all' && meta.c !== activeCategory) return false;
    if (!searchTerm) return true;
    const haystack = `${meta.n} ${meta.s} ${meta.note}`.toLowerCase();
    return haystack.includes(searchTerm);
  }

  function renderSections() {
    const el = $('drivers-sections');
    if (!el) return;
    let html = '';
    CATEGORIES.forEach(category => {
      const items = DRIVERS.filter(meta => meta.c === category.id && matches(meta));
      if (!items.length) return;
      html += `<section class="driver-category">
        <div class="driver-category-title"><span>${category.icon}</span><h3>${escapeHtml(category.title)}</h3><span class="driver-count">${items.length}</span></div>
        <div class="driver-grid">${items.map(meta => card(meta)).join('')}</div>
      </section>`;
    });
    el.innerHTML = html || '<div class="driver-empty">No drivers match this search.</div>';
  }

  function render() {
    ranked = DRIVERS.map(meta => {
      const q = quotes.get(meta.s);
      return { meta, q, value: score(meta, q) };
    }).sort((a, b) => b.value - a.value);
    renderFocus();
    renderHot();
    renderSections();
  }

  async function load() {
    if (loading) return;
    loading = true;
    const button = $('btn-drivers-refresh');
    if (button) button.classList.add('is-loading');
    try {
      const response = await fetch('/api/pulse/quotes', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Quote service returned ${response.status}`);
      const data = await response.json();
      quotes = new Map((data.quotes || []).map(q => [q.symbol, q]));
      const asof = $('drivers-asof');
      if (asof) {
        const when = data.asof ? new Date(data.asof) : new Date();
        asof.textContent = `Updated ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      }
      render();
    } catch (error) {
      console.error('Market Drivers:', error);
      const message = '<div class="driver-empty">Could not reach the live quote service. Your existing dashboard data is unaffected; try refresh shortly.</div>';
      if ($('drivers-hot')) $('drivers-hot').innerHTML = message;
      if ($('drivers-sections')) $('drivers-sections').innerHTML = message;
      if ($('drivers-focus')) $('drivers-focus').innerHTML = message;
    } finally {
      loading = false;
      if (button) button.classList.remove('is-loading');
    }
  }

  function openCard(card) {
    if (!card || !window.MarketPulse || !window.MarketPulse.openChart) return;
    const q = quotes.get(card.dataset.symbol);
    window.MarketPulse.openChart(card.dataset.symbol, card.dataset.name, q);
  }

  function bind() {
    const refresh = $('btn-drivers-refresh');
    if (refresh) refresh.addEventListener('click', load);

    const filters = $('drivers-filters');
    if (filters) filters.addEventListener('click', event => {
      const button = event.target.closest('.driver-filter');
      if (!button) return;
      activeCategory = button.dataset.category || 'all';
      filters.querySelectorAll('.driver-filter').forEach(el => el.classList.toggle('active', el === button));
      renderSections();
    });

    const search = $('drivers-search');
    if (search) search.addEventListener('input', event => {
      searchTerm = event.target.value.trim().toLowerCase();
      renderSections();
    });

    document.addEventListener('click', event => {
      const cardEl = event.target.closest('.driver-card');
      if (cardEl) openCard(cardEl);
    });
  }

  function activate() {
    load();
    if (!timer) timer = window.setInterval(load, 60000);
  }

  function deactivate() {
    if (timer) window.clearInterval(timer);
    timer = null;
  }

  function init() {
    if (initialized) return;
    initialized = true;
    bind();
    const active = document.querySelector('.tab-panel.active');
    if (active && active.dataset.tab === 'drivers') activate();
  }

  window.MarketDrivers = { init, activate, deactivate };
})();
