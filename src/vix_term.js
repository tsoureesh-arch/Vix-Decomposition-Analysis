/**
 * VIX Term Structure & Forward Volatility
 * Full-featured module matching vixcentral.com style with multiple dates comparison.
 * Exposes window.VixTerm with init/activate/deactivate/renderChart.
 */
(function () {
  'use strict';

  const $  = (id) => document.getElementById(id);
  const $$ = (sel) => document.querySelectorAll(sel);

  const REFRESH_MS = 60000;
  let liveTimer    = null;
  let chart        = null;
  let currentData  = null;
  let currentMode  = 'live';  // 'live' | 'historical'

  // Comparison curves
  let comparisonCurves = []; // Array of { date: 'YYYY-MM-DD', color: '#...', data: buildContracts(raw) }
  let activeTableDate  = null; // YYYY-MM-DD or null (means primary is active)

  const COMPARE_COLORS = [
    '#38bdf8', // sky-400 (light blue)
    '#f43f5e', // rose-500 (light red)
    '#34d399', // emerald-400 (green)
    '#fb923c', // orange-400 (orange)
    '#c084fc', // purple-400 (purple)
    '#fbbf24', // amber-400 (yellow)
    '#2dd4bf', // teal-400 (teal)
    '#f472b6'  // pink-400 (pink)
  ];

  /* ── Helpers ─────────────────────────────────────────────────────── */
  function fmt(v, dp = 2) {
    if (v == null || isNaN(v)) return '--';
    return Number(v).toFixed(dp);
  }
  function sgn(v)     { return v > 0 ? '+' : ''; }
  function cls(v)     { return v > 0 ? 'positive' : v < 0 ? 'negative' : ''; }

  function getVar(name, fallback) {
    const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return val || fallback;
  }

  /* Implied Forward Volatility between two contracts:
   *   Fwd_{i,i+1} = √( max(0, (F_{i+1}² · D_{i+1} - F_i² · D_i) / (D_{i+1} - D_i) ) )
   */
  function fwdVol(f1, d1, f2, d2) {
    if (f1 == null || f2 == null || d1 == null || d2 == null) return null;
    const dt = d2 - d1;
    if (dt <= 0) return null;
    return Math.sqrt(Math.max(0, (f2 * f2 * d2 - f1 * f1 * d1) / dt));
  }

  /* ── Data fetching ───────────────────────────────────────────────── */
  async function getJSON(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + url);
    return res.json();
  }

  async function loadData() {
    showStatus('loading');
    try {
      let raw;
      if (currentMode === 'live') {
        raw = await getJSON('/api/vix_term/live');
      } else {
        const dateVal = $('vixterm-date-input').value;
        if (!dateVal) { showStatus('idle'); return; }
        raw = await getJSON('/api/vix_term/historical?date=' + dateVal);
      }

      if (raw.error) throw new Error(raw.error);
      currentData = buildContracts(raw);
      renderAll();
      showStatus('ok');
    } catch (err) {
      console.error('[VixTerm] loadData error:', err);
      showStatus('error', err.message);
    }
  }

  /* Build enriched contract array from normalised server payload */
  function buildContracts(payload) {
    const contracts = (payload.contracts || []).map((c, i) => {
      return {
        idx:     c.idx,
        month:   c.month,
        year:    c.year,
        label:   `${c.month} ${c.year}`,
        expDate: c.exp_date || '--',
        dte:     c.dte,
        price:   c.last,
        open:    c.open,
        high:    c.high,
        low:     c.low,
      };
    });

    // Pre-compute spreads, contango %, and forward vol for each contract
    const vix = payload.vix;
    contracts.forEach((c, i) => {
      const prevPrice = i === 0 ? vix : (contracts[i - 1] ? contracts[i - 1].price : null);
      const prevDte   = i === 0 ? 0   : (contracts[i - 1] ? contracts[i - 1].dte   : null);

      if (prevPrice != null && prevPrice > 0) {
        c.spread = c.price - prevPrice;
        c.contangoPct = (c.spread / prevPrice) * 100;
      } else {
        c.spread = null;
        c.contangoPct = null;
      }
      c.fwdVol = fwdVol(prevPrice, prevDte, c.price, c.dte);
    });

    return {
      vix:      payload.vix,
      vxv:      payload.vxv,
      vxst:     payload.vxst,
      vxmt:     payload.vxmt,
      vixmo:    payload.vixmo,
      asOf:     payload.as_of,
      contracts,
    };
  }

  /* ── Status indicator ────────────────────────────────────────────── */
  function showStatus(state, msg) {
    const el = $('vixterm-status');
    if (!el) return;
    if (state === 'loading') {
      el.innerHTML = '<span class="vt-spinner"></span> Fetching…';
      el.style.color = 'var(--text-muted, #94a3b8)';
    } else if (state === 'ok') {
      const t = currentData && currentData.asOf
        ? new Date(currentData.asOf).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : '--';
      el.textContent = `✓ Last updated ${t}`;
      el.style.color = '#22c55e';
    } else if (state === 'error') {
      el.textContent = '⚠ ' + (msg || 'Load failed');
      el.style.color = 'var(--accent-red, #ef4444)';
    } else {
      el.textContent = '';
    }
  }

  /* ── Multiple Dates Logic ───────────────────────────────────────── */
  async function addComparisonDate() {
    const dateVal = $('vixterm-compare-date-input').value;
    if (!dateVal) return;

    if (currentMode === 'historical' && dateVal === $('vixterm-date-input').value) {
      alert('This is already the primary selected date.');
      return;
    }
    if (comparisonCurves.some(c => c.date === dateVal)) {
      alert('This date has already been added to comparison.');
      return;
    }

    showStatus('loading');
    try {
      const raw = await getJSON('/api/vix_term/historical?date=' + dateVal);
      if (raw.error) throw new Error(raw.error);

      const parsed = buildContracts(raw);
      if (!parsed.contracts || parsed.contracts.length === 0) {
        throw new Error('No contract data found for this date.');
      }

      const color = COMPARE_COLORS[comparisonCurves.length % COMPARE_COLORS.length];
      comparisonCurves.push({
        date: dateVal,
        color: color,
        data: parsed
      });

      // Default the new curve as the active table/metrics view
      activeTableDate = dateVal;

      renderAll();
      showStatus('ok');
    } catch (err) {
      console.error('[VixTerm] addComparisonDate error:', err);
      showStatus('error', 'Add failed: ' + err.message);
    }
  }

  function removeComparisonDate(dateVal) {
    comparisonCurves = comparisonCurves.filter(c => c.date !== dateVal);
    if (activeTableDate === dateVal) {
      activeTableDate = null;
    }
    renderAll();
  }

  function setActiveTableDate(dateVal) {
    if (activeTableDate === dateVal) {
      activeTableDate = null; // Toggle back to primary
    } else {
      activeTableDate = dateVal;
    }
    renderAll();
  }

  function getDisplayData() {
    if (activeTableDate) {
      const match = comparisonCurves.find(c => c.date === activeTableDate);
      if (match) return match.data;
    }
    return currentData;
  }

  /* Render compared list UI */
  function renderCompareList() {
    const container = $('vixterm-compare-list');
    if (!container) return;
    container.innerHTML = '';

    comparisonCurves.forEach((item) => {
      const el = document.createElement('div');
      const isActive = activeTableDate === item.date;
      el.className = 'vt-compare-item' + (isActive ? ' vt-compare-item-active' : '');
      el.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px; cursor:pointer; flex:1;" onclick="VixTerm.setActiveTableDate('${item.date}')">
          <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${item.color};"></span>
          <span class="mono" style="font-weight:${isActive ? '700' : '500'}; color:${isActive ? 'var(--accent-blue)' : 'var(--text-primary)'};">${item.date}</span>
          ${isActive ? '<span style="font-size:10px; color:var(--accent-blue); font-weight:700; margin-left:4px;">[TABLE ACTIVE]</span>' : ''}
        </div>
        <button onclick="VixTerm.removeComparisonDate('${item.date}'); event.stopPropagation();" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:16px; line-height:1; padding:0 4px;">&times;</button>
      `;
      container.appendChild(el);
    });
  }

  /* ── Main render ─────────────────────────────────────────────────── */
  function renderAll() {
    if (!currentData) return;
    renderCompareList();
    renderMetrics();
    renderTable();
    renderChart();
    renderVolIndicators();
    renderInsights();
  }

  /* Metrics strip: F2-F1, Contango%, Roll Yield */
  function renderMetrics() {
    const d = getDisplayData();
    if (!d) return;

    const c0 = d.contracts[0];
    const c1 = d.contracts[1];

    // Label showing which data is in the metrics/table
    const labelEl = $('vixterm-table').parentNode.previousElementSibling?.querySelector('h2');
    if (labelEl) {
      if (activeTableDate) {
        labelEl.innerHTML = `📋 Table Details: <span style="color:var(--accent-blue);">${activeTableDate}</span>`;
      } else {
        labelEl.innerHTML = `📋 Table Details: <span style="color:#818cf8;">${currentMode === 'live' ? 'Live Data' : $('vixterm-date-input').value}</span>`;
      }
    }

    if (c0 && c1) {
      const spread = c1.price - c0.price;
      const pct    = (spread / c0.price) * 100;
      const roll   = (c1.dte > c0.dte)
        ? pct * (365 / (c1.dte - c0.dte))
        : null;

      const set = (id, val, text) => {
        const el = $(id); if (!el) return;
        el.textContent = text;
        el.className = 'vt-metric-val ' + cls(val);
      };

      set('vixterm-f2-f1',       spread, `${sgn(spread)}${fmt(spread)}`);
      set('vixterm-contango-pct',   pct, `${sgn(pct)}${fmt(pct, 1)}%`);
      set('vixterm-roll-yield', roll ?? 0,
        roll != null ? `${sgn(roll)}${fmt(roll, 1)}%` : '--');
    } else {
      $('vixterm-f2-f1').textContent = '--';
      $('vixterm-contango-pct').textContent = '--';
      $('vixterm-roll-yield').textContent = '--';
    }

    // Spot VIX display
    const sv = $('vixterm-spot-vix');
    if (sv) sv.textContent = d.vix != null ? fmt(d.vix) : '--';

    // VXV
    const vxvEl = $('vixterm-vxv');
    if (vxvEl) vxvEl.textContent = d.vxv != null ? fmt(d.vxv) : '--';

    // Term ratio VXV/VIX
    const ratEl = $('vixterm-ratio');
    if (ratEl) {
      ratEl.textContent = (d.vix && d.vxv) ? fmt(d.vxv / d.vix, 3) : '--';
    }

    // As-of date
    const asofEl = $('vixterm-asof');
    if (asofEl) {
      asofEl.textContent = d.asOf ? d.asOf.replace('T', ' ').substring(0, 16) + ' UTC' : '--';
    }
  }

  /* Table */
  function renderTable() {
    const tbody = $('vixterm-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const d = getDisplayData();
    if (!d || !d.contracts) return;

    d.contracts.forEach((c) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="mono vt-cell-label">F${c.idx}</td>
        <td>${c.month} ${c.year}</td>
        <td class="mono">UX${c.month.substring(0,1).toUpperCase()}${String(c.year).slice(-2)}</td>
        <td>${c.expDate}</td>
        <td class="mono">${c.dte}</td>
        <td class="mono" style="font-weight:700;color:#e2e8f0;">${fmt(c.price)}</td>
        <td class="mono ${cls(c.spread)}">${c.spread != null ? sgn(c.spread) + fmt(c.spread) : '--'}</td>
        <td class="mono ${cls(c.contangoPct)}">${c.contangoPct != null ? sgn(c.contangoPct) + fmt(c.contangoPct, 1) + '%' : '--'}</td>
        <td class="mono" style="color:#6ee7b7;font-weight:600;">${c.fwdVol != null ? fmt(c.fwdVol) : '--'}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  /* Chart */
  function renderChart() {
    const ctx = $('vixterm-curve-chart');
    if (!ctx || !currentData) return;

    if (chart) { chart.destroy(); chart = null; }

    const cc   = currentData.contracts;
    // Use month and year for x-axis labels (e.g. Aug 26) instead of F1-F8
    const labels = cc.map(c => `${c.month} '${String(c.year).slice(-2)}`);
    const datasets = [];

    const showFutures = $('chk-vix-futures')?.checked !== false;
    const showSpot    = $('chk-vix-spot')?.checked    !== false;
    const showFwdVol  = $('chk-fwd-vol')?.checked     !== false;
    const showPrevClose = $('chk-prev-close')?.checked ?? false;

    // Get theme colors dynamically from CSS variables
    const gridColor   = getVar('--chart-grid', 'rgba(255,255,255,0.04)');
    const tickColor   = getVar('--text-secondary', '#94a3b8');
    const legendColor = getVar('--text-secondary', '#94a3b8');

    // 1. Primary Futures prices
    if (showFutures) {
      const activeLabel = currentMode === 'live' ? 'Live Curve' : $('vixterm-date-input').value;
      datasets.push({
        label: `Primary Curve (${activeLabel})`,
        data: cc.map(c => c.price),
        borderColor: '#818cf8',
        backgroundColor: 'rgba(129,140,248,0.06)',
        borderWidth: 3.5,
        tension: 0.25,
        pointRadius: 6,
        pointHoverRadius: 8,
        pointBackgroundColor: '#818cf8',
        fill: true,
        order: 1,
      });
    }

    // 2. Primary Spot VIX
    if (showSpot && currentData.vix != null) {
      datasets.push({
        label: `Spot VIX (${fmt(currentData.vix)})`,
        data: Array(cc.length).fill(currentData.vix),
        borderColor: '#f87171',
        borderDash: [6, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
        order: 3,
      });
    }

    // 3. Primary Implied Forward Volatility
    if (showFwdVol) {
      datasets.push({
        label: 'Primary Forward Vol',
        data: cc.map(c => c.fwdVol),
        borderColor: '#34d399',
        backgroundColor: 'transparent',
        borderWidth: 2,
        tension: 0.2,
        pointRadius: 4,
        pointHoverRadius: 6,
        fill: false,
        order: 2,
      });
    }

    // 4. Primary Previous Close (Open prices)
    if (showPrevClose && cc.some(c => c.open != null)) {
      datasets.push({
        label: 'Prev Close (Open)',
        data: cc.map(c => c.open),
        borderColor: '#fb923c',
        borderDash: [3, 3],
        borderWidth: 1.5,
        pointRadius: 3,
        fill: false,
        order: 4,
      });
    }

    // 5. Add compared historical curves
    comparisonCurves.forEach((ccurve, idx) => {
      datasets.push({
        label: `Curve (${ccurve.date})`,
        data: ccurve.data.contracts.map(c => c.price),
        borderColor: ccurve.color,
        backgroundColor: 'transparent',
        borderWidth: 2,
        tension: 0.2,
        pointRadius: 4,
        pointHoverRadius: 6,
        fill: false,
        order: 5 + idx
      });
    });

    chart = new Chart(ctx, {
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
              color: legendColor,
              font: { size: 11, family: "'Inter','Outfit',sans-serif" },
              usePointStyle: true,
              padding: 16,
            },
          },
          tooltip: {
            backgroundColor: 'rgba(15,23,42,0.95)',
            borderColor: 'rgba(99,102,241,0.4)',
            borderWidth: 1,
            titleColor: '#e2e8f0',
            bodyColor: '#94a3b8',
            padding: 12,
            callbacks: {
              title: (items) => {
                const i = items[0].dataIndex;
                const c = cc[i];
                return `Futures Contract F${c.idx} (DTE: ${c.dte})`;
              },
              afterBody: (items) => {
                const lines = [];
                return lines;
              }
            }
          }
        },
        scales: {
          x: {
            grid:  { color: gridColor },
            ticks: { color: tickColor, font: { size: 10 } },
          },
          y: {
            grid:  { color: gridColor },
            ticks: { color: tickColor, font: { size: 10 }, callback: v => v.toFixed(2) },
            title: { display: true, text: 'Volatility Index Level', color: tickColor, font: { size: 11 } },
          }
        }
      }
    });
  }

  /* Spot VIX vs vol surfaces indicator bar */
  function renderVolIndicators() {
    const d = getDisplayData();
    if (!d) return;
    const bar = $('vixterm-vol-bar');
    if (!bar) return;

    const items = [
      { label: 'VXST (9d)', val: d.vxst, color: '#f87171' },
      { label: 'VIX (30d)', val: d.vix,  color: '#818cf8' },
      { label: 'VXV (93d)', val: d.vxv,  color: '#fb923c' },
      { label: 'VXMT (6m)', val: d.vxmt, color: '#34d399' },
    ];
    bar.innerHTML = items
      .filter(it => it.val != null)
      .map(it => `
        <div class="vt-vol-pill" style="border-color:${it.color}20;background:${it.color}10;">
          <span class="vt-vol-pill-label">${it.label}</span>
          <span class="vt-vol-pill-val" style="color:${it.color};">${fmt(it.val)}</span>
        </div>
      `)
      .join('');
  }

  /* Plain-language read of the currently selected curve */
  function renderInsights() {
    const el = $('vixterm-insights-content');
    const d = getDisplayData();
    if (!el || !d) return;

    const contracts = (d.contracts || []).filter(c => Number.isFinite(c.price));
    if (contracts.length < 2) {
      el.textContent = 'Not enough futures contracts are available to assess the curve.';
      return;
    }

    const front = contracts[0];
    const back = contracts[contracts.length - 1];
    const curveMove = back.price - front.price;
    const curvePct = front.price ? (curveMove / front.price) * 100 : null;
    const shape = Math.abs(curveMove) < 0.1
      ? 'flat'
      : curveMove > 0 ? 'in contango' : 'in backwardation';
    const shapeMeaning = curveMove > 0.1
      ? 'Later expiries trade above the front month, a shape commonly associated with calmer near-term conditions.'
      : curveMove < -0.1
        ? 'Near-term futures trade above later expiries, showing elevated immediate volatility demand.'
        : 'The futures strip is nearly level, so the market is pricing similar volatility across expiries.';

    let spotRead = 'Spot VIX is unavailable for this historical curve.';
    if (Number.isFinite(d.vix)) {
      const premium = front.price - d.vix;
      spotRead = premium >= 0
        ? `Front-month futures are ${fmt(premium)} points above spot VIX.`
        : `Front-month futures are ${fmt(Math.abs(premium))} points below spot VIX.`;
    }

    const peak = contracts.reduce((best, c) => c.price > best.price ? c : best, contracts[0]);
    const period = activeTableDate || (currentMode === 'live' ? 'the live curve' : $('vixterm-date-input').value);
    el.innerHTML = `
      <div style="display:grid; gap:10px;">
        <div><strong style="color:var(--text-primary);">Curve shape:</strong> ${period} is <strong>${shape}</strong>. ${shapeMeaning}</div>
        <div><strong style="color:var(--text-primary);">Front-to-back:</strong> ${sgn(curveMove)}${fmt(curveMove)} points${curvePct != null ? ` (${sgn(curvePct)}${fmt(curvePct, 1)}%)` : ''} from ${front.label} to ${back.label}.</div>
        <div><strong style="color:var(--text-primary);">Spot relationship:</strong> ${spotRead}</div>
        <div><strong style="color:var(--text-primary);">Highest contract:</strong> ${peak.label} at ${fmt(peak.price)}.</div>
      </div>`;
  }

  /* ── Tab lifecycle ───────────────────────────────────────────────── */
  function activate() {
    loadData();
    if (liveTimer) clearInterval(liveTimer);
    if (currentMode === 'live') {
      liveTimer = setInterval(loadData, REFRESH_MS);
    }
  }

  function deactivate() {
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
  }

  /* ── Init ────────────────────────────────────────────────────────── */
  function init() {
    const btnLive      = $('btn-vixterm-mode-live');
    const btnHist      = $('btn-vixterm-mode-hist');
    const dateWrap     = $('vixterm-date-picker-wrap');
    const dateInput    = $('vixterm-date-input');
    const addDateBtn   = $('btn-vixterm-add-date');

    if (!btnLive || !btnHist || !dateInput || !addDateBtn) {
      console.warn('[VixTerm] Missing DOM elements – init aborted');
      return;
    }

    // Default historical date to last weekday
    const d = new Date();
    if (d.getDay() === 0) d.setDate(d.getDate() - 2);
    else if (d.getDay() === 6) d.setDate(d.getDate() - 1);
    else d.setDate(d.getDate() - 1);
    const dateStr = d.toISOString().split('T')[0];
    
    dateInput.value = dateStr;
    if (dateInput.max === undefined) dateInput.max = dateStr;

    const compInput = $('vixterm-compare-date-input');
    if (compInput) {
      compInput.value = dateStr;
      if (compInput.max === undefined) compInput.max = dateStr;
    }

    function setMode(mode) {
      currentMode = mode;
      const isLive = mode === 'live';
      btnLive.classList.toggle('active', isLive);
      btnHist.classList.toggle('active', !isLive);
      
      if (dateWrap) dateWrap.style.display = 'flex';
      const primaryGroup = $('vixterm-primary-date-group');
      if (primaryGroup) primaryGroup.style.display = isLive ? 'none' : 'block';

      if (isLive) {
        if (liveTimer) clearInterval(liveTimer);
        liveTimer = setInterval(loadData, REFRESH_MS);
      } else {
        if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
      }
      loadData();
    }

    btnLive.onclick = () => setMode('live');
    btnHist.onclick = () => setMode('historical');
    dateInput.onchange = () => {
      if (currentMode === 'historical') {
        activeTableDate = null; // Revert active table view to primary
        loadData();
      }
    };

    // Add Comparison date button
    addDateBtn.onclick = addComparisonDate;

    // Chart toggles
    ['chk-vix-futures', 'chk-vix-spot', 'chk-fwd-vol', 'chk-prev-close'].forEach(id => {
      const el = $(id); if (el) el.onchange = renderChart;
    });

    // Refresh
    const refBtn = $('btn-vixterm-refresh');
    if (refBtn) refBtn.onclick = loadData;

    // Auto-activate if this tab is currently active
    const active = document.querySelector('.tab-btn.active');
    if (active && active.dataset.tab === 'vixterm') activate();
  }

  window.VixTerm = {
    init,
    activate,
    deactivate,
    renderChart,
    removeComparisonDate,
    setActiveTableDate
  };
})();
