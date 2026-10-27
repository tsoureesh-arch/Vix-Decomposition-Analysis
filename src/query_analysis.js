/* MarketScope Ask Data — fast client-side natural-language query layer. */
window.QueryAnalysis = (() => {
  let records = [];
  let chart = null;
  let initialized = false;

  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const FACTORS = [
    ['call skew', 'call_skew', 'Call skew'],
    ['put skew', 'put_skew', 'Put skew'],
    ['sticky strike', 'sticky_strike', 'Sticky strike'],
    ['parallel shift', 'parallel_shift', 'Parallel shift'],
    ['downside convexity', 'downside_convexity', 'Downside convexity'],
    ['upside convexity', 'upside_convexity', 'Upside convexity'],
    ['skew', 'skew_change_abs', 'SKEW change'],
    ['vix', 'vix_change_pct', 'VIX change'],
    ['market', 'spx_change_pct', 'S&P 500 change'],
    ['s&p', 'spx_change_pct', 'S&P 500 change'],
    ['spx', 'spx_change_pct', 'S&P 500 change']
  ];

  function esc(value) {
    return String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  }
  function fmtDate(date) {
    return new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
  function signed(value, suffix = '%') {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return `${value >= 0 ? '+' : ''}${Number(value).toFixed(2)}${suffix}`;
  }
  function average(values) {
    const valid = values.filter(v => typeof v === 'number' && Number.isFinite(v));
    return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
  }

  function extractDirection(q, start) {
    const slice = q.slice(start);
    const down = /\b(fell|fall|drop|dropped|down|declin(?:e|ed)|decrease(?:d)?|lower)\b/.test(slice);
    const up = /\b(rose|rise|rall(?:y|ied)|up|increas(?:e|ed)|higher)\b/.test(slice);
    return down ? 'down' : up ? 'up' : null;
  }

  function parseQuery(input) {
    const q = input.toLowerCase().replace(/[,?]/g, ' ').replace(/\s+/g, ' ').trim();
    const day = DAYS.find(d => new RegExp(`\\b${d}\\b`).test(q));
    const wantsChart = /\b(plot|graph|chart|visuali[sz]e)\b/.test(q);
    const nextDay = /\b(next day|following day|next trading day|tomorrow)\b/.test(q);
    const nextStart = nextDay ? q.search(/next day|following day|next trading day|tomorrow/) : -1;
    const currentDayClause = nextStart >= 0 ? q.slice(0, nextStart) : q;
    const rules = [];
    let usedFactor = null;

    FACTORS.forEach(([phrase, field, label]) => {
      const at = q.indexOf(phrase);
      if (at < 0 || (phrase === 'skew' && /call skew|put skew/.test(q))) return;
      // A factor mentioned after "next day" describes the outcome, not the
      // current-day pattern. Keep it out of the current-day rule set.
      if (nextStart >= 0 && at >= nextStart) return;
      const clauseEnd = nextStart > at ? nextStart : Math.min(q.length, at + phrase.length + 70);
      const clause = q.slice(at, clauseEnd);
      const after = clause.slice(phrase.length);
      const direction = extractDirection(clause, phrase.length);
      const amount = after.match(/(?:by\s+)?(-?\d+(?:\.\d+)?)(?:\s*(?:point|pts|%|percent))?/);
      if (direction || amount) {
        const threshold = amount ? Math.abs(Number(amount[1])) : 0;
        rules.push({ field, label, direction: direction || 'any', threshold });
        usedFactor = { field, label };
      }
    });

    // A broad "market fell" query should work even when no numeric threshold is supplied.
    if (!rules.some(r => r.field === 'spx_change_pct') && /\b(market|s&p|spx)\b/.test(currentDayClause) && /\b(fell|fall|down|dropped|drop|declined)\b/.test(currentDayClause)) {
      rules.push({ field: 'spx_change_pct', label: 'S&P 500 change', direction: 'down', threshold: 0 });
      usedFactor = { field: 'spx_change_pct', label: 'S&P 500 change' };
    }

    let nextDirection = null;
    if (nextDay && /\b(market|s&p|spx)\b/.test(q)) {
      nextDirection = extractDirection(q, Math.max(0, nextStart));
    }
    const chartMetric = usedFactor || (q.includes('vix') ? { field: 'vix_change_pct', label: 'VIX change' } : { field: 'spx_change_pct', label: 'S&P 500 change' });
    return { q, day, wantsChart, nextDay, nextDirection, rules, chartMetric };
  }

  function matchesRule(record, rule) {
    const value = Number(record[rule.field]);
    if (!Number.isFinite(value)) return false;
    if (rule.direction === 'down') return value <= -rule.threshold;
    if (rule.direction === 'up') return value >= rule.threshold;
    return Math.abs(value) >= rule.threshold;
  }

  function runQuery(input) {
    const parsed = parseQuery(input);
    if (!parsed.day && !parsed.rules.length) return { parsed, rows: [], unrecognized: true };
    let rows = records.map((record, index) => ({ record, index, next: records[index + 1] || null }));
    if (parsed.day) rows = rows.filter(({ record }) => new Date(record.date_to + 'T00:00:00').getDay() === DAYS.indexOf(parsed.day));
    if (parsed.rules.length) rows = rows.filter(({ record }) => parsed.rules.every(rule => matchesRule(record, rule)));
    if (parsed.nextDirection) rows = rows.filter(({ next }) => next && (parsed.nextDirection === 'down' ? next.spx_change_pct < 0 : next.spx_change_pct > 0));
    return { parsed, rows, unrecognized: false };
  }

  function describe(parsed) {
    const parts = [];
    if (parsed.day) parts.push(`${parsed.day[0].toUpperCase() + parsed.day.slice(1)} trading days`);
    parsed.rules.forEach(r => parts.push(`${r.label} ${r.direction === 'down' ? 'fell' : r.direction === 'up' ? 'rose' : 'moved'} by ${r.threshold || 'any amount'}${r.field.includes('pct') ? '%' : ''}`));
    if (parsed.nextDirection) parts.push(`next trading day S&P 500 was ${parsed.nextDirection}`);
    return parts.join(' · ');
  }

  function render(result, input) {
    const empty = document.getElementById('query-empty');
    const area = document.getElementById('query-results');
    const summary = document.getElementById('query-summary');
    const head = document.getElementById('query-table-head');
    const body = document.getElementById('query-table-body');
    const chartWrap = document.getElementById('query-chart-wrap');
    empty.classList.add('hidden');
    area.classList.remove('hidden');
    if (chart) { chart.destroy(); chart = null; }

    if (result.unrecognized) {
      summary.innerHTML = `<strong>I couldn’t turn that into a data filter yet.</strong><br>Try a weekday, a direction, or a factor threshold — for example: <em>“Show Mondays where VIX fell”</em> or <em>“when call skew fell 0.2 and next day market was down”</em>.`;
      head.innerHTML = ''; body.innerHTML = ''; chartWrap.classList.add('hidden');
      return;
    }

    const { parsed, rows } = result;
    const sameDaySpx = average(rows.map(x => x.record.spx_change_pct));
    const sameDayVix = average(rows.map(x => x.record.vix_change_pct));
    const nextRows = rows.filter(x => x.next);
    const nextAvg = average(nextRows.map(x => x.next.spx_change_pct));
    const nextUp = nextRows.filter(x => x.next.spx_change_pct > 0).length;
    const nextDown = nextRows.filter(x => x.next.spx_change_pct < 0).length;
    const criteria = describe(parsed) || esc(input);
    summary.innerHTML = rows.length
      ? `<strong>${rows.length} matching incident${rows.length === 1 ? '' : 's'}</strong> for <em>${esc(criteria)}</em>.<br>Average same-day S&P 500 move: <span class="query-stat">${signed(sameDaySpx)}</span> · Average same-day VIX move: <span class="query-stat">${signed(sameDayVix)}</span>${nextRows.length ? `<br>On the next trading day: <span class="query-stat">${nextUp} up</span>, <span class="query-stat">${nextDown} down</span> · average S&P 500 move <span class="query-stat">${signed(nextAvg)}</span>.` : ''}`
      : `<strong>No matching incidents</strong> for <em>${esc(criteria)}</em>. Try a smaller threshold, for example <em>“call skew fell 0.1”</em>.`;

    head.innerHTML = '<tr><th>Date</th><th>Day</th><th>S&amp;P 500</th><th>VIX</th><th>Call Skew</th><th>Next Trading Day S&amp;P</th></tr>';
    body.innerHTML = rows.length ? rows.slice().reverse().map(({ record, next }) => `<tr>
      <td>${fmtDate(record.date_to)}</td>
      <td>${new Date(record.date_to + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' })}</td>
      <td class="${record.spx_change_pct >= 0 ? 'positive' : 'negative'}">${signed(record.spx_change_pct)}</td>
      <td class="${record.vix_change_pct >= 0 ? 'negative' : 'positive'}">${signed(record.vix_change_pct)}</td>
      <td class="${record.call_skew >= 0 ? 'positive' : 'negative'}">${signed(record.call_skew, '')}</td>
      <td class="${!next ? '' : next.spx_change_pct >= 0 ? 'positive' : 'negative'}">${next ? signed(next.spx_change_pct) : '—'}</td>
    </tr>`).join('') : '<tr><td class="query-no-results" colspan="6">No rows to display.</td></tr>';

    if (parsed.wantsChart && rows.length) renderChart(rows, parsed.chartMetric, chartWrap);
    else chartWrap.classList.add('hidden');
  }

  function renderChart(rows, metric, wrap) {
    wrap.classList.remove('hidden');
    const canvas = document.getElementById('query-chart');
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    const isLight = theme === 'light';
    chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: rows.map(x => new Date(x.record.date_to + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })),
        datasets: [{ label: metric.label, data: rows.map(x => x.record[metric.field]), borderRadius: 4, backgroundColor: rows.map(x => x.record[metric.field] >= 0 ? 'rgba(16,185,129,.78)' : 'rgba(239,68,68,.78)') }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: isLight ? '#334155' : '#cbd5e1' } }, tooltip: { callbacks: { label: c => `${metric.label}: ${signed(c.parsed.y, metric.field.includes('pct') ? '%' : '')}` } } }, scales: { x: { ticks: { color: isLight ? '#64748b' : '#94a3b8', maxRotation: 45 }, grid: { display: false } }, y: { ticks: { color: isLight ? '#64748b' : '#94a3b8' }, grid: { color: isLight ? 'rgba(15,23,42,.08)' : 'rgba(255,255,255,.08)' } } } }
    });
  }

  function submit(input) {
    const clean = input.trim();
    if (clean) render(runQuery(clean), clean);
  }

  function init(data) {
    records = data || [];
    const count = document.getElementById('query-data-count');
    const form = document.getElementById('query-form');
    const input = document.getElementById('query-input');
    if (!count || !form || !input) return;
    count.textContent = `${records.length.toLocaleString()} trading days`;
    if (initialized) return;
    initialized = true;
    form.addEventListener('submit', event => { event.preventDefault(); submit(input.value); });
    document.querySelectorAll('.query-example').forEach(button => button.addEventListener('click', () => { input.value = button.textContent; submit(button.textContent); }));
  }

  function activate() { document.getElementById('query-input')?.focus(); }
  return { init, activate };
})();
