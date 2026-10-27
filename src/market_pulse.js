/**
 * Market Pulse — Live S&P 500 Drivers, Fed Policy, Yield Curve & High-Precision Chart Studio.
 * Self-contained module. Data is proxied by server.py (NY Fed official API, Yahoo Finance, StockTwits).
 * Exposes window.MarketPulse with init/activate/deactivate.
 */
(function () {
  'use strict';

  const REFRESH_MS = 60000;
  let timer = null;
  let loadedOnce = false;
  let yieldCurveChart = null;

  // ---- High-Impact 2026 Scheduled Events (FOMC, CPI, NFP, PCE) ----
  const EVENTS = [
    { date: '2026-01-28', label: 'FOMC Rate Decision', kind: 'fomc' },
    { date: '2026-03-18', label: 'FOMC Rate Decision + Projections', kind: 'fomc' },
    { date: '2026-04-29', label: 'FOMC Rate Decision', kind: 'fomc' },
    { date: '2026-06-17', label: 'FOMC Rate Decision + Projections', kind: 'fomc' },
    { date: '2026-07-29', label: 'FOMC Rate Decision', kind: 'fomc' },
    { date: '2026-09-04', label: 'US Non-Farm Payrolls (Jobs Report)', kind: 'nfp' },
    { date: '2026-09-11', label: 'US Consumer Price Index (CPI)', kind: 'cpi' },
    { date: '2026-09-16', label: 'FOMC Rate Decision + Projections', kind: 'fomc' },
    { date: '2026-09-25', label: 'Core PCE Inflation Index', kind: 'pce' },
    { date: '2026-10-02', label: 'US Non-Farm Payrolls (NFP)', kind: 'nfp' },
    { date: '2026-10-14', label: 'US Consumer Price Index (CPI)', kind: 'cpi' },
    { date: '2026-10-28', label: 'FOMC Rate Decision', kind: 'fomc' },
    { date: '2026-10-30', label: 'Core PCE Price Index', kind: 'pce' },
    { date: '2026-11-06', label: 'US Non-Farm Payrolls (NFP)', kind: 'nfp' },
    { date: '2026-11-12', label: 'US Consumer Price Index (CPI)', kind: 'cpi' },
    { date: '2026-12-04', label: 'US Non-Farm Payrolls (NFP)', kind: 'nfp' },
    { date: '2026-12-09', label: 'FOMC Rate Decision + Projections', kind: 'fomc' },
    { date: '2026-12-10', label: 'US Consumer Price Index (CPI)', kind: 'cpi' },
  ];

  // ---- helpers ----
  const $ = (id) => document.getElementById(id);

  function fmtNum(v, dp) {
    if (v === null || v === undefined || isNaN(v)) return '--';
    return Number(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }

  function sign(v) { return v > 0 ? '+' : ''; }

  function clsFor(v) { return v > 0 ? 'positive' : v < 0 ? 'negative' : ''; }

  async function getJSON(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  function renderSparklineSvg(sparkline, isPositive) {
    if (!sparkline || sparkline.length < 2) return '<div class="pulse-sparkline-wrap"></div>';
    const min = Math.min(...sparkline);
    const max = Math.max(...sparkline);
    const range = max - min || 1;
    const w = 170, h = 26;
    const pts = sparkline.map((v, i) => {
      const x = ((i / (sparkline.length - 1)) * w).toFixed(1);
      const y = (h - ((v - min) / range) * (h - 4) - 2).toFixed(1);
      return `${x},${y}`;
    }).join(' ');

    const strokeColor = isPositive ? '#10B981' : '#EF4444';
    const fillColor = isPositive ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)';
    const polyPts = `0,${h} ${pts} ${w},${h}`;

    return `<div class="pulse-sparkline-wrap">
      <svg class="pulse-sparkline-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <polygon points="${polyPts}" fill="${fillColor}" />
        <polyline fill="none" stroke="${strokeColor}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" points="${pts}" />
      </svg>
    </div>`;
  }

  // ---- quote cards ----
  function quoteCard(q) {
    if (!q || !q.ok) {
      return `<div class="pulse-card pulse-card-err" data-symbol="${q ? q.symbol : ''}">
        <div class="pulse-card-top">
          <div class="pulse-name">${q ? q.name : '—'}</div>
          <div class="pulse-sub">${q ? q.symbol : ''}</div>
        </div>
        <div class="pulse-price">--</div>
        <div class="pulse-range-wrap"><span>Data unavailable</span></div>
      </div>`;
    }
    const dp = Math.abs(q.price) < 10 ? 3 : 2;
    const isPos = (q.change || 0) >= 0;
    const c = clsFor(q.change);
    const arrow = q.change > 0 ? '▲' : q.change < 0 ? '▼' : '·';
    const sparkHtml = renderSparklineSvg(q.sparkline, isPos);

    return `<div class="pulse-card" data-symbol="${q.symbol}" style="cursor: pointer;">
      <div class="pulse-card-top">
        <div class="pulse-name">${q.name}</div>
        <div class="pulse-sub">${q.symbol}</div>
      </div>
      <div class="pulse-card-mid">
        <div class="pulse-price">${fmtNum(q.price, dp)}</div>
        <div class="pulse-change ${c}">${arrow} ${sign(q.change)}${fmtNum(q.change, dp)} (${sign(q.change_pct)}${fmtNum(q.change_pct, 2)}%)</div>
      </div>
      ${sparkHtml}
      <div class="pulse-range-wrap">
        <span>H: ${fmtNum(q.day_high, dp)}</span>
        <span>L: ${fmtNum(q.day_low, dp)}</span>
      </div>
    </div>`;
  }

  let lastQuotes = null;

  async function loadQuotes() {
    try {
      const data = await getJSON('/api/pulse/quotes');
      lastQuotes = {};
      (data.quotes || []).forEach(q => { lastQuotes[q.symbol] = q; });

      const core = ['ES=F', 'NQ=F', 'YM=F', 'RTY=F', '^GSPC', '^IXIC', '^DJI', '^RUT'];
      const macro = ['^VIX', '^VIX9D', '^SKEW', '^VVIX', '2YY=F', '^TNX', '^TYX', '^IRX', 'DX-Y.NYB', 'CL=F', 'GC=F', 'SI=F', 'BTC-USD', 'ETH-USD', '^MOVE'];
      const global = ['^KS11', '^N225', '^GDAXI', '^FTSE', '^HSI', '000001.SS'];

      $('pulse-grid-core').innerHTML = core.map(s => quoteCard(lastQuotes[s])).join('');
      $('pulse-grid-macro').innerHTML = macro.map(s => quoteCard(lastQuotes[s])).join('');
      $('pulse-grid-global').innerHTML = global.map(s => quoteCard(lastQuotes[s])).join('');
      if (data.asof) $('pulse-asof').textContent = 'Updated ' + new Date(data.asof).toLocaleTimeString();
    } catch (e) {
      $('pulse-grid-core').innerHTML = errBox('Could not load quotes: ' + e.message);
    }
    buildDigest();
  }

  function errBox(msg) {
    return `<div class="pulse-error">⚠️ ${msg}</div>`;
  }

  // ---- rates & yield curve cockpit ----
  async function loadRates() {
    try {
      const data = await getJSON('/api/pulse/rates');
      const targetFrom = data.target_from != null ? fmtNum(data.target_from, 2) : '3.50';
      const targetTo = data.target_to != null ? fmtNum(data.target_to, 2) : '3.75';
      const targetStr = `${targetFrom}% – ${targetTo}%`;

      const effr = data.effr != null ? fmtNum(data.effr, 2) + '%' : '--';
      const effrVol = data.effr_volume ? `Vol: $${fmtNum(data.effr_volume, 0)}B` : '';
      const sofr = data.sofr != null ? fmtNum(data.sofr, 2) + '%' : '--';
      const sofrVol = data.sofr_volume ? `Vol: $${fmtNum(data.sofr_volume, 0)}B` : '';

      const sp102 = data.spread_10y_2y || {};
      const spBps = sp102.bps != null ? `${sp102.bps > 0 ? '+' : ''}${fmtNum(sp102.bps, 1)} bps` : '--';
      const spStatus = sp102.status || 'Normal';
      const pillCls = sp102.bps < -5 ? 'spread-inverted' : (sp102.bps > 40 ? 'spread-normal' : 'spread-flat');

      const sp103 = data.spread_10y_3m || {};
      const sp3Bps = sp103.bps != null ? `${sp103.bps > 0 ? '+' : ''}${fmtNum(sp103.bps, 1)} bps` : '--';

      const u3m = data.ust3m || {};
      const u2y = data.ust2y || {};
      const u5y = data.ust5y || {};
      const u10y = data.ust10y || {};
      const u30y = data.ust30y || {};

      $('pulse-rates').innerHTML = `
        <div class="rates-cockpit">
          <!-- Target Corridor Banner -->
          <div class="rate-highlight">
            <div>
              <div class="rate-highlight-label">Fed Funds Target Range (FOMC)</div>
              <div class="rate-highlight-val">${targetStr}</div>
            </div>
            <div style="text-align: right;">
              <span class="spread-status-pill ${pillCls}">10Y-2Y: ${spBps}</span>
              <div style="font-size:0.68rem; color:#e0e7ff; margin-top:4px;">${spStatus}</div>
            </div>
          </div>

          <!-- Key Reference Rates Grid -->
          <div class="rate-key-metrics">
            <div class="rate-metric-card">
              <div class="rate-metric-label">Effective Fed Funds (EFFR)</div>
              <div class="rate-metric-val">${effr}</div>
              <div class="rate-metric-sub">${effrVol} ${data.effr_date ? '(' + data.effr_date + ')' : ''}</div>
            </div>
            <div class="rate-metric-card">
              <div class="rate-metric-label">Overnight Financing (SOFR)</div>
              <div class="rate-metric-val">${sofr}</div>
              <div class="rate-metric-sub">${sofrVol}</div>
            </div>
          </div>

          <!-- Yield Curve Visualizer -->
          <div class="yield-curve-box">
            <div class="yield-curve-header">
              <span class="yield-curve-title">US Treasury Yield Curve</span>
              <span style="font-size: 0.68rem; color: var(--text-muted);">10Y-3M Spread: <strong>${sp3Bps}</strong></span>
            </div>
            <div style="height: 140px; position: relative; width: 100%;">
              <canvas id="pulse-yield-curve-chart"></canvas>
            </div>
          </div>

          <!-- Benchmark Yields Table -->
          <table class="yield-table">
            <thead>
              <tr>
                <th>Tenor</th>
                <th>Yield</th>
                <th>Change</th>
                <th>Prev Close</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>3-Month T-Bill</td>
                <td><strong>${fmtNum(u3m.price, 3)}%</strong></td>
                <td class="${clsFor(u3m.change)}">${sign(u3m.change)}${fmtNum(u3m.change, 3)}</td>
                <td style="color:var(--text-muted);">${fmtNum(u3m.prev, 3)}%</td>
              </tr>
              <tr>
                <td>2-Year Note</td>
                <td><strong>${fmtNum(u2y.price, 3)}%</strong></td>
                <td class="${clsFor(u2y.change)}">${sign(u2y.change)}${fmtNum(u2y.change, 3)}</td>
                <td style="color:var(--text-muted);">${fmtNum(u2y.prev, 3)}%</td>
              </tr>
              <tr>
                <td>5-Year Note</td>
                <td><strong>${fmtNum(u5y.price, 3)}%</strong></td>
                <td class="${clsFor(u5y.change)}">${sign(u5y.change)}${fmtNum(u5y.change, 3)}</td>
                <td style="color:var(--text-muted);">${fmtNum(u5y.prev, 3)}%</td>
              </tr>
              <tr>
                <td>10-Year Note</td>
                <td><strong>${fmtNum(u10y.price, 3)}%</strong></td>
                <td class="${clsFor(u10y.change)}">${sign(u10y.change)}${fmtNum(u10y.change, 3)}</td>
                <td style="color:var(--text-muted);">${fmtNum(u10y.prev, 3)}%</td>
              </tr>
              <tr>
                <td>30-Year Bond</td>
                <td><strong>${fmtNum(u30y.price, 3)}%</strong></td>
                <td class="${clsFor(u30y.change)}">${sign(u30y.change)}${fmtNum(u30y.change, 3)}</td>
                <td style="color:var(--text-muted);">${fmtNum(u30y.prev, 3)}%</td>
              </tr>
            </tbody>
          </table>

          <div class="rate-note">Official rates from Federal Reserve Bank of New York &amp; Treasury benchmarks from Yahoo Finance.</div>
        </div>
      `;

      // Render Yield Curve Chart
      drawYieldCurveChart(data.curve || []);
    } catch (e) {
      $('pulse-rates').innerHTML = errBox('Rates & Yield Curve unavailable: ' + e.message);
    }
  }

  function drawYieldCurveChart(curvePoints) {
    const ctx = $('pulse-yield-curve-chart');
    if (!ctx) return;
    if (yieldCurveChart) yieldCurveChart.destroy();

    const labels = curvePoints.map(p => p.tenor);
    const dataVals = curvePoints.map(p => p.rate);

    yieldCurveChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Yield (%)',
          data: dataVals,
          borderColor: '#8B5CF6',
          backgroundColor: 'rgba(139, 92, 246, 0.15)',
          borderWidth: 2.5,
          pointBackgroundColor: '#8B5CF6',
          pointBorderColor: '#ffffff',
          pointRadius: 4,
          pointHoverRadius: 6,
          tension: 0.35,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `Yield: ${fmtNum(ctx.parsed.y, 3)}%`
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#94a3b8', font: { size: 10, weight: '600' } }
          },
          y: {
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: {
              color: '#94a3b8',
              font: { size: 10 },
              callback: (v) => v.toFixed(2) + '%'
            }
          }
        }
      }
    });
  }

  // ---- economic calendar ----
  function loadCalendar() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const upcoming = EVENTS
      .map(e => ({ ...e, d: new Date(e.date + 'T00:00:00') }))
      .filter(e => e.d >= today)
      .sort((a, b) => a.d - b.d)
      .slice(0, 6);

    if (!upcoming.length) {
      $('pulse-calendar').innerHTML = `<div class="rate-note">No scheduled high-impact events remaining.</div>`;
      return;
    }

    $('pulse-calendar').innerHTML = upcoming.map((e, i) => {
      const days = Math.round((e.d - today) / 86400000);
      const when = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `in ${days} days`;
      const next = i === 0 ? ' cal-next' : '';
      const kindColor = e.kind === 'fomc' ? 'var(--accent-purple)' : e.kind === 'cpi' ? 'var(--accent-orange)' : 'var(--accent-blue)';
      return `<div class="cal-row${next}">
        <div class="cal-date" style="color:${kindColor}">${e.d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
        <div class="cal-label"><strong>${e.label}</strong></div>
        <div class="cal-when">${when}</div>
      </div>`;
    }).join('') + `<div class="rate-note">Curated high-impact scheduled macro catalysts for 2026: FOMC decisions, CPI inflation, and NFP jobs.</div>`;
  }

  // ---- sentiment ----
  let lastSentiment = null;
  async function loadSentiment() {
    try {
      const data = await getJSON('/api/pulse/sentiment');
      lastSentiment = data.sentiment || {};
      let html = '';
      ['SPY', 'QQQ'].forEach(tkr => {
        const s = lastSentiment[tkr];
        if (!s || s.error) {
          html += `<div class="sent-block"><div class="sent-ticker">$${tkr}</div><div class="rate-note">unavailable</div></div>`;
          return;
        }
        const total = (s.bullish + s.bearish + s.neutral) || 1;
        const bullPct = Math.round((s.bullish / total) * 100);
        const bearPct = Math.round((s.bearish / total) * 100);
        html += `<div class="sent-block">
          <div class="sent-ticker">$${tkr}
            <span class="sent-counts">${s.bullish}🐂 / ${s.bearish}🐻</span></div>
          <div class="sent-bar">
            <div class="sent-bull" style="width:${bullPct}%"></div>
            <div class="sent-bear" style="width:${bearPct}%"></div>
          </div>
          <div class="sent-pct"><span class="positive">${bullPct}% bullish</span><span class="negative">${bearPct}% bearish</span></div>
        </div>`;
      });
      html += `<div class="rate-note">Retail tagged sentiment from StockTwits (social buzz proxy).</div>`;
      $('pulse-sentiment').innerHTML = html;
    } catch (e) {
      $('pulse-sentiment').innerHTML = errBox('Sentiment unavailable.');
    }
    buildDigest();
  }

  // ---- news ----
  function timeAgo(pub) {
    const t = Date.parse(pub);
    if (isNaN(t)) return '';
    const mins = Math.round((Date.now() - t) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const h = Math.round(mins / 60);
    if (h < 24) return h + 'h ago';
    return Math.round(h / 24) + 'd ago';
  }

  let lastNews = [];
  async function loadNews() {
    try {
      const data = await getJSON('/api/pulse/news');
      lastNews = data.news || [];
      if (!lastNews.length) {
        $('pulse-news').innerHTML = errBox('No headlines returned.');
        return;
      }
      $('pulse-news').innerHTML = lastNews.map(n => `
        <a class="news-item" href="${n.link}" target="_blank" rel="noopener">
          <div class="news-title">${escapeHtml(n.title)}</div>
          <div class="news-meta"><span class="news-src">${n.source}</span>
            <span class="news-time">${timeAgo(n.pubDate)}</span></div>
        </a>`).join('');
    } catch (e) {
      $('pulse-news').innerHTML = errBox('News unavailable.');
    }
    buildDigest();
  }

  function escapeHtml(s) {
    return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // ---- automated digest ----
  function buildDigest() {
    const el = $('pulse-digest');
    const badge = $('pulse-regime-badge');
    if (!el) return;
    if (!lastQuotes) { return; }

    const es = lastQuotes['ES=F'] || lastQuotes['^GSPC'];
    const vix = lastQuotes['^VIX'];
    const tnx = lastQuotes['^TNX'];
    const dxy = lastQuotes['DX-Y.NYB'];
    const parts = [];

    let regime = 'Mixed', regimeColor = '#F59E0B';
    if (es && es.ok && es.change_pct != null) {
      const dir = es.change_pct > 0.15 ? 'risk-on' : es.change_pct < -0.15 ? 'risk-off' : 'flat';
      if (dir === 'risk-on') { regime = 'Risk-On'; regimeColor = '#10B981'; }
      else if (dir === 'risk-off') { regime = 'Risk-Off'; regimeColor = '#EF4444'; }
      parts.push(`<strong>S&P 500 futures</strong> are ${es.change_pct >= 0 ? 'up' : 'down'} ${sign(es.change_pct)}${fmtNum(es.change_pct, 2)}% (${fmtNum(es.price, 2)}), pointing to a ${dir} tone.`);
    }
    if (vix && vix.ok) {
      const v = vix.price;
      const fear = v >= 25 ? 'elevated fear' : v >= 18 ? 'moderate caution' : 'calm';
      parts.push(`<strong>VIX</strong> at ${fmtNum(v, 2)} (${sign(vix.change)}${fmtNum(vix.change, 2)}) signals ${fear}.`);
    }
    if (tnx && tnx.ok) {
      parts.push(`The <strong>10Y yield</strong> is ${fmtNum(tnx.price, 2)}% (${sign(tnx.change)}${fmtNum(tnx.change, 2)}), a critical driver for equity multiples.`);
    }
    if (dxy && dxy.ok && dxy.change_pct != null) {
      parts.push(`The <strong>dollar (DXY)</strong> is ${dxy.change_pct >= 0 ? 'firmer' : 'softer'} (${sign(dxy.change_pct)}${fmtNum(dxy.change_pct, 2)}%).`);
    }

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const nextEvent = EVENTS.map(e => ({ ...e, d: new Date(e.date + 'T00:00:00') }))
      .filter(e => e.d >= today).sort((a, b) => a.d - b.d)[0];
    if (nextEvent) {
      const days = Math.round((nextEvent.d - today) / 86400000);
      parts.push(`Next key macro event: <strong>${nextEvent.label}</strong> in ${days} day${days === 1 ? '' : 's'} (${nextEvent.d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}).`);
    }

    badge.textContent = regime;
    badge.style.background = regimeColor + '22';
    badge.style.color = regimeColor;
    badge.style.border = '1px solid ' + regimeColor + '55';

    el.innerHTML = parts.join(' ') +
      `<div class="rate-note" style="margin-top:10px;">Auto-computed from live market inputs.</div>`;
  }

  // ---- orchestration ----
  async function loadAll() {
    await Promise.allSettled([loadQuotes(), loadRates(), loadSentiment(), loadNews()]);
    loadCalendar();
  }

  function activate() {
    loadCalendar();
    if (!loadedOnce) { loadAll(); loadedOnce = true; }
    if (timer) clearInterval(timer);
    timer = setInterval(loadAll, REFRESH_MS);
  }

  function deactivate() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  // ---- High-Precision Chart Studio Modal ----
  let currentChart = null;
  let activeSymbol = null;
  let activeRange = '1d';
  let activeInterval = '5m';
  let showSma20 = true;
  let showSma50 = false;
  let showVolume = true;

  function calculateSMA(data, period) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) {
        result.push(null);
      } else {
        let sum = 0;
        for (let j = 0; j < period; j++) {
          sum += data[i - j];
        }
        result.push(roundDec(sum / period, 4));
      }
    }
    return result;
  }

  function roundDec(num, dec) {
    return Math.round(num * Math.pow(10, dec)) / Math.pow(10, dec);
  }

  async function openChartModal(symbol, name) {
    activeSymbol = symbol;
    $('modal-chart-title').textContent = `${name || symbol} (${symbol})`;
    
    // Live price header
    const quote = lastQuotes ? lastQuotes[symbol] : null;
    if (quote && quote.ok) {
      const dp = Math.abs(quote.price) < 10 ? 3 : 2;
      $('modal-chart-live-price').textContent = `${fmtNum(quote.price, dp)} ${quote.currency || ''}`;
      $('modal-chart-live-chg').textContent = `${sign(quote.change)}${fmtNum(quote.change, dp)} (${sign(quote.change_pct)}${fmtNum(quote.change_pct, 2)}%)`;
      $('modal-chart-live-chg').className = clsFor(quote.change);
    } else {
      $('modal-chart-live-price').textContent = '';
      $('modal-chart-live-chg').textContent = '';
    }

    // Default to 1D (5m)
    activeRange = '1d';
    activeInterval = '5m';
    
    const btns = document.querySelectorAll('.chart-period-selector .period-btn');
    btns.forEach(b => {
      if (b.dataset.range === '1d') b.classList.add('active');
      else b.classList.remove('active');
    });

    $('chart-modal').style.display = 'flex';
    await fetchAndDrawChart(symbol, activeRange, activeInterval);
  }

  async function fetchAndDrawChart(symbol, range, interval) {
    try {
      const url = `/api/pulse/historical?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval || '')}`;
      const data = await getJSON(url);
      if (data.error) throw new Error(data.error);

      const points = data.points || [];
      const stats = data.stats || {};
      const dp = (points[0] && Math.abs(points[0].close) < 10) ? 3 : 2;

      // Update Stats Ribbon
      if (stats.change != null) {
        const cCls = clsFor(stats.change);
        $('mstat-return').innerHTML = `<span class="${cCls}">${sign(stats.change)}${fmtNum(stats.change, dp)} (${sign(stats.change_pct)}${fmtNum(stats.change_pct, 2)}%)</span>`;
        $('mstat-high').textContent = fmtNum(stats.period_high, dp);
        $('mstat-low').textContent = fmtNum(stats.period_low, dp);
        $('mstat-open').textContent = fmtNum(stats.period_open, dp);
        $('mstat-vol').textContent = stats.total_volume ? fmtNum(stats.total_volume, 0) : `${points.length} bars`;
      }

      const labels = points.map(p => p.date);
      const closeVals = points.map(p => p.close);
      const volVals = points.map(p => p.volume || 0);

      const ctx = $('modal-history-chart');
      if (!ctx) return;
      if (currentChart) currentChart.destroy();

      const isPositive = stats.change >= 0;
      const primaryColor = isPositive ? '#10B981' : '#EF4444';
      const areaGradient = isPositive ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)';

      const datasets = [{
        label: symbol,
        data: closeVals,
        borderColor: primaryColor,
        borderWidth: 2,
        pointRadius: points.length > 80 ? 0 : 2,
        pointHoverRadius: 5,
        tension: 0.15,
        fill: true,
        backgroundColor: areaGradient,
        yAxisID: 'y'
      }];

      // SMA 20 Overlay
      if (showSma20 && closeVals.length >= 20) {
        datasets.push({
          label: 'SMA 20',
          data: calculateSMA(closeVals, 20),
          borderColor: '#F59E0B',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.2,
          fill: false,
          yAxisID: 'y'
        });
      }

      // SMA 50 Overlay
      if (showSma50 && closeVals.length >= 50) {
        datasets.push({
          label: 'SMA 50',
          data: calculateSMA(closeVals, 50),
          borderColor: '#06B6D4',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.2,
          fill: false,
          yAxisID: 'y'
        });
      }

      // Volume Sub-Chart
      if (showVolume && volVals.some(v => v > 0)) {
        datasets.push({
          type: 'bar',
          label: 'Volume',
          data: volVals,
          backgroundColor: 'rgba(148, 163, 184, 0.25)',
          borderWidth: 0,
          yAxisID: 'y1'
        });
      }

      const maxVol = Math.max(...volVals, 1);

      currentChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              display: true,
              position: 'top',
              labels: {
                color: '#94a3b8',
                boxWidth: 12,
                font: { size: 11, weight: '600' }
              }
            },
            tooltip: {
              backgroundColor: 'rgba(15, 23, 42, 0.95)',
              titleColor: '#f1f5f9',
              bodyColor: '#cbd5e1',
              borderColor: 'rgba(255,255,255,0.1)',
              borderWidth: 1,
              padding: 10,
              callbacks: {
                title: (items) => {
                  const idx = items[0].dataIndex;
                  return points[idx] ? points[idx].full_date : items[0].label;
                },
                label: (ctx) => {
                  if (ctx.dataset.label === 'Volume') {
                    return `Volume: ${fmtNum(ctx.parsed.y, 0)}`;
                  }
                  return `${ctx.dataset.label}: ${fmtNum(ctx.parsed.y, dp)}`;
                }
              }
            }
          },
          scales: {
            x: {
              grid: { color: 'rgba(255,255,255,0.04)' },
              ticks: { color: '#94a3b8', font: { size: 10 }, maxTicksLimit: 12 }
            },
            y: {
              position: 'right',
              grid: { color: 'rgba(255,255,255,0.05)' },
              ticks: {
                color: '#94a3b8',
                font: { size: 10 },
                callback: (v) => fmtNum(v, dp)
              }
            },
            y1: {
              display: showVolume && volVals.some(v => v > 0),
              position: 'left',
              grid: { display: false },
              ticks: { display: false },
              min: 0,
              max: maxVol * 4 // Keeps volume bars on bottom 25% of chart
            }
          }
        }
      });
    } catch (e) {
      console.error('Failed to draw chart:', e);
      const ctx = $('modal-history-chart');
      if (ctx) {
        ctx.getContext('2d').clearRect(0, 0, ctx.width, ctx.height);
      }
    }
  }

  function initModalEvents() {
    const modal = $('chart-modal');
    const closeBtn = $('btn-modal-close');
    if (closeBtn) {
      closeBtn.onclick = () => { modal.style.display = 'none'; };
    }
    const backdrop = modal.querySelector('.modal-backdrop');
    if (backdrop) {
      backdrop.onclick = () => { modal.style.display = 'none'; };
    }

    // Timeframe selector buttons
    const btns = document.querySelectorAll('.chart-period-selector .period-btn');
    btns.forEach(btn => {
      btn.onclick = async () => {
        btns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        activeRange = btn.dataset.range;
        activeInterval = btn.dataset.interval || '';
        if (activeSymbol) {
          await fetchAndDrawChart(activeSymbol, activeRange, activeInterval);
        }
      };
    });

    // Technical indicator overlays
    const sma20Btn = $('btn-toggle-sma20');
    if (sma20Btn) {
      sma20Btn.onclick = async () => {
        showSma20 = !showSma20;
        sma20Btn.classList.toggle('active', showSma20);
        if (activeSymbol) await fetchAndDrawChart(activeSymbol, activeRange, activeInterval);
      };
    }

    const sma50Btn = $('btn-toggle-sma50');
    if (sma50Btn) {
      sma50Btn.onclick = async () => {
        showSma50 = !showSma50;
        sma50Btn.classList.toggle('active', showSma50);
        if (activeSymbol) await fetchAndDrawChart(activeSymbol, activeRange, activeInterval);
      };
    }

    const volBtn = $('btn-toggle-volume');
    if (volBtn) {
      volBtn.onclick = async () => {
        showVolume = !showVolume;
        volBtn.classList.toggle('active', showVolume);
        if (activeSymbol) await fetchAndDrawChart(activeSymbol, activeRange, activeInterval);
      };
    }

    // Bind card clicks
    document.addEventListener('click', (e) => {
      const card = e.target.closest('.pulse-card');
      if (card && card.dataset.symbol) {
        const symbol = card.dataset.symbol;
        const nameEl = card.querySelector('.pulse-name');
        const name = nameEl ? nameEl.textContent : symbol;
        openChartModal(symbol, name);
      }
    });
  }

  function init() {
    const btn = $('btn-pulse-refresh');
    if (btn) btn.onclick = () => { loadAll(); };

    initModalEvents();

    const active = document.querySelector('.tab-panel.active');
    if (active && active.dataset.tab === 'pulse') activate();
  }

  window.MarketPulse = { init, activate, deactivate };
})();
