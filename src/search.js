/**
 * VIX Decomposition — Search & Filter Engine
 * Multi-rule filter builder with AND/OR logic + cosine similarity for "find similar"
 */

const SearchEngine = (() => {

  const FACTOR_KEYS = [
    'sticky_strike', 'parallel_shift', 'put_skew',
    'call_skew', 'downside_convexity', 'upside_convexity'
  ];

  const SEARCHABLE_FIELDS = [
    { key: 'sticky_strike', label: 'Sticky Strike' },
    { key: 'parallel_shift', label: 'Parallel Shift' },
    { key: 'put_skew', label: 'Put Skew' },
    { key: 'call_skew', label: 'Call Skew' },
    { key: 'downside_convexity', label: 'Downside Convexity' },
    { key: 'upside_convexity', label: 'Upside Convexity' },
    { key: 'vix_change_abs', label: 'VIX Change (Abs)' },
    { key: 'vix_change_pct', label: 'VIX Change (%)' },
    { key: 'spx_change_abs', label: 'SPX Change (Abs)' },
    { key: 'spx_change_pct', label: 'SPX Change (%)' },
    { key: 'vix_from', label: 'VIX Level (From)' },
    { key: 'vix_to', label: 'VIX Level (To)' },
    { key: 'skew_to', label: 'SKEW Index Level' },
    { key: 'skew_change_abs', label: 'SKEW Change (Abs)' },
    { key: 'skew_change_pct', label: 'SKEW Change (%)' },
    { key: 'total', label: 'Total Decomposition' },
  ];

  const OPERATORS = [
    { key: 'gt', label: 'Greater than (>)' },
    { key: 'gte', label: 'Greater or equal (≥)' },
    { key: 'lt', label: 'Less than (<)' },
    { key: 'lte', label: 'Less or equal (≤)' },
    { key: 'eq', label: 'Equal to (=)' },
    { key: 'between', label: 'Between (range)' },
  ];

  /**
   * Evaluate a single rule against a record.
   */
  function evaluateRule(record, rule) {
    const val = record[rule.field];
    if (val === undefined || val === null) return false;

    const v1 = parseFloat(rule.value);
    const v2 = rule.value2 ? parseFloat(rule.value2) : null;

    if (isNaN(v1)) return true; // skip invalid rules

    switch (rule.operator) {
      case 'gt': return val > v1;
      case 'gte': return val >= v1;
      case 'lt': return val < v1;
      case 'lte': return val <= v1;
      case 'eq': return Math.abs(val - v1) < 0.005;
      case 'between':
        if (v2 === null || isNaN(v2)) return true;
        return val >= Math.min(v1, v2) && val <= Math.max(v1, v2);
      default: return true;
    }
  }

  /**
   * Apply filter rules with AND/OR logic.
   * Rules are processed left-to-right. Each rule has a `logic` property ('and' or 'or')
   * that specifies how it connects to the PREVIOUS rule.
   * 
   * Strategy: Group consecutive AND rules into groups, then OR between groups.
   * Example: R1 AND R2 OR R3 AND R4 → (R1 AND R2) OR (R3 AND R4)
   */
  function applyFilters(data, rules) {
    if (!rules || rules.length === 0) return [...data];

    // Build groups: split on 'or' logic
    const groups = [];
    let currentGroup = [];

    rules.forEach((rule, i) => {
      if (i === 0 || rule.logic === 'and') {
        currentGroup.push(rule);
      } else {
        // 'or' — push current group and start new one
        groups.push(currentGroup);
        currentGroup = [rule];
      }
    });
    if (currentGroup.length > 0) groups.push(currentGroup);

    return data.filter(record => {
      // OR between groups: at least one group must fully match
      return groups.some(group => {
        // AND within group: every rule in the group must match
        return group.every(rule => evaluateRule(record, rule));
      });
    });
  }

  /**
   * Find records most similar to a reference record using cosine similarity.
   */
  function findSimilar(reference, data, topN = 5) {
    const refVector = FACTOR_KEYS.map(k => reference[k]);

    const scored = data
      .filter(r => r.date_to !== reference.date_to)
      .map(record => {
        const vec = FACTOR_KEYS.map(k => record[k]);
        const sim = cosineSimilarity(refVector, vec);
        return { record, similarity: sim };
      });

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, topN);
  }

  function cosineSimilarity(a, b) {
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (normA * normB);
  }

  /**
   * Generate a rich summary for a decomposition record.
   */
  function shortSummary(r) {
    const spxDir = r.spx_change_abs >= 0 ? 'pos' : 'neg';
    const vixDir = r.vix_change_abs >= 0 ? 'pos' : 'neg';

    // Get dominant components
    const factors = FACTOR_KEYS
      .map(k => ({ key: k, value: r[k], label: k.replace(/_/g, ' ') }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    
    const topFactor = factors[0];
    const top2Factor = factors[1];

    return `
      <div class="summary-line">
        <div class="summary-group market-group">
          <div class="summary-ohlc-item">
            <span class="ohlc-label">SPX</span>
            <span class="ohlc-val">${r.spx_to.toFixed(2)}</span>
            <span class="ohlc-chg ${spxDir}">${r.spx_change_pct >= 0 ? '↑' : '↓'} ${Math.abs(r.spx_change_pct).toFixed(2)}%</span>
            <div class="ohlc-detail">H: ${r.spx_high?.toFixed(1) || '--'} L: ${r.spx_low?.toFixed(1) || '--'}</div>
          </div>
          <div class="summary-ohlc-item">
            <span class="ohlc-label">VIX</span>
            <span class="ohlc-val">${r.vix_to.toFixed(2)}</span>
            <span class="ohlc-chg ${vixDir === 'neg' ? 'pos' : 'neg'}">${r.vix_change_abs >= 0 ? '↑' : '↓'} ${Math.abs(r.vix_change_pct).toFixed(2)}%</span>
            <div class="ohlc-detail">H: ${r.vix_high?.toFixed(1) || '--'} L: ${r.vix_low?.toFixed(1) || '--'}</div>
          </div>
        </div>
        <div class="summary-group component-group">
          <span class="component-pill dominant">${topFactor.label}: ${topFactor.value >= 0 ? '+' : ''}${topFactor.value.toFixed(2)}</span>
          <span class="component-pill">${top2Factor.label}: ${top2Factor.value >= 0 ? '+' : ''}${top2Factor.value.toFixed(2)}</span>
        </div>
      </div>
    `;
  }

  return {
    SEARCHABLE_FIELDS,
    OPERATORS,
    FACTOR_KEYS,
    applyFilters,
    findSimilar,
    cosineSimilarity,
    shortSummary,
  };
})();
