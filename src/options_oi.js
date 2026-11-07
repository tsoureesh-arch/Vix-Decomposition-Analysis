/**
 * SPX Options OI — live delayed Cboe chain, strike positioning and local OI snapshots.
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const SNAPSHOT_KEY = 'marketscope_options_oi_snapshot_v1';
  const chartMetric = { selected: 'oi', aggregate: 'oi' };
  let payload = null;
  let selectedChart = null;
  let aggregateChart = null;
  let selectedStrike = null;
  let snapshotState = null;
  let initialized = false;
  let loading = false;
  let active = false;
  let timer = null;
  let lastLoaded = 0;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function isFiniteValue(value) {
    return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  }

  function number(value, digits = 0) {
    if (!isFiniteValue(value)) return '—';
    return Number(value).toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function compact(value) {
    if (!isFiniteValue(value)) return '—';
    return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value));
  }

  function strikeLabel(value) {
    if (!isFiniteValue(value)) return '—';
    const n = Number(value);
    return Number.isInteger(n) ? number(n, 0) : number(n, 1);
  }

  function formatIv(leg) {
    return leg && isFiniteValue(leg.iv) ? `${number(Number(leg.iv) * 100, 1)}%` : '—';
  }

  function formatPrice(value) {
    return isFiniteValue(value) ? number(value, 2) : '—';
  }

  function expiryText(meta) {
    if (!meta) return '—';
    const date = new Date(`${meta.date}T00:00:00Z`);
    const label = date.toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
    return `${label} · ${meta.settlement} ${meta.series} · ${meta.dte} DTE`;
  }

  function optionKey(meta) {
    return `${meta.date}|${meta.series}`;
  }

  function parseOptionKey(value) {
    const [expiry, series] = String(value || '').split('|');
    return { expiry, series };
  }

  function populateExpirations() {
    const select = $('options-expiry');
    if (!select || !payload) return;
    const current = optionKey(payload.selected);
    select.innerHTML = payload.expirations.map(meta =>
      `<option value="${escapeHtml(optionKey(meta))}">${escapeHtml(expiryText(meta))}</option>`
    ).join('');
    select.value = current;
    select.disabled = false;
  }

  function snapshotRowKey(scope, strike) {
    if (scope === 'aggregate') {
      const horizon = payload.aggregate.days == null ? 'all' : payload.aggregate.days;
      return `A|${horizon}|${strike}`;
    }
    return `S|${payload.selected.date}|${payload.selected.series}|${strike}`;
  }

  function updateSnapshots() {
    if (!payload) return;
    const sessionDate = String(payload.asof || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || 'null'); } catch (_) { stored = null; }
    if (!stored || !stored.current || !stored.currentDate) {
      stored = { currentDate: sessionDate, current: {}, previousDate: null, previous: {} };
    } else if (stored.currentDate !== sessionDate) {
      stored = {
        currentDate: sessionDate,
        current: {},
        previousDate: stored.currentDate,
        previous: stored.current,
      };
    }

    payload.rows.forEach(row => {
      stored.current[snapshotRowKey('selected', row.strike)] = { call: row.call_oi, put: row.put_oi };
    });
    payload.aggregate.rows.forEach(row => {
      stored.current[snapshotRowKey('aggregate', row.strike)] = { call: row.call_oi, put: row.put_oi };
    });
    snapshotState = stored;
    try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(stored)); } catch (_) { /* storage is optional */ }
  }

  function oiChange(scope, row, side) {
    if (!snapshotState || !snapshotState.previousDate || !row) return null;
    const previous = snapshotState.previous[snapshotRowKey(scope, row.strike)];
    if (!previous || !Number.isFinite(Number(previous[side]))) return null;
    const current = side === 'call' ? row.call_oi : row.put_oi;
    return Number(current) - Number(previous[side]);
  }

  function changeHtml(value) {
    if (!isFiniteValue(value)) return '<span>—</span>';
    const n = Number(value);
    const cls = n > 0 ? 'oi-change-up' : n < 0 ? 'oi-change-down' : '';
    return `<span class="${cls}">${n > 0 ? '+' : ''}${number(n)}</span>`;
  }

  function renderSummary() {
    const el = $('options-summary');
    if (!el || !payload) return;
    const selected = payload.summary;
    const overall = payload.aggregate.summary;
    const horizon = payload.aggregate.days == null ? 'all listed expiries' : `next ${payload.aggregate.days} days`;
    const cards = [
      { label: 'SPX Reference', value: strikeLabel(payload.spot), sub: 'Cboe delayed index value' },
      { label: 'Support candidate', value: overall.put_wall ? strikeLabel(overall.put_wall.strike) : '—', sub: overall.put_wall ? `${compact(overall.put_wall.oi)} aggregate put OI · ${horizon}` : 'No put wall in range', cls: 'support' },
      { label: 'Resistance candidate', value: overall.call_wall ? strikeLabel(overall.call_wall.strike) : '—', sub: overall.call_wall ? `${compact(overall.call_wall.oi)} aggregate call OI · ${horizon}` : 'No call wall in range', cls: 'resistance' },
      { label: 'Selected P/C OI', value: selected.put_call_oi_ratio == null ? '—' : number(selected.put_call_oi_ratio, 2), sub: `${compact(selected.put_oi)} puts / ${compact(selected.call_oi)} calls` },
      { label: 'Selected volume', value: compact(selected.total_volume), sub: `${compact(selected.call_volume)} calls · ${compact(selected.put_volume)} puts` },
      { label: 'Max-pain estimate', value: selected.max_pain == null ? '—' : strikeLabel(selected.max_pain), sub: 'Minimum intrinsic payout at expiry' },
    ];
    el.innerHTML = cards.map(card => `<div class="options-stat-card ${card.cls || ''}">
      <div class="options-stat-label">${escapeHtml(card.label)}</div>
      <div class="options-stat-value">${escapeHtml(card.value)}</div>
      <div class="options-stat-sub">${escapeHtml(card.sub)}</div>
    </div>`).join('');
  }

  function chartRows(rows, metric, summary) {
    const callKey = metric === 'volume' ? 'call_volume' : 'call_oi';
    const putKey = metric === 'volume' ? 'put_volume' : 'put_oi';
    const usable = rows.filter(row => row[callKey] > 0 || row[putKey] > 0);
    if (usable.length <= 52) return usable;

    const selected = new Map(
      usable.slice().sort((a, b) => (b[callKey] + b[putKey]) - (a[callKey] + a[putKey]))
        .slice(0, 46).map(row => [row.strike, row])
    );
    usable.slice().sort((a, b) => Math.abs(a.strike - payload.spot) - Math.abs(b.strike - payload.spot))
      .slice(0, 5).forEach(row => selected.set(row.strike, row));
    ['put_wall', 'call_wall', 'highest_volume'].forEach(key => {
      if (!summary[key]) return;
      const row = rows.find(item => item.strike === summary[key].strike);
      if (row) selected.set(row.strike, row);
    });
    return Array.from(selected.values()).sort((a, b) => a.strike - b.strike);
  }

  function chartTheme() {
    const style = getComputedStyle(document.documentElement);
    return {
      tick: style.getPropertyValue('--chart-tick').trim() || '#64748b',
      grid: style.getPropertyValue('--chart-grid').trim() || 'rgba(255,255,255,.05)',
      tooltip: style.getPropertyValue('--chart-tooltip-bg').trim() || '#111827',
      text: style.getPropertyValue('--text-primary').trim() || '#f1f5f9',
    };
  }

  function buildChart(canvasId, rows, metric, summary, oldChart) {
    if (oldChart) oldChart.destroy();
    const canvas = $(canvasId);
    if (!canvas || !window.Chart) return null;
    const theme = chartTheme();
    const shown = chartRows(rows, metric, summary);
    const callKey = metric === 'volume' ? 'call_volume' : 'call_oi';
    const putKey = metric === 'volume' ? 'put_volume' : 'put_oi';
    const labels = shown.map(row => String(row.strike));
    const spotMarker = {
      id: `spot-marker-${canvasId}`,
      afterDatasetsDraw(chart) {
        if (!labels.length) return;
        let nearest = 0;
        labels.forEach((label, index) => {
          if (Math.abs(Number(label) - payload.spot) < Math.abs(Number(labels[nearest]) - payload.spot)) nearest = index;
        });
        const x = chart.scales.x.getPixelForValue(nearest);
        const ctx = chart.ctx;
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x, chart.chartArea.top);
        ctx.lineTo(x, chart.chartArea.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#fbbf24';
        ctx.font = '600 10px Inter, sans-serif';
        ctx.fillText(`SPX ${strikeLabel(payload.spot)}`, Math.min(x + 5, chart.chartArea.right - 70), chart.chartArea.top + 12);
        ctx.restore();
      },
    };
    return new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: `Call ${metric === 'volume' ? 'volume' : 'OI'}`, data: shown.map(row => row[callKey]), backgroundColor: 'rgba(59,130,246,.78)', borderColor: '#60a5fa', borderWidth: 1, borderRadius: 2 },
          { label: `Put ${metric === 'volume' ? 'volume' : 'OI'}`, data: shown.map(row => -row[putKey]), backgroundColor: 'rgba(236,72,153,.72)', borderColor: '#f472b6', borderWidth: 1, borderRadius: 2 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        onClick: (_event, elements, chart) => {
          if (!elements.length) return;
          selectStrike(Number(chart.data.labels[elements[0].index]));
        },
        plugins: {
          legend: { labels: { color: theme.tick, boxWidth: 12, usePointStyle: true } },
          tooltip: {
            backgroundColor: theme.tooltip,
            titleColor: theme.text,
            bodyColor: theme.tick,
            callbacks: {
              label: context => `${context.dataset.label}: ${number(Math.abs(context.raw))}`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: theme.tick, maxRotation: 0, autoSkip: true, maxTicksLimit: 13 } },
          y: { grid: { color: theme.grid }, ticks: { color: theme.tick, callback: value => compact(Math.abs(value)) }, title: { display: true, text: metric === 'volume' ? 'Contracts traded' : 'Open interest', color: theme.tick } },
        },
      },
      plugins: [spotMarker],
    });
  }

  function renderCharts() {
    if (!payload) return;
    selectedChart = buildChart('options-selected-chart', payload.rows, chartMetric.selected, payload.summary, selectedChart);
    aggregateChart = buildChart('options-aggregate-chart', payload.aggregate.rows, chartMetric.aggregate, payload.aggregate.summary, aggregateChart);
  }

  function findRow(rows, strike) {
    return rows.find(row => Number(row.strike) === Number(strike)) || null;
  }

  function nearestRow(strike) {
    if (!payload || !payload.rows.length) return null;
    return payload.rows.reduce((best, row) =>
      Math.abs(row.strike - strike) < Math.abs(best.strike - strike) ? row : best
    , payload.rows[0]);
  }

  function metricCard(label, value, note, cls = '') {
    return `<div class="options-strike-metric ${cls}"><span>${escapeHtml(label)}</span><strong>${value}</strong>${note ? `<small>${note}</small>` : ''}</div>`;
  }

  function renderStrikeDetail() {
    const detail = $('options-strike-detail');
    const title = $('options-strike-title');
    if (!detail || !payload || selectedStrike == null) return;
    const row = findRow(payload.rows, selectedStrike);
    const aggregate = findRow(payload.aggregate.rows, selectedStrike);
    if (!row) {
      detail.innerHTML = '<div class="options-empty">That strike is not listed in the selected expiry and range.</div>';
      return;
    }

    const callChange = oiChange('selected', row, 'call');
    const putChange = oiChange('selected', row, 'put');
    const aggregateCallChange = aggregate ? oiChange('aggregate', aggregate, 'call') : null;
    const aggregatePutChange = aggregate ? oiChange('aggregate', aggregate, 'put') : null;
    const baseline = snapshotState && snapshotState.previousDate ? `vs ${snapshotState.previousDate}` : 'baseline recorded';
    title.textContent = `🎯 ${strikeLabel(row.strike)} Strike Inspector`;
    detail.innerHTML = [
      metricCard('Call open interest', number(row.call_oi), `${changeHtml(callChange)} ΔOI ${baseline}`, 'call'),
      metricCard('Put open interest', number(row.put_oi), `${changeHtml(putChange)} ΔOI ${baseline}`, 'put'),
      metricCard('Call volume', number(row.call_volume), `Last ${formatPrice(row.call && row.call.last)} · Bid/ask ${formatPrice(row.call && row.call.bid)} / ${formatPrice(row.call && row.call.ask)}`, 'call'),
      metricCard('Put volume', number(row.put_volume), `Last ${formatPrice(row.put && row.put.last)} · Bid/ask ${formatPrice(row.put && row.put.bid)} / ${formatPrice(row.put && row.put.ask)}`, 'put'),
      metricCard('Call implied vol', formatIv(row.call), row.call && row.call.delta != null ? `Delta ${number(row.call.delta, 3)}` : '', 'call'),
      metricCard('Put implied vol', formatIv(row.put), row.put && row.put.delta != null ? `Delta ${number(row.put.delta, 3)}` : '', 'put'),
      metricCard('Aggregate call OI', number(aggregate && aggregate.call_oi), `${changeHtml(aggregateCallChange)} ΔOI ${baseline}`, 'aggregate'),
      metricCard('Aggregate put OI', number(aggregate && aggregate.put_oi), `${changeHtml(aggregatePutChange)} ΔOI ${baseline}`, 'aggregate'),
    ].join('');
  }

  function renderTable() {
    const body = $('options-chain-body');
    if (!body || !payload) return;
    const query = ($('options-table-search') && $('options-table-search').value || '').trim();
    const rows = payload.rows.filter(row => !query || String(row.strike).includes(query));
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="9" class="options-empty">No strikes match that filter.</td></tr>';
      return;
    }
    const atm = nearestRow(payload.spot);
    body.innerHTML = rows.map(row => {
      const callChange = oiChange('selected', row, 'call');
      const putChange = oiChange('selected', row, 'put');
      const classes = [row.strike === selectedStrike ? 'is-selected' : '', atm && row.strike === atm.strike ? 'is-atm' : ''].filter(Boolean).join(' ');
      return `<tr class="${classes}" data-strike="${row.strike}">
        <td class="call-side">${formatIv(row.call)}</td>
        <td class="call-side">${number(row.call_volume)}</td>
        <td>${changeHtml(callChange)}</td>
        <td class="call-side">${number(row.call_oi)}</td>
        <td>${strikeLabel(row.strike)}</td>
        <td class="put-side">${number(row.put_oi)}</td>
        <td>${changeHtml(putChange)}</td>
        <td class="put-side">${number(row.put_volume)}</td>
        <td class="put-side">${formatIv(row.put)}</td>
      </tr>`;
    }).join('');
  }

  function renderInsights() {
    const el = $('options-insights');
    if (!el || !payload) return;
    const selected = payload.summary;
    const overall = payload.aggregate.summary;
    const horizon = payload.aggregate.days == null ? 'all listed expiries' : `${payload.aggregate.days} days`;
    const baselineText = snapshotState && snapshotState.previousDate
      ? `ΔOI compares the current Cboe session with the baseline saved on ${snapshotState.previousDate}.`
      : 'Today is the first saved baseline in this browser. ΔOI will appear after Cboe posts a later session and you revisit this view.';
    const wallText = overall.put_wall && overall.call_wall
      ? `Across ${horizon}, the largest put OI below SPX is at ${strikeLabel(overall.put_wall.strike)} and the largest call OI above SPX is at ${strikeLabel(overall.call_wall.strike)}.`
      : 'No complete support/resistance pair was found inside the selected strike range.';
    const activityText = selected.highest_volume
      ? `${strikeLabel(selected.highest_volume.strike)} has the most combined call/put volume in ${expiryText(payload.selected)}.`
      : 'No traded volume is reported for the selected slice.';
    el.innerHTML = [
      ['Overall OI walls', wallText],
      ['Selected-expiry activity', activityText],
      ['OI change baseline', baselineText],
    ].map(([title, text]) => `<div class="options-insight"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p></div>`).join('');
  }

  function selectStrike(strike, allowNearest = false) {
    if (!payload || !payload.rows.length) return;
    let row = findRow(payload.rows, strike);
    if (!row && allowNearest) row = nearestRow(Number(strike));
    if (!row) {
      const status = $('options-status');
      if (status) status.textContent = `${strikeLabel(strike)} is not listed in this expiry/range.`;
      return;
    }
    selectedStrike = row.strike;
    if ($('options-strike-input')) $('options-strike-input').value = row.strike;
    renderStrikeDetail();
    renderTable();
  }

  function render() {
    if (!payload) return;
    populateExpirations();
    renderSummary();
    const selectedCaption = $('options-selected-caption');
    if (selectedCaption) selectedCaption.textContent = `${expiryText(payload.selected)} · top active strikes shown · calls above zero, puts below.`;
    const aggregateCaption = $('options-aggregate-caption');
    if (aggregateCaption) aggregateCaption.textContent = `Combined across ${payload.aggregate.days == null ? 'all listed expiries' : `the next ${payload.aggregate.days} days`} · top active strikes shown.`;
    renderCharts();
    if (selectedStrike == null || !findRow(payload.rows, selectedStrike)) {
      const atm = nearestRow(payload.spot);
      selectedStrike = atm ? atm.strike : null;
    }
    if (selectedStrike != null && $('options-strike-input')) $('options-strike-input').value = selectedStrike;
    renderStrikeDetail();
    renderTable();
    renderInsights();
  }

  async function load(force = false) {
    if (loading) return;
    loading = true;
    const status = $('options-status');
    const refresh = $('btn-options-refresh');
    if (status) {
      status.classList.remove('is-error');
      status.textContent = 'Loading the official Cboe SPX options chain…';
    }
    if (refresh) refresh.classList.add('is-loading');
    try {
      const params = new URLSearchParams();
      const expirySelect = $('options-expiry');
      if (payload && expirySelect && expirySelect.value) {
        const chosen = parseOptionKey(expirySelect.value);
        params.set('expiry', chosen.expiry);
        params.set('series', chosen.series);
      }
      params.set('range', $('options-range') ? $('options-range').value : '10');
      params.set('horizon', $('options-horizon') ? $('options-horizon').value : '60');
      if (force) params.set('_', Date.now());
      const response = await fetch(`/api/options/positioning?${params}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error || `Options service returned ${response.status}`);
      payload = result;
      lastLoaded = Date.now();
      updateSnapshots();
      const asof = $('options-asof');
      if (asof) asof.textContent = `Cboe ${payload.asof} · delayed`;
      if (status) status.textContent = `${number(payload.contract_count)} current contracts scanned · ${expiryText(payload.selected)} · click a bar or row to inspect a strike.`;
      render();
    } catch (error) {
      console.error('Options OI:', error);
      if (status) {
        status.classList.add('is-error');
        status.textContent = `${error.message} Try refresh in a moment.`;
      }
      const summary = $('options-summary');
      if (!payload && summary) summary.innerHTML = '<div class="options-empty">The Cboe options feed could not be reached. The rest of MarketScope is unaffected.</div>';
    } finally {
      loading = false;
      if (refresh) refresh.classList.remove('is-loading');
    }
  }

  function bind() {
    if ($('btn-options-refresh')) $('btn-options-refresh').addEventListener('click', () => load(true));
    if ($('options-expiry')) $('options-expiry').addEventListener('change', () => { selectedStrike = null; load(); });
    if ($('options-range')) $('options-range').addEventListener('change', () => { selectedStrike = null; load(); });
    if ($('options-horizon')) $('options-horizon').addEventListener('change', load);
    if ($('btn-options-strike')) $('btn-options-strike').addEventListener('click', () => selectStrike(Number($('options-strike-input').value), true));
    if ($('options-strike-input')) $('options-strike-input').addEventListener('keydown', event => {
      if (event.key === 'Enter') selectStrike(Number(event.target.value), true);
    });
    if ($('options-table-search')) $('options-table-search').addEventListener('input', renderTable);
    if ($('options-chain-body')) $('options-chain-body').addEventListener('click', event => {
      const row = event.target.closest('tr[data-strike]');
      if (row) selectStrike(Number(row.dataset.strike));
    });
    document.querySelectorAll('.options-view-toggle').forEach(toggle => {
      toggle.addEventListener('click', event => {
        const button = event.target.closest('button[data-metric]');
        if (!button) return;
        const which = toggle.dataset.chart;
        chartMetric[which] = button.dataset.metric;
        toggle.querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
        renderCharts();
      });
    });
  }

  function init() {
    if (initialized) return;
    initialized = true;
    bind();
    const panel = document.querySelector('.tab-panel.active');
    if (panel && panel.dataset.tab === 'optionsoi') activate();
  }

  function activate() {
    active = true;
    if (!initialized) init();
    if (!payload || Date.now() - lastLoaded > 120000) load();
    if (!timer) timer = window.setInterval(() => { if (active) load(); }, 180000);
  }

  function deactivate() {
    active = false;
    if (timer) window.clearInterval(timer);
    timer = null;
  }

  window.OptionsOI = { init, activate, deactivate, renderCharts };
})();
