/**
 * VIX Decomposition Strategy Engine
 * 
 * Computes percentiles across the full dataset,
 * identifies extreme readings, and suggests
 * S&P 500 options/equity strategies based on the vol regime.
 */
const StrategyEngine = (function() {

  // ---- Percentile Calculation ----
  function percentileRank(sortedArr, value) {
    let count = 0;
    for (let i = 0; i < sortedArr.length; i++) {
      if (sortedArr[i] <= value) count++;
    }
    return Math.round((count / sortedArr.length) * 100);
  }

  function computePercentiles(data) {
    const fields = ['sticky_strike', 'parallel_shift', 'put_skew', 'call_skew', 
                     'downside_convexity', 'upside_convexity', 'total',
                     'vix_change_abs', 'vix_change_pct', 'spx_change_pct', 'skew_to'];
    const sorted = {};
    fields.forEach(f => {
      sorted[f] = data.map(r => r[f]).filter(v => v != null).sort((a, b) => a - b);
    });
    return { fields, sorted };
  }

  function getPercentiles(record, percData) {
    const result = {};
    percData.fields.forEach(f => {
      result[f] = percentileRank(percData.sorted[f], record[f]);
    });
    return result;
  }

  // ---- Strategy Generation ----
  function generateStrategies(record, percentiles, allData) {
    const strategies = [];
    const ss = record.sticky_strike;
    const ps = record.parallel_shift;
    const psk = record.put_skew;
    const csk = record.call_skew;
    const dc = record.downside_convexity;
    const uc = record.upside_convexity;
    const vixTo = record.vix_to;
    const spxPct = record.spx_change_pct;
    const vixPct = record.vix_change_pct;

    // ---- Percentile-Based Extreme Signals ----
    
    // Put Skew at extreme high (99th percentile = puts aggressively bid)
    if (percentiles.put_skew >= 95) {
      strategies.push({
        type: 'bearish_hedge',
        signal: '🔴 Extreme Put Skew',
        title: 'Put Protection Aggressively Bid',
        percentile: percentiles.put_skew,
        description: `Put Skew is at the <strong>${percentiles.put_skew}th percentile</strong> of the 3-year dataset (${psk.toFixed(2)} pts). This indicates panicked demand for downside protection. OTM puts are exceptionally expensive relative to historical norms.`,
        strategy: `<strong>Sell Put Spreads:</strong> Consider selling 5-10 delta put spreads (e.g., SPX ${Math.round(record.spx_to * 0.95)}/${Math.round(record.spx_to * 0.92)} puts) to harvest the elevated put premium. The skew is so extreme that puts are overpriced relative to realized vol.<br><strong>Alternatively:</strong> If you believe the selloff is overdone, buy a 1x2 put ratio spread (buy 1 ATM put, sell 2 OTM puts) to get downside protection funded by the rich skew.`,
        conviction: 'High'
      });
    }

    // Put Skew at extreme low (< 5th percentile = puts cheap)
    if (percentiles.put_skew <= 5) {
      strategies.push({
        type: 'opportunity',
        signal: '🟢 Cheap Put Skew',
        title: 'Downside Protection Unusually Cheap',
        percentile: percentiles.put_skew,
        description: `Put Skew is at the <strong>${percentiles.put_skew}th percentile</strong> — one of the lowest readings in 3 years (${psk.toFixed(2)} pts). This is rare complacency in downside protection pricing.`,
        strategy: `<strong>Buy Protective Puts:</strong> This is an opportunity to buy cheap tail-risk hedges. Consider 3-month 5% OTM puts on SPX or SPY. The cost of protection is at near-historical lows.<br><strong>Collar Strategy:</strong> Buy a put and sell a call to finance it — the low skew makes the put leg unusually affordable.`,
        conviction: 'High'
      });
    }

    // Call Skew high (upside vol being bid — potential squeeze or event)
    if (percentiles.call_skew >= 90) {
      strategies.push({
        type: 'bullish_signal',
        signal: '🟡 Elevated Call Skew',
        title: 'Upside Volatility Being Bid',
        percentile: percentiles.call_skew,
        description: `Call Skew is at the <strong>${percentiles.call_skew}th percentile</strong> (${csk.toFixed(2)} pts). Upside calls are being aggressively bid — this often precedes short squeezes, event-driven rallies, or institutional positioning for upside.`,
        strategy: `<strong>Sell Call Spreads:</strong> If you believe the upside is priced in, consider selling 10-20 delta call spreads to harvest rich call premium.<br><strong>Alternatively:</strong> If you want to ride the momentum, buy a call butterfly centered 2-3% above the current SPX level to profit from a move higher at lower cost.`,
        conviction: 'Medium'
      });
    }

    // Parallel Shift extreme high (entire vol surface shifting up)
    if (percentiles.parallel_shift >= 95) {
      strategies.push({
        type: 'vol_spike',
        signal: '🔴 Extreme Parallel Shift',
        title: 'Entire Vol Surface Exploding Higher',
        percentile: percentiles.parallel_shift,
        description: `Parallel Shift is at the <strong>${percentiles.parallel_shift}th percentile</strong> (${ps.toFixed(2)} pts). The entire implied volatility surface shifted dramatically higher. This is a systemic fear event — everything is repricing risk simultaneously.`,
        strategy: `<strong>Sell Straddles/Strangles:</strong> After extreme parallel shifts, implied vol tends to mean-revert. Consider selling 30-day ATM strangles on SPX/SPY and hedging gamma with daily delta adjustments.<br><strong>Iron Condors:</strong> Sell wide iron condors to capture the elevated premium while defining risk.`,
        conviction: 'High'
      });
    }

    // Parallel Shift extreme low (vol surface collapsing)
    if (percentiles.parallel_shift <= 5) {
      strategies.push({
        type: 'vol_crush',
        signal: '🟢 Extreme Vol Compression',
        title: 'Vol Surface Collapsing — Complacency Warning',
        percentile: percentiles.parallel_shift,
        description: `Parallel Shift is at the <strong>${percentiles.parallel_shift}th percentile</strong> (${ps.toFixed(2)} pts). The entire vol surface compressed dramatically. While this means a strong rally, extreme vol compression often precedes reversals.`,
        strategy: `<strong>Buy Straddles:</strong> Implied vol is cheap after the compression. Consider buying 45-60 DTE ATM straddles for a potential vol expansion.<br><strong>Calendar Spreads:</strong> Sell front-month, buy back-month options to profit from the term structure steepening as vol eventually normalizes.`,
        conviction: 'Medium'
      });
    }

    // Downside Convexity extreme (tail risk pricing)
    if (percentiles.downside_convexity >= 95) {
      strategies.push({
        type: 'tail_risk',
        signal: '🔴 Extreme Downside Convexity',
        title: 'Deep OTM Puts Pricing Tail Risk',
        percentile: percentiles.downside_convexity,
        description: `Downside Convexity at <strong>${percentiles.downside_convexity}th percentile</strong> (${dc.toFixed(2)} pts). Deep OTM puts are pricing catastrophic scenarios. The wings of the vol smile are extremely steep.`,
        strategy: `<strong>Sell Put Ratio Backspreads:</strong> The far OTM puts are so expensive that selling them against nearer strikes creates favorable risk/reward. Consider selling 2x 15-delta puts vs buying 1x 25-delta put.<br><strong>Jade Lizard:</strong> Sell a put spread and a naked call to collect maximum premium from elevated wing vol.`,
        conviction: 'Medium'
      });
    }

    // VIX at extreme levels
    if (vixTo >= 30 && percentiles.vix_change_pct >= 90) {
      strategies.push({
        type: 'mean_reversion',
        signal: '🟡 VIX Above 30 + Spiking',
        title: 'Mean Reversion Opportunity',
        percentile: percentiles.vix_change_pct,
        description: `VIX is at ${vixTo.toFixed(2)} and just spiked by ${vixPct.toFixed(1)}% (${percentiles.vix_change_pct}th percentile). Historically, VIX spikes above 30 tend to mean-revert within 5-10 trading days.`,
        strategy: `<strong>Short VIX via Put Spreads:</strong> Buy VIX put spreads or short /VX futures to capture the mean reversion. Target VIX returning to 20-25 range over the next 2-3 weeks.<br><strong>Sell SPX Puts:</strong> Sell 30-45 DTE OTM puts while premium is inflated. The elevated vol creates a large margin of safety.`,
        conviction: 'High'
      });
    }

    if (percentiles.skew_to >= 95) {
      strategies.push({
        type: 'tail_risk',
        signal: '🔴 Extreme SKEW Index',
        title: 'Elevated Tail Risk Pricing',
        percentile: percentiles.skew_to,
        description: `CBOE SKEW Index is at the <strong>${percentiles.skew_to}th percentile</strong> (${record.skew_to ? record.skew_to.toFixed(2) : '--'}). Options markets are pricing in an unusually high probability of a large downside move (black swan event).`,
        strategy: `<strong>Black Swan Hedging:</strong> Consider purchasing far out-of-the-money puts as tail-risk hedges, although they are currently expensive. Structuring trades using put ratio spreads can help offset the extreme skew premium.`,
        conviction: 'High'
      });
    }

    if (percentiles.skew_to <= 5) {
      strategies.push({
        type: 'complacency',
        signal: '🟢 Low SKEW Index',
        title: 'Tail Risk Complacency',
        percentile: percentiles.skew_to,
        description: `CBOE SKEW Index is remarkably low at the <strong>${percentiles.skew_to}th percentile</strong> (${record.skew_to ? record.skew_to.toFixed(2) : '--'}). The volatility curve is flat, and the market is showing little appetite for downside crash protection.`,
        strategy: `<strong>Cheap Tail Hedges:</strong> This is a highly opportune time to buy protective puts or tail-risk hedges, as the premium for extreme downside protection is relatively cheap compared to historical norms.`,
        conviction: 'High'
      });
    }

    // Combined signal: Put skew decreasing + Call skew increasing = bullish rotation
    if (psk < 0 && csk > 0) {
      const pskLow = percentiles.put_skew <= 30;
      const cskHigh = percentiles.call_skew >= 70;
      if (pskLow && cskHigh) {
        strategies.push({
          type: 'rotation',
          signal: '🟢 Bullish Skew Rotation',
          title: 'Put Skew Falling + Call Skew Rising',
          percentile: null,
          description: `Put Skew decreased (${psk.toFixed(2)}, ${percentiles.put_skew}th %ile) while Call Skew increased (${csk.toFixed(2)}, ${percentiles.call_skew}th %ile). This skew rotation suggests institutional flows shifting from downside hedging to upside positioning — a classically bullish vol signal.`,
          strategy: `<strong>Risk Reversal:</strong> Sell OTM puts and buy OTM calls (zero-cost collar). The skew rotation means you're selling expensive puts and buying relatively cheap calls.<br><strong>Bull Call Spread:</strong> Buy 1-2% OTM call spreads to participate in the upside with defined risk.`,
          conviction: 'High'
        });
      }
    }

    // Combined signal: Put skew increasing + Call skew decreasing = bearish rotation
    if (psk > 0 && csk < 0) {
      const pskHigh = percentiles.put_skew >= 70;
      const cskLow = percentiles.call_skew <= 30;
      if (pskHigh && cskLow) {
        strategies.push({
          type: 'rotation',
          signal: '🔴 Bearish Skew Rotation',
          title: 'Put Skew Rising + Call Skew Falling',
          percentile: null,
          description: `Put Skew increased (${psk.toFixed(2)}, ${percentiles.put_skew}th %ile) while Call Skew decreased (${csk.toFixed(2)}, ${percentiles.call_skew}th %ile). This signals institutional positioning is shifting to downside protection — bearish vol regime.`,
          strategy: `<strong>Buy Put Spreads:</strong> Purchase 3-5% OTM put spreads for directional downside exposure.<br><strong>Bear Put Ladder:</strong> Buy 1x ATM put, sell 1x 5% OTM put, sell 1x 10% OTM put — profits from a controlled decline while collecting wing premium.`,
          conviction: 'Medium'
        });
      }
    }

    // Sticky Strike dominant = vol is just following spot
    if (Math.abs(ss) > Math.abs(ps) * 2 && Math.abs(ss) > Math.abs(psk) * 2) {
      strategies.push({
        type: 'neutral',
        signal: '⚪ Sticky Strike Dominant',
        title: 'Vol Passively Following Spot — No Edge',
        percentile: percentiles.sticky_strike,
        description: `Sticky Strike (${ss.toFixed(2)} pts) dominated all other factors. VIX simply moved because SPX moved — there's no additional information in the vol surface. No strategic vol edge today.`,
        strategy: `<strong>No Vol Trade:</strong> When Sticky Strike dominates, the vol market isn't providing new information. Focus on directional equity plays if you have a view.<br><strong>Sell Theta:</strong> Consider selling weekly iron butterflies or condors to collect time decay in a regime where vol is passively following spot.`,
        conviction: 'Low'
      });
    }

    // Default: nothing extreme
    if (strategies.length === 0) {
      strategies.push({
        type: 'neutral',
        signal: '⚪ Normal Regime',
        title: 'No Extreme Signals — Standard Market Day',
        percentile: null,
        description: 'All vol decomposition factors are within normal historical ranges (10th-90th percentile). No unusual vol dynamics detected. This is a routine market day from a volatility perspective.',
        strategy: `<strong>Harvest Theta:</strong> In normal regimes, selling premium through short strangles or iron condors with 30-45 DTE tends to be profitable.<br><strong>Wait for Extremes:</strong> The best vol-based strategies come when readings reach the 5th or 95th percentile. Current readings are unremarkable — save capital for when the data screams.`,
        conviction: 'Low'
      });
    }

    return strategies;
  }

  // ---- Render Percentile Bar ----
  function renderPercentileBar(pctile) {
    const color = pctile >= 90 ? 'var(--accent-red)' 
                : pctile <= 10 ? 'var(--accent-green)'
                : pctile >= 75 ? 'var(--accent-orange, #f59e0b)'
                : pctile <= 25 ? 'var(--accent-cyan)'
                : 'var(--accent-purple)';
    
    return `<div class="pctile-bar-wrapper">
      <div class="pctile-bar" style="width:${pctile}%; background:${color};"></div>
      <span class="pctile-label">${pctile}th</span>
    </div>`;
  }

  // ---- Render Full Strategy Section ----
  function renderStrategyPanel(record, allData) {
    const percData = computePercentiles(allData);
    const percentiles = getPercentiles(record, percData);
    const strategies = generateStrategies(record, percentiles, allData);

    // Build Percentile Summary Table
    const factorNames = {
      sticky_strike: 'Sticky Strike',
      parallel_shift: 'Parallel Shift',
      put_skew: 'Put Skew',
      call_skew: 'Call Skew',
      downside_convexity: 'Downside Convexity',
      upside_convexity: 'Upside Convexity',
      total: 'Total VIX Change',
      vix_change_pct: 'VIX % Change',
      spx_change_pct: 'SPX % Change',
      skew_to: 'CBOE SKEW Index'
    };

    let pctileTable = '<table class="pctile-table"><thead><tr><th>Factor</th><th>Value</th><th>Percentile (3Y)</th></tr></thead><tbody>';
    Object.entries(factorNames).forEach(([key, label]) => {
      const val = record[key];
      const pct = percentiles[key];
      const valClass = val >= 0 ? 'positive' : 'negative';
      const extreme = pct >= 95 || pct <= 5 ? ' extreme-row' : pct >= 90 || pct <= 10 ? ' warning-row' : '';
      pctileTable += `<tr class="${extreme}">
        <td>${label}</td>
        <td class="factor-value ${valClass}">${val >= 0 ? '+' : ''}${val.toFixed(2)}</td>
        <td>${renderPercentileBar(pct)}</td>
      </tr>`;
    });
    pctileTable += '</tbody></table>';

    // Build Strategy Cards
    let stratCards = '';
    strategies.forEach(s => {
      const convictionColor = s.conviction === 'High' ? 'var(--accent-green)' : s.conviction === 'Medium' ? 'var(--accent-orange, #f59e0b)' : 'var(--text-muted)';
      stratCards += `<div class="strategy-card">
        <div class="strategy-header">
          <span class="strategy-signal">${s.signal}</span>
          <span class="strategy-conviction" style="color:${convictionColor}">Conviction: ${s.conviction}</span>
        </div>
        <h4 class="strategy-title">${s.title}</h4>
        <p class="strategy-desc">${s.description}</p>
        <div class="strategy-action">${s.strategy}</div>
      </div>`;
    });

    return `
      <div class="strategy-grid">
        <div class="pctile-section">
          <h3>📊 Percentile Rankings (3-Year History)</h3>
          ${pctileTable}
        </div>
        <div class="strategies-section">
          <h3>💡 Strategy Suggestions</h3>
          ${stratCards}
        </div>
      </div>
    `;
  }

  return { renderStrategyPanel, computePercentiles, getPercentiles };
})();
