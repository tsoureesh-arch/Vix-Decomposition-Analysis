// Risk Reversal Analysis Module
class RiskReversalModel {
  constructor() {
    this.data = [];
    this.models = {
      price: { slope: 0, intercept: 0 },
      iv: { slope: 0, intercept: 0 }
    };
    this.charts = {
      timeline: null,
      scatter: null
    };
  }

  async init() {
    try {
      const response = await fetch('data/vix_model_data.json');
      if (!response.ok) throw new Error("Failed to load VIX model data");
      this.data = await response.json();
      
      this.data.sort((a, b) => new Date(a.Date) - new Date(b.Date));
      
      this.calculateRegressions();
      this.initCharts();
      this.setupEventListeners();
      
      // Run initial model calculation
      this.runModel();
      
    } catch (error) {
      console.error("Error initializing Risk Reversal Model:", error);
    }
  }

  calculateRegressions() {
    // Simple Linear Regression: y = mx + b
    const n = this.data.length;
    let sumX = 0, sumY_price = 0, sumY_iv = 0;
    let sumXY_price = 0, sumXY_iv = 0;
    let sumXX = 0;

    this.data.forEach(d => {
      const x = d.VIX;
      const yp = d.RR_Price;
      const yiv = d.RR_IV;
      
      sumX += x;
      sumY_price += yp;
      sumY_iv += yiv;
      sumXX += x * x;
      sumXY_price += x * yp;
      sumXY_iv += x * yiv;
    });

    const denominator = (n * sumXX - sumX * sumX);
    
    // Price Model
    this.models.price.slope = (n * sumXY_price - sumX * sumY_price) / denominator;
    this.models.price.intercept = (sumY_price - this.models.price.slope * sumX) / n;
    
    // IV Model
    this.models.iv.slope = (n * sumXY_iv - sumX * sumY_iv) / denominator;
    this.models.iv.intercept = (sumY_iv - this.models.iv.slope * sumX) / n;
  }

  runModel() {
    const vixInput = document.getElementById('vix-input');
    if (!vixInput) return;
    
    const vix = parseFloat(vixInput.value);
    if (isNaN(vix)) return;
    
    const predPrice = this.models.price.slope * vix + this.models.price.intercept;
    const predIV = this.models.iv.slope * vix + this.models.iv.intercept;
    
    document.getElementById('rr-pred-price').textContent = predPrice.toFixed(2);
    document.getElementById('rr-pred-iv').textContent = (predIV * 100).toFixed(2) + '%';
    
    // Highlight on scatter chart
    if (this.charts.scatter) {
      const scatterData = this.charts.scatter.data.datasets;
      // We can update a special "prediction" point
      if (scatterData.length > 2) {
        scatterData[2].data = [{ x: vix, y: predPrice }];
      } else {
        scatterData.push({
          label: 'Prediction',
          data: [{ x: vix, y: predPrice }],
          backgroundColor: '#ff7675',
          borderColor: '#d63031',
          pointRadius: 8,
          pointHoverRadius: 10,
          type: 'scatter'
        });
      }
      this.charts.scatter.update();
    }
  }

  setupEventListeners() {
    const btn = document.getElementById('btn-run-model');
    if (btn) {
      btn.addEventListener('click', () => this.runModel());
    }
    const input = document.getElementById('vix-input');
    if (input) {
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.runModel();
      });
    }
  }

  initCharts() {
    const commonOptions = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: { labels: { color: '#a0aec0' } },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.9)',
          titleColor: '#fff',
          bodyColor: '#cbd5e1',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#64748b' }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#64748b' }
        }
      }
    };

    // 1. Timeline Chart
    const ctxTimeline = document.getElementById('rr-timeline-chart');
    if (ctxTimeline) {
      const labels = this.data.map(d => d.Date);
      
      this.charts.timeline = new Chart(ctxTimeline, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            {
              label: 'VIX',
              data: this.data.map(d => d.VIX),
              borderColor: '#00B894',
              backgroundColor: 'transparent',
              yAxisID: 'y',
              borderWidth: 2,
              tension: 0.2,
              pointRadius: 0
            },
            {
              label: 'RR 25-Delta Price',
              data: this.data.map(d => d.RR_Price),
              borderColor: '#6C5CE7',
              backgroundColor: 'transparent',
              yAxisID: 'y1',
              borderWidth: 2,
              tension: 0.2,
              pointRadius: 0
            }
          ]
        },
        options: {
          ...commonOptions,
          scales: {
            ...commonOptions.scales,
            y: {
              type: 'linear',
              display: true,
              position: 'left',
              title: { display: true, text: 'VIX', color: '#00B894' },
              grid: { color: 'rgba(255,255,255,0.05)' },
              ticks: { color: '#64748b' }
            },
            y1: {
              type: 'linear',
              display: true,
              position: 'right',
              title: { display: true, text: 'RR Price', color: '#6C5CE7' },
              grid: { drawOnChartArea: false },
              ticks: { color: '#64748b' }
            }
          }
        }
      });
    }

    // 2. Scatter Chart (VIX vs Price)
    const ctxScatter = document.getElementById('rr-scatter-chart');
    if (ctxScatter) {
      const scatterPoints = this.data.map(d => ({ x: d.VIX, y: d.RR_Price }));
      
      // Generate line points
      const minVix = Math.min(...this.data.map(d => d.VIX));
      const maxVix = Math.max(...this.data.map(d => d.VIX));
      
      const linePoints = [
        { x: minVix, y: this.models.price.slope * minVix + this.models.price.intercept },
        { x: maxVix, y: this.models.price.slope * maxVix + this.models.price.intercept }
      ];

      this.charts.scatter = new Chart(ctxScatter, {
        type: 'scatter',
        data: {
          datasets: [
            {
              label: 'Historical Data',
              data: scatterPoints,
              backgroundColor: 'rgba(108, 92, 231, 0.5)',
              borderColor: 'rgba(108, 92, 231, 0.8)',
              pointRadius: 3
            },
            {
              label: 'Regression Line',
              data: linePoints,
              type: 'line',
              borderColor: '#00B894',
              backgroundColor: 'transparent',
              borderWidth: 2,
              pointRadius: 0,
              fill: false
            }
          ]
        },
        options: {
          ...commonOptions,
          interaction: { mode: 'nearest' },
          scales: {
            x: {
              type: 'linear',
              position: 'bottom',
              title: { display: true, text: 'VIX', color: '#a0aec0' },
              grid: { color: 'rgba(255,255,255,0.05)' },
              ticks: { color: '#64748b' }
            },
            y: {
              title: { display: true, text: 'RR Price', color: '#a0aec0' },
              grid: { color: 'rgba(255,255,255,0.05)' },
              ticks: { color: '#64748b' }
            }
          }
        }
      });
    }
  }
}

// Global instance to be used by main.js if needed
window.rrModel = new RiskReversalModel();
