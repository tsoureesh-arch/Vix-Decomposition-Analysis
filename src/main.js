/**
 * VIX Decomposition Analyzer — Main Application v2
 * Tab navigation · AND/OR search · Multi-date compare · Light/Dark theme
 */
(async function() {
  // ---- State ----
  let historyData = [];
  let componentDefs = {};
  let marketEvents = [];
  let selectedIdx = 0;
  let filterRules = [];
  let searchResultsChart = null;

  // Compare state
  let compareIndices = [];
  let compareMetrics = [
    'spx_to', 'vix_to', 'skew_to',
    'sticky_strike', 'parallel_shift', 'put_skew',
    'call_skew', 'downside_convexity', 'upside_convexity', 'total'
  ];
  let currentSearchResults = [];
  let currentSearchTitle = '';
  let currentSearchRef = null; // For similarity search
  const ALL_COMPARE_METRICS = [
    { key: 'spx_to', label: 'S&P 500 Close' },
    { key: 'spx_change_pct', label: 'SPX Change %' },
    { key: 'vix_from', label: 'VIX Open' },
    { key: 'vix_to', label: 'VIX Close' },
    { key: 'vix_change_abs', label: 'VIX Change (Abs)' },
    { key: 'vix_change_pct', label: 'VIX Change %' },
    { key: 'skew_to', label: 'SKEW Index' },
    { key: 'skew_change_abs', label: 'SKEW Change' },
    { key: 'sticky_strike', label: 'Sticky Strike' },
    { key: 'parallel_shift', label: 'Parallel Shift' },
    { key: 'put_skew', label: 'Put Skew' },
    { key: 'call_skew', label: 'Call Skew' },
    { key: 'downside_convexity', label: 'Downside Convexity' },
    { key: 'upside_convexity', label: 'Upside Convexity' },
    { key: 'total', label: 'Total VIX Factor Change' },
  ];

  const SEARCH_CHART_METRICS = [
    { key: 'spx_change_pct', label: 'S&P 500 change', unit: '%' },
    { key: 'vix_change_pct', label: 'VIX change', unit: '%' },
    { key: 'vix_change_abs', label: 'VIX point change', unit: ' pts' },
    { key: 'vix_to', label: 'VIX close', unit: '' },
    { key: 'skew_change_abs', label: 'SKEW change', unit: ' pts' },
    { key: 'skew_to', label: 'SKEW close', unit: '' },
    { key: 'sticky_strike', label: 'Sticky strike', unit: '' },
    { key: 'parallel_shift', label: 'Parallel shift', unit: '' },
    { key: 'put_skew', label: 'Put skew', unit: '' },
    { key: 'call_skew', label: 'Call skew', unit: '' },
    { key: 'downside_convexity', label: 'Downside convexity', unit: '' },
    { key: 'upside_convexity', label: 'Upside convexity', unit: '' },
    { key: 'total', label: 'Total decomposition', unit: '' },
  ];

  // ---- Load Data ----
  async function loadData() {
    const urlParams = '?t=' + new Date().getTime();
    const [histRes, defRes, eventRes] = await Promise.all([
      fetch('data/vix_decomposition_history.json' + urlParams),
      fetch('data/component_definitions.json'),
      fetch('data/market_calendar.json'),
    ]);
    historyData = await histRes.json();
    componentDefs = await defRes.json();
    marketEvents = await eventRes.json();
    selectedIdx = historyData.length - 1;
    // Default compare: last 2 dates
    compareIndices = [
      Math.max(0, historyData.length - 2),
      historyData.length - 1
    ];
  }

  // ===========================================================
  //  TAB NAVIGATION
  // ===========================================================
  function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanels = document.querySelectorAll('.tab-panel');

    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;

        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        tabPanels.forEach(p => {
          p.classList.remove('active');
          if (p.dataset.tab === target) {
            p.classList.add('active');
          }
        });

        localStorage.setItem('vix_active_tab', target);

        // Re-render tab-specific content
        if (target === 'askdata' && window.QueryAnalysis) window.QueryAnalysis.activate();
        if (target === 'compare') renderCompareSection();
        if (window.MarketPulse) {
          if (target === 'pulse') window.MarketPulse.activate();
          else window.MarketPulse.deactivate();
        }
        if (window.VixTerm) {
          if (target === 'vixterm') window.VixTerm.activate();
          else window.VixTerm.deactivate();
        }
        if (window.StocksEcon) {
          if (target === 'stocks') window.StocksEcon.loadStocks();
          if (target === 'economics') window.StocksEcon.loadEconomics();
        }
        
        // Load calendar if tab is clicked (lazy load) or just show if already loaded
        if (target === 'calendar' && window.MarketCalendar && !window.MarketCalendar.loaded) {
          window.MarketCalendar.init();
          window.MarketCalendar.loaded = true;
        }
      });
    });

    // Restore saved tab
    const saved = localStorage.getItem('vix_active_tab');
    if (saved) {
      const btn = document.querySelector(`.tab-btn[data-tab="${saved}"]`);
      if (btn) btn.click();
    }
  }

  // ===========================================================
  //  THEME TOGGLE
  // ===========================================================
  function initTheme() {
    const toggle = document.getElementById('btn-theme-toggle');
    const saved = localStorage.getItem('vix_theme') || 'dark';
    applyTheme(saved);

    toggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      localStorage.setItem('vix_theme', next);
      // Re-render charts for new theme colors
      renderDashboard();
      if (currentSearchResults.length) renderSearchResultsChart(currentSearchResults.map(item => item.record));
      if (window.VixTerm) window.VixTerm.renderChart();
    });
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const toggle = document.getElementById('btn-theme-toggle');
    toggle.textContent = theme === 'dark' ? '☀️' : '🌙';
    toggle.title = theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
  }

  // ===========================================================
  //  DATE NAVIGATION
  // ===========================================================
  function renderDateSelector() {
    const select = document.getElementById('date-select');
    select.innerHTML = '';
    historyData.forEach((r, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      const d = new Date(r.date_to + 'T00:00:00');
      const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      opt.textContent = `${label}  —  ${r.market_context}`;
      opt.selected = i === selectedIdx;
      select.appendChild(opt);
    });

    document.getElementById('date-counter').textContent = `${selectedIdx + 1} / ${historyData.length}`;

    if (historyData.length > 0) {
      const first = new Date(historyData[0].date_to + 'T00:00:00');
      const last = new Date(historyData[historyData.length - 1].date_to + 'T00:00:00');
      const fmt = d => d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      document.getElementById('date-range-label').textContent = `${fmt(first)} — ${fmt(last)} · ${historyData.length} trading days`;
    }
  }

  document.getElementById('date-select').onchange = (e) => {
    selectDate(parseInt(e.target.value));
  };

  function selectDate(idx) {
    selectedIdx = idx;
    renderDateSelector();
    renderDashboard();
  }

  document.getElementById('btn-prev-date').onclick = () => {
    if (selectedIdx > 0) selectDate(selectedIdx - 1);
  };
  document.getElementById('btn-next-date').onclick = () => {
    if (selectedIdx < historyData.length - 1) selectDate(selectedIdx + 1);
  };

  // ===========================================================
  //  DASHBOARD RENDER
  // ===========================================================
  function renderDashboard() {
    const r = historyData[selectedIdx];
    if (!r) return;

    // Update Analysis Title dynamically
    const analysisTitle = document.getElementById('analysis-title');
    if (analysisTitle) {
      const d = new Date(r.date_to + 'T00:00:00');
      const dateStr = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      analysisTitle.innerHTML = `🧠 Analysis for ${dateStr}`;
    }

    // Market overview
    document.getElementById('spx-from').textContent = r.spx_from.toFixed(2);
    document.getElementById('spx-to').textContent = r.spx_to.toFixed(2);
    const spxChgEl = document.getElementById('spx-change');
    spxChgEl.textContent = `${r.spx_change_abs >= 0 ? '+' : ''}${r.spx_change_abs.toFixed(2)} (${r.spx_change_pct >= 0 ? '+' : ''}${r.spx_change_pct.toFixed(2)}%)`;
    spxChgEl.className = 'metric-change ' + (r.spx_change_abs >= 0 ? 'positive' : 'negative');
    document.getElementById('spx-open').textContent = r.spx_from.toFixed(2);
    document.getElementById('spx-high').textContent = r.spx_high ? r.spx_high.toFixed(2) : '--';
    document.getElementById('spx-low').textContent = r.spx_low ? r.spx_low.toFixed(2) : '--';
    document.getElementById('spx-close').textContent = r.spx_to.toFixed(2);

    document.getElementById('vix-from').textContent = r.vix_from.toFixed(2);
    document.getElementById('vix-to').textContent = r.vix_to.toFixed(2);
    const vixChgEl = document.getElementById('vix-change');
    vixChgEl.textContent = `${r.vix_change_abs >= 0 ? '+' : ''}${r.vix_change_abs.toFixed(2)} (${r.vix_change_pct >= 0 ? '+' : ''}${r.vix_change_pct.toFixed(2)}%)`;
    vixChgEl.className = 'metric-change ' + (r.vix_change_abs >= 0 ? 'positive' : 'negative');
    document.getElementById('vix-open').textContent = r.vix_from.toFixed(2);
    document.getElementById('vix-high').textContent = r.vix_high ? r.vix_high.toFixed(2) : '--';
    document.getElementById('vix-low').textContent = r.vix_low ? r.vix_low.toFixed(2) : '--';
    document.getElementById('vix-close').textContent = r.vix_to.toFixed(2);

    // SKEW
    if (r.skew_from !== undefined) {
      document.getElementById('skew-from').textContent = r.skew_from.toFixed(2);
      document.getElementById('skew-to').textContent = r.skew_to.toFixed(2);
      const skewChgEl = document.getElementById('skew-change');
      skewChgEl.textContent = `${r.skew_change_abs >= 0 ? '+' : ''}${r.skew_change_abs.toFixed(2)} (${r.skew_change_pct >= 0 ? '+' : ''}${r.skew_change_pct.toFixed(2)}%)`;
      skewChgEl.className = 'metric-change ' + (r.skew_change_abs >= 0 ? 'positive' : 'negative');
      document.getElementById('skew-open').textContent = r.skew_open ? r.skew_open.toFixed(2) : '--';
      document.getElementById('skew-high').textContent = r.skew_high ? r.skew_high.toFixed(2) : '--';
      document.getElementById('skew-low').textContent = r.skew_low ? r.skew_low.toFixed(2) : '--';
      document.getElementById('skew-close').textContent = r.skew_close ? r.skew_close.toFixed(2) : '--';
    } else {
      ['from', 'to', 'open', 'high', 'low', 'close'].forEach(f => {
        const el = document.getElementById(`skew-${f}`);
        if(el) el.textContent = '--';
      });
      document.getElementById('skew-change').textContent = '';
      document.getElementById('skew-change').className = 'metric-change';
    }

    // Context badge
    const badge = document.getElementById('market-context-badge');
    badge.textContent = r.market_context;
    badge.style.background = r.vix_change_abs < 0 ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)';
    badge.style.color = r.vix_change_abs < 0 ? '#10B981' : '#EF4444';
    badge.style.border = `1px solid ${r.vix_change_abs < 0 ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`;

    // Decomposition table
    renderDecompTable(r);

    // Charts
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    ChartsModule.createWaterfallChart('waterfall-chart', r, theme);
    if (ChartsModule.createVolCurveChart) {
      ChartsModule.createVolCurveChart('vol-curve-chart', r, theme);
    }

    // Analysis
    document.getElementById('analysis-text').innerHTML = AnalysisEngine.generateAnalysis(r);

    // Macro
    const macroText = document.getElementById('macro-text');
    macroText.innerHTML = r.macro_synopsis || "<em>Data not yet populated for this date.</em>";

    // User Notes
    const notesInput = document.getElementById('user-notes-input');
    notesInput.value = localStorage.getItem(`vix_notes_${r.date_to}`) || '';
    notesInput.oninput = (e) => {
      localStorage.setItem(`vix_notes_${r.date_to}`, e.target.value);
    };

    // Strategy
    document.getElementById('strategy-content').innerHTML = StrategyEngine.renderStrategyPanel(r, historyData);
  }

  const FACTOR_ORDER = [
    'sticky_strike', 'parallel_shift', 'put_skew',
    'call_skew', 'downside_convexity', 'upside_convexity'
  ];

  function renderDecompTable(r) {
    const tbody = document.getElementById('decomp-tbody');
    tbody.innerHTML = '';
    const maxAbs = Math.max(...FACTOR_ORDER.map(k => Math.abs(r[k])), 0.01);

    FACTOR_ORDER.forEach(key => {
      const def = componentDefs[key];
      const val = r[key];
      const tr = document.createElement('tr');

      const tdName = document.createElement('td');
      tdName.innerHTML = `<div class="factor-name">
        <span class="factor-icon">${def.icon}</span>
        <span>${def.name}</span>
      </div>`;

      const tdVal = document.createElement('td');
      const cls = val > 0 ? 'positive' : val < 0 ? 'negative' : '';
      tdVal.innerHTML = `<span class="factor-value ${cls}">${val >= 0 ? '+' : ''}${val.toFixed(2)}</span>`;

      const tdBar = document.createElement('td');
      const barPct = (Math.abs(val) / maxAbs) * 45;
      tdBar.innerHTML = `<div class="contribution-bar-wrapper">
        <div class="center-line"></div>
        <div class="contribution-bar ${val >= 0 ? 'positive' : 'negative'}" style="width:${barPct}%"></div>
      </div>`;

      const tdInfo = document.createElement('td');
      tdInfo.className = 'info-col';
      const btn = document.createElement('button');
      btn.className = 'info-btn';
      btn.textContent = 'i';
      btn.onclick = () => showInfoModal(key);
      tdInfo.appendChild(btn);

      tr.append(tdName, tdVal, tdBar, tdInfo);
      tbody.appendChild(tr);
    });

    const totalEl = document.getElementById('total-value');
    const totalCls = r.total > 0 ? 'positive' : r.total < 0 ? 'negative' : '';
    totalEl.innerHTML = `<span class="factor-value ${totalCls}">${r.total >= 0 ? '+' : ''}${r.total.toFixed(2)}</span>`;

    const totalBarCell = document.getElementById('total-bar-cell');
    const totalPct = (Math.abs(r.total) / maxAbs) * 45;
    totalBarCell.innerHTML = `<div class="contribution-bar-wrapper">
      <div class="center-line"></div>
      <div class="contribution-bar ${r.total >= 0 ? 'positive' : 'negative'}" style="width:${totalPct}%"></div>
    </div>`;
  }

  // ===========================================================
  //  INFO MODAL
  // ===========================================================
  function showInfoModal(key) {
    const def = componentDefs[key];
    if (!def) return;
    document.getElementById('modal-icon').textContent = def.icon;
    document.getElementById('modal-title').textContent = def.name;
    document.getElementById('modal-short').textContent = def.short;
    document.getElementById('modal-description').textContent = def.description;
    document.getElementById('modal-positive').textContent = def.positive;
    document.getElementById('modal-negative').textContent = def.negative;
    document.getElementById('modal-range').textContent = def.typical_range;
    document.getElementById('info-modal').classList.remove('hidden');
  }

  document.getElementById('modal-close').onclick = () => {
    document.getElementById('info-modal').classList.add('hidden');
  };
  document.querySelector('.modal-backdrop').onclick = () => {
    document.getElementById('info-modal').classList.add('hidden');
  };

  // ===========================================================
  //  PATTERN SEARCH SCOPE, INSIGHTS & CHARTS
  // ===========================================================
  function parseTradingDate(dateString) {
    return new Date(dateString + 'T00:00:00Z');
  }

  function getSearchScope() {
    return {
      preset: document.getElementById('search-range-preset').value,
      from: document.getElementById('search-date-from').value,
      to: document.getElementById('search-date-to').value,
      weekday: document.getElementById('search-weekday').value,
      event: document.getElementById('search-event').value,
    };
  }

  function eventMatchesFilter(event, filter) {
    const title = (event.title || '').toLowerCase();
    switch (filter) {
      case 'nfp': return /non-farm|nonfarm|payroll/.test(title);
      case 'cpi': return /\bcpi\b/.test(title);
      case 'ppi': return /\bppi\b/.test(title);
      case 'pce': return /\bpce\b/.test(title);
      case 'fomc': return event.type === 'fed' && /fomc|rate decision/.test(title);
      case 'opex': return event.type === 'opex' || event.type === 'triple_witch' || /options expiration/.test(title);
      case 'vix_expiry': return event.type === 'vix_expiry' || /vix.*expir/.test(title);
      case 'high_impact': return event.impact === 'high';
      default: return true;
    }
  }

  function applySearchScope(data) {
    const scope = getSearchScope();
    const from = scope.from || historyData[0]?.date_to;
    const to = scope.to || historyData[historyData.length - 1]?.date_to;
    let eventDates = null;

    if (scope.event !== 'any') {
      eventDates = new Set(
        marketEvents
          .filter(event => eventMatchesFilter(event, scope.event))
          .map(event => event.date)
      );
    }

    return data.filter(record => {
      if (from && record.date_to < from) return false;
      if (to && record.date_to > to) return false;
      if (scope.weekday !== 'any' && parseTradingDate(record.date_to).getUTCDay() !== Number(scope.weekday)) return false;
      if (eventDates && !eventDates.has(record.date_to)) return false;
      return true;
    });
  }

  function setSearchDateRange(preset) {
    if (!historyData.length) return;
    const fromInput = document.getElementById('search-date-from');
    const toInput = document.getElementById('search-date-to');
    const earliest = historyData[0].date_to;
    const latest = historyData[historyData.length - 1].date_to;

    if (preset === 'custom') {
      fromInput.disabled = false;
      toInput.disabled = false;
      return;
    }

    const end = parseTradingDate(latest);
    let start = parseTradingDate(earliest);
    if (preset === 'ytd') start = new Date(Date.UTC(end.getUTCFullYear(), 0, 1));
    if (preset === '3m') start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 3, end.getUTCDate()));
    if (preset === '6m') start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 6, end.getUTCDate()));
    if (preset === '1y') start = new Date(Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth(), end.getUTCDate()));

    const startString = start.toISOString().slice(0, 10);
    fromInput.value = startString < earliest ? earliest : startString;
    toInput.value = latest;
    fromInput.disabled = true;
    toInput.disabled = true;
  }

  function describeSearchScope() {
    const scope = getSearchScope();
    const weekdayLabels = { '1': 'Mondays', '2': 'Tuesdays', '3': 'Wednesdays', '4': 'Thursdays', '5': 'Fridays' };
    const eventLabels = {
      nfp: 'NFP days', cpi: 'CPI days', ppi: 'PPI days', pce: 'PCE days',
      fomc: 'FOMC days', opex: 'options-expiration days', vix_expiry: 'VIX-expiration days',
      high_impact: 'high-impact event days'
    };
    const parts = [];
    if (scope.weekday !== 'any') parts.push(weekdayLabels[scope.weekday]);
    if (scope.event !== 'any') parts.push(eventLabels[scope.event]);
    if (scope.preset !== 'all') parts.push(`${scope.from} to ${scope.to}`);
    return parts.length ? parts.join(' · ') : 'all available trading days';
  }

  function updateSearchScopePreview() {
    if (!historyData.length) return;
    const scoped = applySearchScope(historyData);
    const label = `${scoped.length} of ${historyData.length} trading days in scope`;
    document.getElementById('scope-match-count').textContent = `${scoped.length} days`;
    document.getElementById('search-scope-note').innerHTML = `<strong>${label}</strong><span>${describeSearchScope()}</span>`;
  }

  function rerunPatternSearchIfVisible() {
    updateSearchScopePreview();
    if (!document.getElementById('search-results').classList.contains('hidden')) runPatternSearch();
  }

  function populateSearchChartMetrics() {
    const primary = document.getElementById('search-chart-primary');
    const secondary = document.getElementById('search-chart-secondary');
    primary.innerHTML = '';
    secondary.innerHTML = '<option value="">None</option>';
    SEARCH_CHART_METRICS.forEach(metric => {
      const first = document.createElement('option');
      first.value = metric.key;
      first.textContent = metric.label;
      primary.appendChild(first);

      const second = first.cloneNode(true);
      secondary.appendChild(second);
    });
    primary.value = 'spx_change_pct';
    secondary.value = 'vix_change_pct';
  }

  function initSearchScope() {
    if (!historyData.length) return;
    const earliest = historyData[0].date_to;
    const latest = historyData[historyData.length - 1].date_to;
    const fromInput = document.getElementById('search-date-from');
    const toInput = document.getElementById('search-date-to');
    fromInput.min = earliest;
    fromInput.max = latest;
    toInput.min = earliest;
    toInput.max = latest;
    fromInput.value = earliest;
    toInput.value = latest;
    setSearchDateRange('all');
    populateSearchChartMetrics();
    updateSearchScopePreview();
  }

  function resetSearchScope() {
    document.getElementById('search-range-preset').value = 'all';
    document.getElementById('search-weekday').value = 'any';
    document.getElementById('search-event').value = 'any';
    setSearchDateRange('all');
    updateSearchScopePreview();
  }

  function averageMetric(records, key) {
    const values = records.map(record => Number(record[key])).filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }

  function signedMetric(value, suffix = '%') {
    if (!Number.isFinite(value)) return '—';
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}${suffix}`;
  }

  function renderSearchInsights(records) {
    const container = document.getElementById('search-insights');
    const chartPanel = document.getElementById('search-chart-panel');
    if (!records.length) {
      container.innerHTML = '<div class="search-empty-insight">No statistics to calculate for this sample.</div>';
      chartPanel.classList.add('hidden');
      if (searchResultsChart) {
        searchResultsChart.destroy();
        searchResultsChart = null;
      }
      return;
    }

    const avgSpx = averageMetric(records, 'spx_change_pct');
    const avgVix = averageMetric(records, 'vix_change_pct');
    const avgCallSkew = averageMetric(records, 'call_skew');
    const upDays = records.filter(record => Number(record.spx_change_pct) > 0).length;
    const upRate = upDays / records.length * 100;
    const dates = records.map(record => record.date_to).sort();

    container.innerHTML = `
      <div class="search-insight-card">
        <span>Matched sessions</span>
        <strong>${records.length}</strong>
        <small>${dates[0]} — ${dates[dates.length - 1]}</small>
      </div>
      <div class="search-insight-card">
        <span>Average S&amp;P 500 move</span>
        <strong class="${avgSpx >= 0 ? 'positive' : 'negative'}">${signedMetric(avgSpx)}</strong>
        <small>${upRate.toFixed(1)}% of matched days finished up</small>
      </div>
      <div class="search-insight-card">
        <span>Average VIX move</span>
        <strong class="${avgVix <= 0 ? 'positive' : 'negative'}">${signedMetric(avgVix)}</strong>
        <small>Average across the selected sample</small>
      </div>
      <div class="search-insight-card">
        <span>Average call skew</span>
        <strong class="${avgCallSkew >= 0 ? 'positive' : 'negative'}">${signedMetric(avgCallSkew, '')}</strong>
        <small>Decomposition contribution</small>
      </div>`;
    chartPanel.classList.remove('hidden');
  }

  function getChartMetric(key) {
    return SEARCH_CHART_METRICS.find(metric => metric.key === key);
  }

  function renderSearchResultsChart(records) {
    const canvas = document.getElementById('search-results-chart');
    if (!canvas || !records.length || typeof Chart === 'undefined') return;
    if (searchResultsChart) searchResultsChart.destroy();

    const chartType = document.getElementById('search-chart-type').value;
    const primaryKey = document.getElementById('search-chart-primary').value;
    let secondaryKey = document.getElementById('search-chart-secondary').value;
    if (chartType === 'scatter' && !secondaryKey) {
      secondaryKey = primaryKey === 'vix_change_pct' ? 'spx_change_pct' : 'vix_change_pct';
      document.getElementById('search-chart-secondary').value = secondaryKey;
    }

    const primaryMetric = getChartMetric(primaryKey);
    const secondaryMetric = getChartMetric(secondaryKey);
    const sorted = [...records].sort((a, b) => a.date_to.localeCompare(b.date_to));
    const stride = Math.max(1, Math.ceil(sorted.length / 500));
    const plotted = sorted.filter((_, index) => index % stride === 0 || index === sorted.length - 1);
    const styles = getComputedStyle(document.documentElement);
    const purple = styles.getPropertyValue('--accent-purple').trim() || '#6C5CE7';
    const cyan = styles.getPropertyValue('--accent-cyan').trim() || '#06B6D4';
    const grid = styles.getPropertyValue('--chart-grid').trim() || 'rgba(255,255,255,.06)';
    const ticks = styles.getPropertyValue('--chart-tick').trim() || '#64748b';
    const note = document.getElementById('search-chart-note');
    const sample = document.getElementById('search-chart-sample');
    sample.textContent = `${plotted.length} plotted session${plotted.length === 1 ? '' : 's'}`;
    note.textContent = stride > 1
      ? `For readability, the chart shows an evenly spaced sample of ${plotted.length} from ${sorted.length} matched sessions. Result statistics still use every match.`
      : 'Hover a point or bar to see the trading date and exact value.';

    const baseOptions = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: chartType === 'scatter' ? 'nearest' : 'index', intersect: false },
      plugins: {
        legend: { labels: { color: ticks, usePointStyle: true, boxWidth: 8 } },
        tooltip: {
          callbacks: {
            afterTitle: items => chartType === 'scatter' && items[0]?.raw?.date ? items[0].raw.date : ''
          }
        }
      }
    };

    if (chartType === 'scatter') {
      searchResultsChart = new Chart(canvas, {
        type: 'scatter',
        data: {
          datasets: [{
            label: `${primaryMetric.label} vs ${secondaryMetric.label}`,
            data: plotted.map(record => ({ x: Number(record[primaryKey]), y: Number(record[secondaryKey]), date: record.date_to })),
            backgroundColor: purple + 'B8',
            borderColor: purple,
            pointRadius: plotted.length > 180 ? 3 : 4,
            pointHoverRadius: 6,
          }]
        },
        options: {
          ...baseOptions,
          scales: {
            x: { title: { display: true, text: primaryMetric.label, color: ticks }, grid: { color: grid }, ticks: { color: ticks } },
            y: { title: { display: true, text: secondaryMetric.label, color: ticks }, grid: { color: grid }, ticks: { color: ticks } }
          }
        }
      });
      return;
    }

    const datasets = [{
      label: primaryMetric.label,
      data: plotted.map(record => Number(record[primaryKey])),
      borderColor: purple,
      backgroundColor: chartType === 'bar' ? purple + '99' : purple + '24',
      pointBackgroundColor: purple,
      pointRadius: plotted.length > 120 ? 0 : 2,
      pointHoverRadius: 5,
      borderWidth: 2,
      tension: 0.18,
      fill: chartType === 'line',
      yAxisID: 'y',
    }];
    if (secondaryMetric) {
      datasets.push({
        label: secondaryMetric.label,
        data: plotted.map(record => Number(record[secondaryKey])),
        borderColor: cyan,
        backgroundColor: chartType === 'bar' ? cyan + '88' : cyan + '18',
        pointBackgroundColor: cyan,
        pointRadius: plotted.length > 120 ? 0 : 2,
        pointHoverRadius: 5,
        borderWidth: 2,
        tension: 0.18,
        fill: false,
        yAxisID: 'y1',
      });
    }

    searchResultsChart = new Chart(canvas, {
      type: chartType,
      data: { labels: plotted.map(record => record.date_to), datasets },
      options: {
        ...baseOptions,
        scales: {
          x: { grid: { display: false }, ticks: { color: ticks, maxTicksLimit: 12, maxRotation: 0 } },
          y: { position: 'left', title: { display: true, text: primaryMetric.label, color: ticks }, grid: { color: grid }, ticks: { color: ticks } },
          ...(secondaryMetric ? { y1: { position: 'right', title: { display: true, text: secondaryMetric.label, color: ticks }, grid: { drawOnChartArea: false }, ticks: { color: ticks } } } : {})
        }
      }
    });
  }

  function runPatternSearch() {
    const scopedData = applySearchScope(historyData);
    const results = SearchEngine.applyFilters(scopedData, filterRules);
    showSearchResults(results, `Pattern Results · ${describeSearchScope()}`);
  }

  document.getElementById('search-range-preset').onchange = event => {
    setSearchDateRange(event.target.value);
    rerunPatternSearchIfVisible();
  };
  document.getElementById('search-date-from').onchange = rerunPatternSearchIfVisible;
  document.getElementById('search-date-to').onchange = rerunPatternSearchIfVisible;
  document.getElementById('search-weekday').onchange = rerunPatternSearchIfVisible;
  document.getElementById('search-event').onchange = rerunPatternSearchIfVisible;
  document.getElementById('btn-update-search-chart').onclick = () => {
    renderSearchResultsChart(currentSearchResults.map(item => item.record));
  };

  // ===========================================================
  //  FILTER RULES (AND/OR)
  // ===========================================================
  function addFilterRule() {
    const ruleId = Date.now();
    filterRules.push({ id: ruleId, field: 'sticky_strike', operator: 'gt', value: '', value2: '', logic: 'and' });
    renderFilterRules();
  }

  function removeFilterRule(id) {
    filterRules = filterRules.filter(r => r.id !== id);
    renderFilterRules();
  }

  function renderFilterRules() {
    const container = document.getElementById('filter-rules');
    container.innerHTML = '';

    filterRules.forEach((rule, idx) => {
      const div = document.createElement('div');
      div.className = 'filter-rule';

      // AND/OR toggle (between rules, not before first)
      if (idx > 0) {
        const toggleWrapper = document.createElement('div');
        toggleWrapper.className = 'logic-toggle';

        const andBtn = document.createElement('button');
        andBtn.className = 'logic-toggle-option' + (rule.logic === 'and' ? ' active-and' : '');
        andBtn.textContent = 'AND';
        andBtn.onclick = () => { rule.logic = 'and'; renderFilterRules(); };

        const orBtn = document.createElement('button');
        orBtn.className = 'logic-toggle-option' + (rule.logic === 'or' ? ' active-or' : '');
        orBtn.textContent = 'OR';
        orBtn.onclick = () => { rule.logic = 'or'; renderFilterRules(); };

        toggleWrapper.append(andBtn, orBtn);
        div.appendChild(toggleWrapper);
      }

      // Variable select
      const varSelect = document.createElement('select');
      varSelect.className = 'rule-variable';
      SearchEngine.SEARCHABLE_FIELDS.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.key;
        opt.textContent = f.label;
        opt.selected = rule.field === f.key;
        varSelect.appendChild(opt);
      });
      varSelect.onchange = e => { rule.field = e.target.value; };

      // Operator select
      const opSelect = document.createElement('select');
      opSelect.className = 'rule-operator';
      SearchEngine.OPERATORS.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.key;
        opt.textContent = o.label;
        opt.selected = rule.operator === o.key;
        opSelect.appendChild(opt);
      });
      opSelect.onchange = e => { rule.operator = e.target.value; renderFilterRules(); };

      // Value input
      const valInput = document.createElement('input');
      valInput.type = 'number';
      valInput.step = '0.01';
      valInput.className = 'rule-value';
      valInput.placeholder = 'Value';
      valInput.value = rule.value;
      valInput.oninput = e => { rule.value = e.target.value; };

      div.append(varSelect, opSelect, valInput);

      // Between range
      if (rule.operator === 'between') {
        const andSpan = document.createElement('span');
        andSpan.style.color = 'var(--text-muted)';
        andSpan.style.fontSize = '0.8rem';
        andSpan.textContent = 'and';

        const val2Input = document.createElement('input');
        val2Input.type = 'number';
        val2Input.step = '0.01';
        val2Input.className = 'rule-value2';
        val2Input.placeholder = 'Max';
        val2Input.value = rule.value2;
        val2Input.oninput = e => { rule.value2 = e.target.value; };

        div.append(andSpan, val2Input);
      }

      // Remove button
      const removeBtn = document.createElement('button');
      removeBtn.className = 'rule-remove';
      removeBtn.innerHTML = '×';
      removeBtn.onclick = () => removeFilterRule(rule.id);
      div.appendChild(removeBtn);

      container.appendChild(div);
    });
  }

  document.getElementById('btn-add-rule').onclick = addFilterRule;
  document.getElementById('btn-clear-filters').onclick = () => {
    filterRules = [];
    renderFilterRules();
    resetSearchScope();
    document.getElementById('search-results').classList.add('hidden');
    if (searchResultsChart) {
      searchResultsChart.destroy();
      searchResultsChart = null;
    }
  };

  document.getElementById('btn-search').onclick = runPatternSearch;

  document.getElementById('btn-find-similar').onclick = () => {
    const ref = historyData[selectedIdx];
    const scopedData = applySearchScope(historyData);
    const results = SearchEngine.findSimilar(ref, scopedData, 10);
    showSimilarResults(results, ref);
  };

  // ===========================================================
  //  SEARCH RESULTS (expanded details)
  // ===========================================================
  function buildResultMetrics(r) {
    const metrics = [
      { label: 'SPX Close', value: r.spx_to, fmt: v => v.toFixed(2) },
      { label: 'SPX Change', value: r.spx_change_pct, fmt: v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%', color: r.spx_change_pct >= 0 },
      { label: 'VIX Close', value: r.vix_to, fmt: v => v.toFixed(2) },
      { label: 'VIX Change', value: r.vix_change_pct, fmt: v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%', color: r.vix_change_pct < 0 },
      { label: 'SKEW Level', value: r.skew_to, fmt: v => v ? v.toFixed(2) : '--' },
      { label: 'Sticky Strike', value: r.sticky_strike, fmt: v => (v >= 0 ? '+' : '') + v.toFixed(2) },
      { label: 'Parallel Shift', value: r.parallel_shift, fmt: v => (v >= 0 ? '+' : '') + v.toFixed(2) },
      { label: 'Put Skew', value: r.put_skew, fmt: v => (v >= 0 ? '+' : '') + v.toFixed(2) },
      { label: 'Call Skew', value: r.call_skew, fmt: v => (v >= 0 ? '+' : '') + v.toFixed(2) },
      { label: 'Down Conv', value: r.downside_convexity, fmt: v => (v >= 0 ? '+' : '') + v.toFixed(2) },
      { label: 'Up Conv', value: r.upside_convexity, fmt: v => (v >= 0 ? '+' : '') + v.toFixed(2) },
      { label: 'Total VIX', value: r.total, fmt: v => (v >= 0 ? '+' : '') + v.toFixed(2) },
    ];

    let html = '<div class="result-metric-grid">';
    metrics.forEach(m => {
      const val = m.value;
      let colorClass = '';
      if (typeof val === 'number') {
        colorClass = val >= 0 ? 'positive' : 'negative';
      }
      html += `<div class="result-metric-item">
        <div class="result-metric-label">${m.label}</div>
        <div class="result-metric-value factor-value ${colorClass}">${m.fmt(val)}</div>
      </div>`;
    });
    html += '</div>';

    // Macro synopsis
    if (r.macro_synopsis) {
      html += `<div class="result-macro"><strong>Macro:</strong> ${r.macro_synopsis}</div>`;
    }

    return html;
  }

  function createResultCard(r, extraHtml = '') {
    const card = document.createElement('div');
    card.className = 'result-card';

    const ctxColor = r.vix_change_abs < 0 ? '#10B981' : '#EF4444';
    const detailId = 'detail-' + r.date_to.replace(/-/g, '');

    card.innerHTML = `
      <div class="result-card-summary">
        <div class="result-date">${r.date_from} → ${r.date_to}</div>
        <div class="result-summary-content">${SearchEngine.shortSummary(r)}</div>
        <div class="result-actions">
          <span class="result-context" style="background:${ctxColor}20;color:${ctxColor};border:1px solid ${ctxColor}40">${r.market_context}</span>
          ${extraHtml}
          <button class="result-expand-btn" data-target="${detailId}">▼ Details</button>
        </div>
      </div>
      <div class="result-details" id="${detailId}">
        ${buildResultMetrics(r)}
      </div>
    `;

    // Click summary to select date
    card.querySelector('.result-card-summary').addEventListener('click', (e) => {
      if (e.target.closest('.result-expand-btn')) return;
      const idx = historyData.findIndex(h => h.date_to === r.date_to);
      if (idx >= 0) {
        selectDate(idx);
        // Switch to dashboard tab
        document.querySelector('.tab-btn[data-tab="dashboard"]').click();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });

    // Expand/collapse
    card.querySelector('.result-expand-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const details = document.getElementById(detailId);
      const btn = e.currentTarget;
      if (details.classList.contains('expanded')) {
        details.classList.remove('expanded');
        btn.textContent = '▼ Details';
      } else {
        details.classList.add('expanded');
        btn.textContent = '▲ Hide';
      }
    });

    return card;
  }

  function showSearchResults(results, title) {
    currentSearchResults = results.map(r => ({ record: r }));
    currentSearchTitle = title;
    currentSearchRef = null;
    sortAndRenderResults();
  }

  function showSimilarResults(results, ref) {
    currentSearchResults = results; // results is already [{record, similarity}]
    currentSearchTitle = `Days Similar to ${ref.date_to}`;
    currentSearchRef = ref;
    
    // Default sort for similarity is 'similarity' desc
    const sortSelect = document.getElementById('sort-results');
    if (sortSelect) sortSelect.value = 'similarity';
    
    sortAndRenderResults();
  }

  function sortAndRenderResults() {
    const sortBy = document.getElementById('sort-results').value;
    const results = [...currentSearchResults];

    results.sort((a, b) => {
      const ra = a.record;
      const rb = b.record;
      switch (sortBy) {
        case 'date_desc': return rb.date_to.localeCompare(ra.date_to);
        case 'date_asc': return ra.date_to.localeCompare(rb.date_to);
        case 'vix_spike': return rb.vix_change_pct - ra.vix_change_pct;
        case 'vix_crush': return ra.vix_change_pct - rb.vix_change_pct;
        case 'spx_rally': return rb.spx_change_pct - ra.spx_change_pct;
        case 'spx_selloff': return ra.spx_change_pct - rb.spx_change_pct;
        case 'similarity': 
          if (a.similarity !== undefined && b.similarity !== undefined) {
             return b.similarity - a.similarity;
          }
          return 0;
        default: return 0;
      }
    });

    const section = document.getElementById('search-results');
    section.classList.remove('hidden');
    document.getElementById('results-title').textContent = currentSearchTitle;
    document.getElementById('results-count').textContent = `${results.length} match${results.length !== 1 ? 'es' : ''}`;

    const resultRecords = results.map(item => item.record);
    renderSearchInsights(resultRecords);
    if (resultRecords.length) renderSearchResultsChart(resultRecords);

    const list = document.getElementById('results-list');
    list.innerHTML = '';

    if (results.length === 0) {
      list.innerHTML = `<div class="no-results">No matching dates found. Try adjusting your filters.</div>`;
      return;
    }

    results.forEach(({ record: r, similarity }) => {
      let extra = '';
      if (similarity !== undefined) {
        const simPct = (similarity * 100).toFixed(0);
        extra = `<span class="result-similarity">(${simPct}% similar)</span>`;
      }
      list.appendChild(createResultCard(r, extra));
    });
  }

  document.getElementById('sort-results').onchange = sortAndRenderResults;

  // ===========================================================
  //  MULTI-DATE COMPARE
  // ===========================================================
  function fmtDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  }

  function renderCompareSection() {
    renderCompareTags();
    renderCompareAddSelect();
    renderCompareMetricSelector();
    renderCompareTable();
    renderSimilarityMatrix();
    renderCompareMacros();
  }

  function renderCompareTags() {
    const container = document.getElementById('compare-tags');
    container.innerHTML = '';

    if (compareIndices.length === 0) {
      container.innerHTML = '<span style="color:var(--text-muted); font-size:0.82rem;">No dates selected. Add dates from the dropdown →</span>';
      return;
    }

    compareIndices.forEach((idx, i) => {
      const r = historyData[idx];
      const tag = document.createElement('span');
      tag.className = 'compare-tag';

      const colors = ['#6C5CE7', '#3B82F6', '#10B981', '#F59E0B', '#EC4899'];
      tag.style.borderColor = colors[i % colors.length];
      tag.style.background = colors[i % colors.length] + '18';
      tag.style.color = colors[i % colors.length];

      tag.innerHTML = `${fmtDate(r.date_to)} <button class="compare-tag-remove" data-idx="${i}">×</button>`;
      container.appendChild(tag);
    });

    container.querySelectorAll('.compare-tag-remove').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const removeI = parseInt(btn.dataset.idx);
        compareIndices.splice(removeI, 1);
        renderCompareSection();
      };
    });
  }

  function renderCompareAddSelect() {
    const sel = document.getElementById('compare-add-select');
    sel.innerHTML = '<option value="">+ Add date...</option>';
    historyData.forEach((r, i) => {
      if (compareIndices.includes(i)) return; // already selected
      const opt = document.createElement('option');
      opt.value = i;
      const d = new Date(r.date_to + 'T00:00:00');
      opt.textContent = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      sel.appendChild(opt);
    });

    sel.onchange = () => {
      const val = parseInt(sel.value);
      if (!isNaN(val) && compareIndices.length < 5 && !compareIndices.includes(val)) {
        compareIndices.push(val);
        renderCompareSection();
      }
      sel.value = '';
    };
  }

  function renderCompareMetricSelector() {
    const container = document.getElementById('compare-metric-selector');
    container.innerHTML = '';

    ALL_COMPARE_METRICS.forEach(m => {
      const chip = document.createElement('button');
      chip.className = 'metric-chip' + (compareMetrics.includes(m.key) ? ' selected' : '');
      chip.textContent = m.label;
      chip.onclick = () => {
        if (compareMetrics.includes(m.key)) {
          compareMetrics = compareMetrics.filter(k => k !== m.key);
        } else {
          compareMetrics.push(m.key);
        }
        renderCompareMetricSelector();
        renderCompareTable();
      };
      container.appendChild(chip);
    });
  }

  function renderCompareTable() {
    const thead = document.getElementById('compare-thead');
    const tbody = document.getElementById('compare-tbody');

    if (compareIndices.length === 0) {
      thead.innerHTML = '';
      tbody.innerHTML = '<tr><td style="padding:40px;text-align:center;color:var(--text-muted);">Select dates above to start comparing.</td></tr>';
      return;
    }

    // Build header
    const colors = ['#6C5CE7', '#3B82F6', '#10B981', '#F59E0B', '#EC4899'];
    let headerHtml = '<tr><th style="text-align:left;padding:10px 14px;font-size:0.72rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid var(--glass-border);">Metric</th>';
    compareIndices.forEach((idx, i) => {
      const r = historyData[idx];
      headerHtml += `<th style="text-align:right;padding:10px 14px;font-size:0.72rem;font-weight:600;color:${colors[i % colors.length]};text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid var(--glass-border);">${fmtDate(r.date_to)}</th>`;
    });
    headerHtml += '</tr>';
    thead.innerHTML = headerHtml;

    // Build body
    tbody.innerHTML = '';
    const selectedMetrics = ALL_COMPARE_METRICS.filter(m => compareMetrics.includes(m.key));

    // Get min/max for heatmap coloring
    selectedMetrics.forEach(m => {
      const values = compareIndices.map(idx => historyData[idx][m.key]).filter(v => v != null);
      const min = Math.min(...values);
      const max = Math.max(...values);

      const tr = document.createElement('tr');
      tr.style.transition = 'background 150ms ease';
      tr.onmouseenter = () => tr.style.background = 'rgba(99, 102, 241, 0.05)';
      tr.onmouseleave = () => tr.style.background = 'transparent';

      const tdLabel = document.createElement('td');
      tdLabel.textContent = m.label;
      tdLabel.style.fontWeight = '500';
      tdLabel.style.padding = '14px';
      tdLabel.style.borderBottom = '1px solid rgba(255,255,255,0.03)';
      tr.appendChild(tdLabel);

      compareIndices.forEach(idx => {
        const val = historyData[idx][m.key];
        const td = document.createElement('td');
        td.className = 'heatmap-cell';
        td.style.borderBottom = '1px solid rgba(255,255,255,0.03)';

        if (val != null) {
          td.textContent = (typeof val === 'number') ? ((val >= 0 && m.key !== 'spx_to' && m.key !== 'vix_from' && m.key !== 'vix_to' && m.key !== 'skew_to') ? '+' : '') + val.toFixed(2) : val;

          // Heatmap color intensity
          if (max !== min && typeof val === 'number') {
            const normalized = (val - min) / (max - min);
            const isFactorMetric = ['sticky_strike','parallel_shift','put_skew','call_skew','downside_convexity','upside_convexity','total','vix_change_abs','vix_change_pct','spx_change_pct','skew_change_abs'].includes(m.key);
            if (isFactorMetric) {
              if (val >= 0) {
                td.style.background = `rgba(16,185,129,${0.05 + normalized * 0.15})`;
                td.style.color = 'var(--accent-green)';
              } else {
                td.style.background = `rgba(239,68,68,${0.05 + (1 - normalized) * 0.15})`;
                td.style.color = 'var(--accent-red)';
              }
            }
          }
        } else {
          td.textContent = '--';
          td.style.color = 'var(--text-muted)';
        }

        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });
  }

  function renderSimilarityMatrix() {
    const container = document.getElementById('similarity-grid');
    if (compareIndices.length < 2) {
      container.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">Select at least 2 dates to see similarity scores.</p>';
      return;
    }

    const n = compareIndices.length;
    const colors = ['#6C5CE7', '#3B82F6', '#10B981', '#F59E0B', '#EC4899'];

    let html = `<div style="display:grid; grid-template-columns: auto repeat(${n}, 1fr); gap:4px;">`;

    // Header row
    html += '<div></div>';
    compareIndices.forEach((idx, i) => {
      html += `<div class="similarity-cell-header" style="color:${colors[i % colors.length]}">${fmtDate(historyData[idx].date_to)}</div>`;
    });

    // Data rows
    compareIndices.forEach((idxA, i) => {
      const rA = historyData[idxA];
      html += `<div class="similarity-cell-header" style="text-align:right; color:${colors[i % colors.length]}">${fmtDate(rA.date_to)}</div>`;

      compareIndices.forEach((idxB, j) => {
        const rB = historyData[idxB];
        const vecA = SearchEngine.FACTOR_KEYS.map(k => rA[k]);
        const vecB = SearchEngine.FACTOR_KEYS.map(k => rB[k]);
        const sim = SearchEngine.cosineSimilarity(vecA, vecB);
        const pct = (sim * 100).toFixed(0);

        let bg, textColor;
        if (i === j) {
          bg = 'rgba(99,102,241,0.08)';
          textColor = 'var(--text-muted)';
        } else if (sim >= 0.9) {
          bg = 'rgba(16,185,129,0.18)';
          textColor = 'var(--accent-green)';
        } else if (sim >= 0.7) {
          bg = 'rgba(59,130,246,0.15)';
          textColor = 'var(--accent-blue)';
        } else if (sim >= 0.4) {
          bg = 'rgba(245,158,11,0.12)';
          textColor = 'var(--accent-orange)';
        } else {
          bg = 'rgba(239,68,68,0.1)';
          textColor = 'var(--accent-red)';
        }

        html += `<div class="similarity-cell" style="background:${bg}; color:${textColor};">${pct}%</div>`;
      });
    });

    html += '</div>';
    container.innerHTML = html;
  }

  function renderCompareMacros() {
    const container = document.getElementById('compare-macros');
    if (compareIndices.length === 0) {
      container.innerHTML = '';
      return;
    }

    const colors = ['#6C5CE7', '#3B82F6', '#10B981', '#F59E0B', '#EC4899'];
    let html = '<div class="section-header"><h2>📰 Macro Context for Selected Dates</h2></div>';

    compareIndices.forEach((idx, i) => {
      const r = historyData[idx];
      html += `<div class="compare-macro-card" style="border-left-color:${colors[i % colors.length]}">
        <div class="compare-macro-date" style="color:${colors[i % colors.length]}">${fmtDate(r.date_to)} — ${r.market_context}</div>
        <div class="compare-macro-text">${r.macro_synopsis || '<em>No macro data available.</em>'}</div>
      </div>`;
    });

    container.innerHTML = html;
  }

  // ===========================================================
  //  SYNC DATA
  // ===========================================================
  function initSync() {
    const syncBtn = document.getElementById('btn-sync-data');
    if (!syncBtn) return;

    syncBtn.onclick = async () => {
      const originalText = syncBtn.innerHTML;
      try {
        syncBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" class="spin-anim"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-dasharray="31.4 31.4" stroke-dashoffset="0" stroke-linecap="round"/></svg> SYNCING...`;
        syncBtn.disabled = true;

        const res = await fetch('/api/sync', { method: 'POST' });
        if (!res.ok) throw new Error('Sync failed');

        if ('caches' in window) {
          const names = await caches.keys();
          await Promise.all(names.map(n => caches.delete(n)));
        }

        window.location.reload(true);
      } catch (err) {
        console.error(err);
        syncBtn.innerHTML = `⚠️ ERROR`;
        setTimeout(() => {
          syncBtn.innerHTML = originalText;
          syncBtn.disabled = false;
        }, 3000);
      }
    };
  }

  // ===========================================================
  //  INIT
  // ===========================================================
  initSync();
  try {
    await loadData();
    if (window.rrModel) {
      await window.rrModel.init();
    }
    initTabs();
    initTheme();
    renderDateSelector();
    renderDashboard();
    if (window.QueryAnalysis) window.QueryAnalysis.init(historyData);
    initSearchScope();
    addFilterRule();
    if (window.MarketPulse) window.MarketPulse.init();
    if (window.VixTerm) window.VixTerm.init();
    if (window.StocksEcon) window.StocksEcon.init();
  } catch (err) {
    console.error("Initialization failed:", err);
    const mainEl = document.getElementById('app-main');
    if (mainEl) {
      const errCard = document.createElement('div');
      errCard.className = 'glass-card error-card';
      errCard.style.border = '1px solid #EF4444';
      errCard.style.padding = '20px';
      errCard.style.margin = '20px 0';
      errCard.innerHTML = `
        <h3 style="color:#EF4444; margin-top:0;">⚠️ Failed to Load Data</h3>
        <p>There was an error loading the MarketScope dataset: <code>${err.message}</code></p>
        <p>This is often caused by cached assets from a previous version. Please try the following:</p>
        <ol style="margin-left: 20px; line-height: 1.6;">
          <li>Click the <strong>SYNC DATA</strong> button in the top right to force a refresh.</li>
          <li>Perform a hard reload (<strong>Ctrl + F5</strong> or <strong>Cmd + Shift + R</strong>).</li>
        </ol>
      `;
      mainEl.prepend(errCard);
    }
  }
})();
