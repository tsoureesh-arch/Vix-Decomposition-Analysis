/**
 * VIX Decomposition — Charts Module
 * Theme-aware waterfall + vol curve charts using Chart.js
 */
const ChartsModule = (() => {
  let waterfallChart = null;
  let volCurveChart = null;

  const FACTOR_CONFIG = [
    { key: 'sticky_strike', label: 'Sticky Strike', color: '#6C5CE7' },
    { key: 'parallel_shift', label: 'Parallel Shift', color: '#3B82F6' },
    { key: 'put_skew', label: 'Put Skew', color: '#F59E0B' },
    { key: 'call_skew', label: 'Call Skew', color: '#EC4899' },
    { key: 'downside_convexity', label: 'Down Conv', color: '#EF4444' },
    { key: 'upside_convexity', label: 'Up Conv', color: '#06B6D4' },
  ];

  function getThemeColors(theme) {
    const isLight = theme === 'light';
    return {
      grid: isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.04)',
      tick: isLight ? '#64748b' : '#64748b',
      tooltipBg: isLight ? 'rgba(255, 255, 255, 0.95)' : 'rgba(17, 24, 39, 0.95)',
      tooltipTitle: isLight ? '#1e293b' : '#f1f5f9',
      tooltipBody: isLight ? '#475569' : '#94a3b8',
      tooltipBorder: isLight ? 'rgba(99, 102, 241, 0.2)' : 'rgba(99, 102, 241, 0.3)',
      pointBg: isLight ? '#ffffff' : '#0a0e1a',
    };
  }

  function createWaterfallChart(canvasId, record, theme) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (waterfallChart) waterfallChart.destroy();

    const tc = getThemeColors(theme);

    const labels = FACTOR_CONFIG.map(f => f.label);
    labels.push('Total');
    const values = FACTOR_CONFIG.map(f => record[f.key]);
    values.push(record.total);

    const colors = values.map((v, i) => {
      if (i === values.length - 1)
        return v >= 0 ? 'rgba(16,185,129,0.85)' : 'rgba(239,68,68,0.85)';
      return v >= 0
        ? `rgba(16,185,129,${0.5 + Math.min(Math.abs(v)/3, 0.4)})`
        : `rgba(239,68,68,${0.5 + Math.min(Math.abs(v)/3, 0.4)})`;
    });

    const borderColors = values.map(v => v >= 0 ? '#10B981' : '#EF4444');

    waterfallChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderColor: borderColors,
          borderWidth: 1.5,
          borderRadius: 6,
          borderSkipped: false,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: tc.tooltipBg,
            titleColor: tc.tooltipTitle,
            bodyColor: tc.tooltipBody,
            borderColor: tc.tooltipBorder,
            borderWidth: 1,
            cornerRadius: 8,
            padding: 12,
            callbacks: {
              label: ctx => {
                const v = ctx.parsed.y;
                return `${v >= 0 ? '+' : ''}${v.toFixed(2)} VIX pts`;
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { color: tc.tick, font: { size: 11 }, maxRotation: 0 },
            grid: { display: false },
            border: { display: false },
          },
          y: {
            ticks: {
              color: tc.tick,
              font: { family: 'JetBrains Mono', size: 11 },
              callback: v => (v >= 0 ? '+' : '') + v.toFixed(1),
            },
            grid: { color: tc.grid, drawTicks: false },
            border: { display: false },
          }
        },
        animation: { duration: 800, easing: 'easeOutQuart' },
      }
    });
  }

  function createVolCurveChart(canvasId, record, theme) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (volCurveChart) volCurveChart.destroy();
    
    if (!record.skew_to) return;
    
    const tc = getThemeColors(theme);
    const skew = record.skew_to;
    const vix = record.vix_to;
    
    const strikes = [80, 85, 90, 95, 100, 105, 110, 115, 120];
    const dataSmile = strikes.map(k => {
      const baseIv = vix;
      const deviation = (k - 100) / 100;
      let iv = baseIv + Math.pow(deviation * 10, 2) * (baseIv * 0.05); 
      const skewTilt = -deviation * ((skew - 100) / 10) * (baseIv * 0.1);
      iv += skewTilt;
      return Math.max(iv, baseIv * 0.5);
    });

    const captionEl = document.getElementById('vol-curve-caption');
    if (captionEl) {
      if (skew >= 135) captionEl.innerHTML = "<strong>Extreme Smirk:</strong> High demand for out-of-the-money puts.";
      else if (skew >= 120) captionEl.innerHTML = "<strong>Steep Smirk:</strong> Elevated demand for downside protection.";
      else if (skew >= 110) captionEl.innerHTML = "<strong>Normal Smirk:</strong> Typical market skew with some downside bias.";
      else captionEl.innerHTML = "<strong>Smile / Flat Skew:</strong> Symmetric demand, less fear of tail risk.";
    }

    volCurveChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: strikes.map(k => `${k}%`),
        datasets: [{
          label: 'Implied Volatility',
          data: dataSmile,
          borderColor: '#EC4899',
          backgroundColor: 'rgba(236,72,153,0.1)',
          borderWidth: 3,
          tension: 0.4,
          fill: true,
          pointBackgroundColor: tc.pointBg,
          pointBorderColor: '#EC4899',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: tc.tooltipBg,
            titleColor: tc.tooltipTitle,
            bodyColor: tc.tooltipBody,
            callbacks: {
              label: ctx => `IV: ${ctx.parsed.y.toFixed(1)}%`
            }
          }
        },
        scales: {
          x: {
            title: { display: true, text: 'Moneyness (% of Spot)', color: tc.tick },
            ticks: { color: tc.tick, font: { size: 11 } },
            grid: { color: tc.grid },
          },
          y: {
            title: { display: true, text: 'Implied Volatility', color: tc.tick },
            ticks: { color: tc.tick, font: { family: 'JetBrains Mono', size: 11 } },
            grid: { color: tc.grid, drawTicks: false },
            border: { display: false },
          }
        },
        animation: { duration: 800, easing: 'easeOutQuart' },
      }
    });
  }

  return { createWaterfallChart, createVolCurveChart };
})();
