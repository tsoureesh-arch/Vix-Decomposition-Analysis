/**
 * Stocks & Economics Data Tab Module
 * Handles loading, rendering, searching, and formatting of Top 25 SPX stocks,
 * earnings history/surprises/reactions, and key macroeconomic indicator releases.
 * Exposes window.StocksEcon with loadStocks, loadEconomics, init.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  let stocksData = null;
  let stocksLoaded = false;
  let econData = null;
  let econLoaded = false;

  /* Helper formatters */
  function fmt(v, dp = 2) {
    if (v == null || isNaN(v)) return '—';
    return Number(v).toFixed(dp);
  }

  function formatMarketCap(val) {
    if (!val || isNaN(val)) return '—';
    if (val >= 1e12) return '$' + (val / 1e12).toFixed(2) + 'T';
    if (val >= 1e9) return '$' + (val / 1e9).toFixed(2) + 'B';
    if (val >= 1e6) return '$' + (val / 1e6).toFixed(2) + 'M';
    return '$' + val;
  }

  function getJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(res => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  /* ── Stocks & Earnings Logic ─────────────────────────────────────── */
  function renderStocksTable(filterText = '') {
    const tbody = $('stocksBody');
    if (!tbody || !stocksData) return;

    let stocks = stocksData.stocks || [];
    if (filterText) {
      const q = filterText.toLowerCase();
      stocks = stocks.filter(s =>
        s.ticker.toLowerCase().includes(q) ||
        s.company.toLowerCase().includes(q)
      );
    }

    tbody.innerHTML = stocks.map(s => {
      const pctChg = s.pct_change;
      const chgClass = pctChg == null ? '' : pctChg > 0 ? 'positive' : pctChg < 0 ? 'negative' : '';
      const chgSign = pctChg != null && pctChg > 0 ? '+' : '';

      const quarters = s.quarters || [];
      // Pad quarters list to ensure exactly 5 slots are rendered
      const qCells = [];
      for (let i = 0; i < 5; i++) {
        qCells.push(buildEpsCell(quarters[i]));
      }

      return `
        <tr>
          <td class="mono" style="font-weight:700; color:#818cf8;">${s.ticker}</td>
          <td style="font-weight:500; color:var(--text-primary);">${s.company}</td>
          <td class="mono">${formatMarketCap(s.market_cap)}</td>
          <td class="mono" style="font-weight:600;">${fmt(s.current)}</td>
          <td class="mono ${chgClass}" style="font-weight:600;">${pctChg != null ? chgSign + pctChg.toFixed(2) + '%' : '—'}</td>
          <td class="mono" style="color:var(--accent-green, #10b981);">${fmt(s.high_52w)}</td>
          <td class="mono" style="color:var(--accent-red, #ef4444);">${fmt(s.low_52w)}</td>
          ${qCells.join('')}
          ${buildNextEarnings(s.next_earnings)}
        </tr>
      `;
    }).join('');
  }

  function buildEpsCell(q) {
    if (!q) return '<td><span style="color:var(--text-muted);">—</span></td>';
    const act = q.eps_actual;
    const est = q.eps_estimate;
    const surprise = q.surprise_pct;
    const reaction = q.reaction;

    // Style surprise badge
    let surpriseBadge = '';
    if (surprise != null) {
      const isBeat = surprise > 0;
      const badgeColor = isBeat ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)';
      const textColor = isBeat ? '#10b981' : '#ef4444';
      surpriseBadge = `
        <span style="display:inline-block; font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px; background:${badgeColor}; color:${textColor}; margin-left:4px;">
          ${surprise > 0 ? '+' : ''}${surprise.toFixed(1)}%
        </span>
      `;
    }

    // Style price reaction badge
    let reactionBadge = '';
    if (reaction != null) {
      const isUp = reaction > 0;
      const textColor = isUp ? '#10b981' : '#ef4444';
      reactionBadge = `
        <span style="font-size:10px; font-weight:600; color:${textColor};">
          ${isUp ? '▲' : '▼'} ${isUp ? '+' : ''}${reaction.toFixed(1)}%
        </span>
      `;
    }

    return `
      <td>
        <div style="display:flex; flex-direction:column; gap:4px; min-width:110px;">
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px;">
            <span style="color:var(--text-muted);">${q.date || '—'}</span>
            ${reactionBadge}
          </div>
          <div style="display:flex; align-items:center; font-size:12px; font-family:var(--font-mono); font-weight:500;">
            <span style="color: ${act >= (est || 0) ? '#10b981' : '#ef4444'}; font-weight:700;">${fmt(act)}</span>
            <span style="color:var(--text-muted); font-size:10px; margin: 0 3px;">/</span>
            <span style="color:var(--text-secondary);">${fmt(est)}</span>
            ${surpriseBadge}
          </div>
        </div>
      </td>
    `;
  }

  function buildNextEarnings(dateStr) {
    if (!dateStr) return '<td><span style="color:var(--text-muted);">—</span></td>';
    
    // Check if within 14 days
    const today = new Date();
    const dt = new Date(dateStr);
    const diffDays = Math.round((dt - today) / 86400000);
    const isSoon = diffDays >= 0 && diffDays <= 14;

    const bg = isSoon ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.03)';
    const fg = isSoon ? '#f59e0b' : 'var(--text-secondary)';
    const text = isSoon ? `⚡ ${dateStr} (${diffDays}d)` : dateStr;

    return `
      <td>
        <span class="mono" style="display:inline-block; font-size:11px; font-weight:600; padding:4px 8px; border-radius:6px; background:${bg}; color:${fg}; border: 1px solid ${isSoon ? 'rgba(245,158,11,0.3)' : 'var(--glass-border)'};">
          ${text}
        </span>
      </td>
    `;
  }

  async function loadStocks() {
    if (stocksLoaded && stocksData) {
      renderStocksTable($('stocksSearch').value);
      return;
    }
    const loading = $('stocksLoading');
    const wrap = $('stocksTableWrap');
    if (loading) loading.style.display = 'flex';
    if (wrap) wrap.style.display = 'none';

    try {
      stocksData = await getJSON('/api/stocks');
      stocksLoaded = true;
      renderStocksTable($('stocksSearch').value || '');
      if (loading) loading.style.display = 'none';
      if (wrap) wrap.style.display = 'block';
    } catch (err) {
      console.error('[StocksEcon] Failed to load stocks:', err);
      if (loading) {
        loading.innerHTML = `<span style="color:var(--accent-red);">⚠ Failed to load stocks data. Check server connection.</span>`;
      }
    }
  }

  /* ── Economic Indicators Logic ────────────────────────────────────── */
  function renderEconomics() {
    const grid = $('econGrid');
    if (!grid || !econData) return;

    const indicators = econData.indicators || [];
    if (indicators.length === 0) {
      grid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--text-secondary);">No indicators data available yet. Server is still scraping.</div>`;
      return;
    }

    grid.innerHTML = indicators.map(ind => {
      const rows = (ind.releases || []).map(r => {
        let statusBadge = '';
        let rowStyle = '';
        if (r.beat === true) {
          statusBadge = `<span style="font-size:10px; font-weight:700; color:#10b981; margin-left:4px;">✅ Beat</span>`;
          rowStyle = 'background: rgba(16,185,129,0.03);';
        } else if (r.beat === false) {
          statusBadge = `<span style="font-size:10px; font-weight:700; color:#ef4444; margin-left:4px;">❌ Miss</span>`;
          rowStyle = 'background: rgba(239,68,68,0.03);';
        }

        return `
          <tr style="${rowStyle}">
            <td style="white-space:nowrap; padding:8px 10px;">${r.date}</td>
            <td style="padding:8px 10px; color:var(--text-secondary);">${r.period}</td>
            <td class="mono" style="padding:8px 10px; font-weight:700; color:var(--text-primary);">${r.actual || '—'} ${statusBadge}</td>
            <td class="mono" style="padding:8px 10px;">${r.forecast || '—'}</td>
            <td class="mono" style="padding:8px 10px; color:var(--text-muted);">${r.previous || '—'}</td>
          </tr>
        `;
      }).join('');

      return `
        <section class="glass-card" style="display:flex; flex-direction:column; padding:20px;">
          <div class="section-header" style="border-bottom: 1px solid var(--glass-border); padding-bottom:10px; margin-bottom:12px;">
            <h3 style="margin:0; font-size:1.05rem; display:flex; align-items:center; gap:8px;">
              <span>${ind.icon}</span>
              <span>${ind.label}</span>
            </h3>
            <span class="badge" style="font-size:10px; background:rgba(255,255,255,0.05); color:var(--text-muted);">${ind.category}</span>
          </div>
          <div style="overflow-x:auto; flex:1;">
            <table class="data-table" style="width:100%; font-size:0.8rem; margin:0;">
              <thead>
                <tr>
                  <th style="padding:6px 10px;">Date</th>
                  <th style="padding:6px 10px;">Period</th>
                  <th style="padding:6px 10px;">Actual</th>
                  <th style="padding:6px 10px;">Forecast</th>
                  <th style="padding:6px 10px;">Previous</th>
                </tr>
              </thead>
              <tbody>
                ${rows}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }).join('');

    const upTime = $('econUpdatedTime');
    if (upTime && econData.last_updated) {
      const d = new Date(econData.last_updated);
      upTime.textContent = 'Updated ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
  }

  async function loadEconomics() {
    if (econLoaded && econData) {
      renderEconomics();
      return;
    }
    const grid = $('econGrid');
    if (grid) {
      grid.innerHTML = `
        <div style="grid-column: 1/-1; display:flex; justify-content:center; align-items:center; height:200px; font-size:1.1rem; color:var(--text-secondary);">
          <span class="vt-spinner" style="width:20px; height:20px; border-width:3px; margin-right:8px;"></span> Loading macro economic indicators... This may take ~10 seconds.
        </div>
      `;
    }

    try {
      econData = await getJSON('/api/economics');
      econLoaded = true;
      renderEconomics();
    } catch (err) {
      console.error('[StocksEcon] Failed to load economics:', err);
      if (grid) {
        grid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; color:var(--accent-red); padding:20px;">⚠ Failed to load economic data. Check server connection.</div>`;
      }
    }
  }

  /* ── Init ────────────────────────────────────────────────────────── */
  function init() {
    const sSearch = $('stocksSearch');
    if (sSearch) {
      sSearch.oninput = (e) => {
        renderStocksTable(e.target.value);
      };
    }
  }

  window.StocksEcon = {
    loadStocks,
    loadEconomics,
    init
  };
})();
