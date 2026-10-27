/**
 * VIX Decomposition — Analysis Engine
 * Generates natural-language explanations of VIX decomposition factors
 */

const AnalysisEngine = (() => {

  /**
   * Generate a comprehensive analysis text for a given decomposition record.
   * @param {Object} record - A VIX decomposition data record
   * @returns {string} HTML-formatted analysis text
   */
  function generateAnalysis(record) {
    const parts = [];

    // 1. Market move summary
    parts.push(generateMarketSummary(record));

    // 2. Dominant factor identification
    parts.push(generateDominantFactors(record));

    // 3. Detailed factor interpretation
    parts.push(generateFactorInterpretation(record));

    // 4. Overall regime classification
    parts.push(generateRegimeClassification(record));

    // 5. SKEW index context
    parts.push(generateSkewAnalysis(record));

    return parts.join(' ');
  }

  function generateMarketSummary(r) {
    const spxDir = r.spx_change_abs >= 0 ? 'rose' : 'fell';
    const vixAction = r.vix_change_abs < 0 ? 'crushed' : (r.vix_change_abs > 2 ? 'spiked' : 'pushed');
    const vixDir = r.vix_change_abs < 0 ? 'down' : 'up';

    const spxAbs = Math.abs(r.spx_change_abs).toFixed(2);
    const spxPct = Math.abs(r.spx_change_pct).toFixed(2);
    const vixAbs = Math.abs(r.vix_change_abs).toFixed(2);
    const vixPct = Math.abs(r.vix_change_pct).toFixed(2);

    const vixClass = r.vix_change_abs < 0 ? 'highlight-negative' : 'highlight-positive';

    return `<strong>Between ${formatDate(r.date_from)} and ${formatDate(r.date_to)}, S&P 500 ${spxDir} by ${spxAbs} points (${spxPct}%),</strong> which ${vixAction} the VIX from <span class="${vixClass}">${r.vix_from.toFixed(2)}</span> ${vixDir} to <span class="${vixClass}">${r.vix_to.toFixed(2)}</span>, a <span class="${vixClass}">${vixAbs} point (${vixPct}%) ${r.vix_change_abs < 0 ? 'drop' : 'rise'}</span>.`;
  }

  function generateDominantFactors(r) {
    const factors = getFactorsSortedByMagnitude(r);
    const top2 = factors.slice(0, 2);

    const desc = top2.map(f => {
      const cls = f.value < 0 ? 'highlight-negative' : 'highlight-positive';
      return `<span class="${cls}">${f.label} (${formatValue(f.value)})</span>`;
    }).join(' and ');

    return `The major changes in the VIX were driven by ${desc}.`;
  }

  function generateFactorInterpretation(r) {
    const interpretations = [];
    const factors = getFactorsSortedByMagnitude(r);

    // Sticky Strike
    const ss = r.sticky_strike;
    if (Math.abs(ss) >= 0.3) {
      if (ss < 0) {
        interpretations.push(`Sticky Strike (${formatValue(ss)}) indicates a <span class="highlight-negative">volatility crush across the entire curve</span> as the S&P 500 rally moved the index away from high-IV put strikes.`);
      } else {
        interpretations.push(`Sticky Strike (${formatValue(ss)}) reflects the <span class="highlight-positive">mechanical VIX increase</span> from the S&P 500 decline, moving closer to higher-IV put strikes.`);
      }
    }

    // Parallel Shift
    const ps = r.parallel_shift;
    if (Math.abs(ps) >= 0.3) {
      if (ps < 0) {
        interpretations.push(`A decent Parallel Shift of (${formatValue(ps)}) indicates <span class="highlight-negative">a volatility crush across the entire curve</span>, with implied volatilities broadly repriced lower.`);
      } else {
        interpretations.push(`A meaningful Parallel Shift of (${formatValue(ps)}) shows <span class="highlight-positive">broad repricing higher</span> across all strikes, indicating increased market uncertainty.`);
      }
    }

    // Put Skew
    const psk = r.put_skew;
    if (Math.abs(psk) >= 0.15) {
      if (psk > 0) {
        interpretations.push(`Put Skew (${formatValue(psk)}) <span class="highlight-positive">steepened</span>, reflecting increased demand for downside protection.`);
      } else {
        interpretations.push(`Put Skew (${formatValue(psk)}) <span class="highlight-negative">flattened</span>, suggesting reduced demand for crash protection.`);
      }
    } else {
      interpretations.push(`The Put Skew (${formatValue(psk)}) remained relatively flat.`);
    }

    // Convexity
    const dc = r.downside_convexity;
    const uc = r.upside_convexity;
    if (Math.abs(dc) >= 0.1 || Math.abs(uc) >= 0.08) {
      let convText = '';
      if (dc > 0.1) {
        convText += `a meaningful increase in <span class="highlight-positive">Downside Convexity (${formatValue(dc)})</span>`;
      } else if (dc < -0.1) {
        convText += `a decrease in <span class="highlight-negative">Downside Convexity (${formatValue(dc)})</span>`;
      }
      if (uc < -0.08) {
        if (convText) convText += ' and ';
        convText += `a decrease in <span class="highlight-negative">Upside Convexity (${formatValue(uc)})</span>`;
      } else if (uc > 0.08) {
        if (convText) convText += ' and ';
        convText += `an increase in <span class="highlight-positive">Upside Convexity (${formatValue(uc)})</span>`;
      }
      if (convText) {
        interpretations.push(`There was ${convText}.`);
      }
    }

    return interpretations.join(' ');
  }

  function generateRegimeClassification(r) {
    const factors = getFactorsSortedByMagnitude(r);
    const dominant = factors[0];

    let regime = '';

    if (r.vix_change_abs < -2) {
      regime = 'This suggests that <span class="highlight-neutral">while demand for immediate crash protection has stabilized, the market is pricing in reduced near-term risk</span>, consistent with a volatility mean-reversion regime.';
    } else if (r.vix_change_abs > 3) {
      if (r.put_skew > 0.5 && r.downside_convexity > 0.3) {
        regime = 'This suggests the market is <span class="highlight-positive">pricing in more extreme tail-risk potential on the downside</span> while simultaneously reducing exposure for further sharp upside movements — a classic fear-driven vol spike.';
      } else {
        regime = 'This indicates <span class="highlight-positive">broad-based volatility repricing</span> with significant uncertainty across the options curve.';
      }
    } else if (r.vix_change_abs > 0 && r.parallel_shift > 0.5 && Math.abs(r.sticky_strike) < 0.3) {
      regime = 'Notably, the VIX rose despite minimal S&P 500 movement, driven primarily by <span class="highlight-positive">a broad repricing of implied volatility</span> — suggesting a sentiment or regime shift rather than a mechanical response to spot movement.';
    } else if (r.vix_change_abs < 0) {
      regime = 'This pattern is consistent with <span class="highlight-negative">a classic risk-on environment</span> where reduced fear is broadly suppressing volatility premiums.';
    } else {
      regime = 'The VIX change reflects a <span class="highlight-neutral">moderate shift in volatility expectations</span>, with the decomposition revealing the underlying dynamics behind the headline move.';
    }

    return regime;
  }

  function generateSkewAnalysis(r) {
    if (!r.skew_to) return '';
    const skew = r.skew_to;
    const skewChg = r.skew_change_abs;
    
    let analysis = `<br><br><strong>CBOE SKEW Index Insight:</strong> The SKEW index closed at <strong>${skew.toFixed(2)}</strong> (a change of ${skewChg >= 0 ? '+' : ''}${skewChg.toFixed(2)} pts). `;
    
    if (skew >= 135) {
      analysis += 'This extremely elevated level indicates significant tail risk pricing; market participants are heavily bidding up out-of-the-money puts relative to calls, anticipating a potential steep market correction (strong smirk).';
    } else if (skew >= 120) {
      analysis += 'This elevated level shows a pronounced "smirk" in the volatility curve, meaning investors are actively paying a premium for downside crash protection.';
    } else if (skew >= 110) {
      analysis += 'This is a normal market skew level. There is standard demand for downside puts compared to upside calls, representing typical hedging activity.';
    } else {
      analysis += 'This relatively low level suggests a flatter volatility "smile", meaning less fear of tail risk and more symmetrical pricing between out-of-the-money calls and puts.';
    }
    
    if (r.vix_change_abs < 0 && skewChg > 2) {
      analysis += ' Interestingly, while the VIX overall declined (showing reduced near-the-money fear), the SKEW index rose. This divergence often occurs when investors confidently sell near-term vol while quietly buying cheap far out-of-the-money puts for catastrophic risk.';
    } else if (r.vix_change_abs > 0 && skewChg < -2) {
      analysis += ' Notably, while the VIX overall rose, the SKEW index fell. This implies the fear is concentrated around near-the-money strikes rather than extreme crash scenarios (the implied volatility curve is shifting up but flattening out).';
    } else if (r.vix_change_abs > 0 && skewChg > 2) {
      analysis += ' The simultaneous rise in both VIX and SKEW confirms a strong, broad-based bid for volatility with a specific emphasis on panic/downside protection.';
    }
    
    return analysis;
  }

  // ---- Helpers ----

  function getFactorsSortedByMagnitude(r) {
    const factors = [
      { key: 'sticky_strike', label: 'Sticky Strike', value: r.sticky_strike },
      { key: 'parallel_shift', label: 'Parallel Shift', value: r.parallel_shift },
      { key: 'put_skew', label: 'Put Skew', value: r.put_skew },
      { key: 'call_skew', label: 'Call Skew', value: r.call_skew },
      { key: 'downside_convexity', label: 'Downside Convexity', value: r.downside_convexity },
      { key: 'upside_convexity', label: 'Upside Convexity', value: r.upside_convexity },
    ];
    factors.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    return factors;
  }

  function formatValue(v) {
    if (v >= 0) return v.toFixed(2);
    return `${v.toFixed(2)}`;
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  }

  return { generateAnalysis, getFactorsSortedByMagnitude };
})();
