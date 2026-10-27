/**
 * Market Calendar Module
 * Handles Monthly Grid rendering, List rendering, filtering, and event details.
 * Features Nasdaq 2026 Trading Calendar styling.
 */
(function() {
  let allEvents = [];
  let currentFilter = 'all';
  let currentView = 'grid'; // 'grid' or 'list'
  
  // Initialize to June 2026 (the active month in user metadata, 0-indexed is 5)
  let currentYear = 2026;
  let currentMonthIdx = 5; 

  const typeConfig = {
    'fed': { label: 'Fed / Central Bank', color: '#6C5CE7', icon: '🏦' },
    'earnings': { label: 'Earnings', color: '#3B82F6', icon: '📈' },
    'economic': { label: 'Economic Data', color: '#10B981', icon: '📊' },
    'holiday': { label: 'Exchange Holiday', color: '#EF4444', icon: '🏖️' },
    'early_close': { label: 'Early Close (1PM)', color: '#F59E0B', icon: '⏰' },
    'opex': { label: 'Monthly Options Expiry', color: '#10B981', icon: '🟢' },
    'triple_witch': { label: 'Triple Witch Expiration', color: '#6C5CE7', icon: '🟣' },
    'vix_expiry': { label: 'VIX Futures Expiration', color: '#06B6D4', icon: '🔵' },
    'rebalance': { label: 'Index Rebalance', color: '#EC4899', icon: '⚖️' },
    'short_interest': { label: 'Short Interest Release', color: '#EC4899', icon: '📅' },
    'speech': { label: 'Fed Speech', color: '#8B5CF6', icon: '🎙️' }
  };

  const impactColors = {
    'high': '#EF4444',
    'medium': '#F59E0B',
    'low': '#10B981'
  };

  async function loadCalendarData() {
    try {
      const res = await fetch(`data/market_calendar.json?t=${new Date().getTime()}`);
      if (!res.ok) throw new Error('Failed to load calendar data');
      const data = await res.json();
      allEvents = data;
      
      // Auto-detect month from current date if in 2026
      const systemDate = new Date();
      if (systemDate.getFullYear() === 2026) {
        currentMonthIdx = systemDate.getMonth();
      }
      
      const selectEl = document.getElementById('calendar-month-select');
      if (selectEl) selectEl.value = currentMonthIdx;

      updateCalendarView();
      renderThisWeek();
    } catch (e) {
      console.error(e);
      document.getElementById('calendar-list').innerHTML = `<div class="error-msg">Failed to load calendar data.</div>`;
      document.getElementById('calendar-grid-view').innerHTML = `<div class="error-msg">Failed to load calendar data.</div>`;
    }
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function updateCalendarView() {
    const gridViewEl = document.getElementById('calendar-grid-view');
    const listViewEl = document.getElementById('calendar-list');
    const legendEl = document.getElementById('calendar-legend');
    const monthSelectorEl = document.getElementById('calendar-month-selector');
    const viewTitleEl = document.getElementById('calendar-view-title');

    if (currentView === 'grid') {
      gridViewEl.style.display = 'block';
      listViewEl.style.display = 'none';
      legendEl.style.display = 'block';
      monthSelectorEl.style.display = 'flex';
      viewTitleEl.textContent = 'Trading Calendar';
      renderGrid();
    } else {
      gridViewEl.style.display = 'none';
      listViewEl.style.display = 'block';
      legendEl.style.display = 'none';
      monthSelectorEl.style.display = 'none';
      viewTitleEl.textContent = 'Upcoming Market Events (2026)';
      renderList();
    }
  }

  // --- 1. RENDER MONTH GRID VIEW (Nasdaq style) ---
  function renderGrid() {
    const container = document.getElementById('calendar-grid-view');
    container.innerHTML = '';

    const year = currentYear;
    const month = currentMonthIdx;

    // Days header: Monday first to match Nasdaq PDF Trading Calendar
    const daysHeader = document.createElement('div');
    daysHeader.className = 'grid-days-header';
    ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach(day => {
      const dayLabel = document.createElement('div');
      dayLabel.className = 'grid-header-cell';
      dayLabel.textContent = day;
      daysHeader.appendChild(dayLabel);
    });
    container.appendChild(daysHeader);

    // Days grid
    const daysGrid = document.createElement('div');
    daysGrid.className = 'grid-days-container';

    // Monday-first starting index: (getDay() + 6) % 7
    const firstDayIndex = (new Date(year, month, 1).getDay() + 6) % 7;
    const numDays = new Date(year, month + 1, 0).getDate();

    // Empty cells before the 1st
    for (let i = 0; i < firstDayIndex; i++) {
      const emptyCell = document.createElement('div');
      emptyCell.className = 'grid-cell empty';
      daysGrid.appendChild(emptyCell);
    }

    const todayStr = new Date().toISOString().split('T')[0];

    // Day cells
    for (let day = 1; day <= numDays; day++) {
      const cell = document.createElement('div');
      cell.className = 'grid-cell';
      
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      cell.dataset.date = dateStr;

      // Filter events occurring on this date
      const dayEvents = allEvents.filter(ev => {
        if (ev.date !== dateStr) return false;
        if (currentFilter === 'all') return true;
        // Filter mappings
        if (currentFilter === 'economic') return ev.type === 'economic';
        if (currentFilter === 'fed') return ev.type === 'fed' || ev.type === 'speech';
        if (currentFilter === 'earnings') return ev.type === 'earnings';
        if (currentFilter === 'opex') return ev.type === 'opex' || ev.type === 'triple_witch' || ev.type === 'vix_expiry';
        if (currentFilter === 'rebalance') return ev.type === 'rebalance';
        if (currentFilter === 'short_interest') return ev.type === 'short_interest';
        if (currentFilter === 'holiday') return ev.type === 'holiday' || ev.type === 'early_close';
        return false;
      });

      // Day number label
      const dayNum = document.createElement('span');
      dayNum.className = 'day-number';
      dayNum.textContent = day;

      if (dateStr === todayStr) {
        cell.classList.add('today');
      }

      // Check special Nasdaq PDF highlights on dayNum or cell
      let hasSpecialHighlight = false;
      dayEvents.forEach(ev => {
        if (ev.type === 'holiday') {
          cell.classList.add('exchange-holiday');
          hasSpecialHighlight = true;
        } else if (ev.type === 'early_close') {
          cell.classList.add('early-close');
          hasSpecialHighlight = true;
        } else if (ev.type === 'opex') {
          cell.classList.add('opex-day');
          hasSpecialHighlight = true;
        } else if (ev.type === 'triple_witch') {
          cell.classList.add('triple-witch-day');
          hasSpecialHighlight = true;
        } else if (ev.type === 'vix_expiry') {
          cell.classList.add('vix-expiry-day');
          hasSpecialHighlight = true;
        }
      });

      cell.appendChild(dayNum);

      // Dot Indicators for day events (excluding holidays which cover the whole cell)
      const indicatorsContainer = document.createElement('div');
      indicatorsContainer.className = 'grid-cell-indicators';

      dayEvents.forEach(ev => {
        if (['holiday', 'early_close', 'opex', 'triple_witch', 'vix_expiry'].includes(ev.type)) return;

        const dot = document.createElement('span');
        dot.className = `indicator-dot dot-${ev.type}`;
        
        // Custom dot colors
        if (ev.type === 'fed' || ev.type === 'speech') dot.style.background = '#6C5CE7';
        else if (ev.type === 'economic') dot.style.background = '#10B981';
        else if (ev.type === 'earnings') dot.style.background = '#3B82F6';
        else if (ev.type === 'rebalance') dot.style.background = '#EC4899';
        else if (ev.type === 'short_interest') {
          // Render short interest as a tiny outline square instead of dot
          dot.className = 'indicator-square';
          dot.style.borderColor = '#EC4899';
        }
        
        indicatorsContainer.appendChild(dot);
      });

      cell.appendChild(indicatorsContainer);

      if (dayEvents.length > 0) {
        cell.classList.add('has-events');
        cell.onclick = () => {
          document.querySelectorAll('.grid-cell').forEach(c => c.classList.remove('selected'));
          cell.classList.add('selected');
          showDayEvents(dateStr, dayEvents);
        };
      } else {
        cell.onclick = () => {
          document.querySelectorAll('.grid-cell').forEach(c => c.classList.remove('selected'));
          cell.classList.add('selected');
          showDayEvents(dateStr, []);
        };
      }

      daysGrid.appendChild(cell);
    }

    container.appendChild(daysGrid);

    // Default: select today's cell if in the current month, otherwise don't select
    const todayCell = container.querySelector(`.grid-cell[data-date="${todayStr}"]`);
    if (todayCell) {
      todayCell.click();
    } else {
      // Click first cell with events
      const firstEventCell = container.querySelector('.grid-cell.has-events');
      if (firstEventCell) firstEventCell.click();
    }
  }

  // --- 2. RENDER CHRONOLOGICAL LIST VIEW ---
  function renderList() {
    const listEl = document.getElementById('calendar-list');
    listEl.innerHTML = '';

    const filtered = currentFilter === 'all' 
      ? allEvents 
      : allEvents.filter(ev => {
          if (currentFilter === 'economic') return ev.type === 'economic';
          if (currentFilter === 'fed') return ev.type === 'fed' || ev.type === 'speech';
          if (currentFilter === 'earnings') return ev.type === 'earnings';
          if (currentFilter === 'opex') return ev.type === 'opex' || ev.type === 'triple_witch' || ev.type === 'vix_expiry';
          if (currentFilter === 'rebalance') return ev.type === 'rebalance';
          if (currentFilter === 'short_interest') return ev.type === 'short_interest';
          if (currentFilter === 'holiday') return ev.type === 'holiday' || ev.type === 'early_close';
          return false;
        });

    if (filtered.length === 0) {
      listEl.innerHTML = `<div style="color:var(--text-muted); padding:20px;">No events found for this filter.</div>`;
      return;
    }

    const todayStr = new Date().toISOString().split('T')[0];
    let firstUpcomingEl = null;
    let currentMonth = '';
    
    filtered.forEach(ev => {
      const d = new Date(ev.date + 'T00:00:00');
      const monthStr = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      
      if (monthStr !== currentMonth) {
        currentMonth = monthStr;
        const monthHeader = document.createElement('h3');
        monthHeader.className = 'cal-month-header';
        monthHeader.textContent = monthStr;
        listEl.appendChild(monthHeader);
      }

      const conf = typeConfig[ev.type] || { label: 'Event', color: '#ccc', icon: '📅' };
      const item = document.createElement('div');
      
      const isPast = ev.date < todayStr;
      item.className = 'cal-item' + (isPast ? ' past-event' : '');
      if (!isPast && !firstUpcomingEl) {
        firstUpcomingEl = item;
      }

      item.onclick = () => {
        document.querySelectorAll('.cal-item').forEach(c => c.classList.remove('selected'));
        item.classList.add('selected');
        showDayEvents(ev.date, [ev]);
      };

      item.innerHTML = `
        <div class="cal-item-date">${formatDate(ev.date)}</div>
        <div class="cal-item-main">
          <div class="cal-item-title">${conf.icon} ${ev.title}</div>
          <div class="cal-item-badges">
            <span class="cal-badge" style="background:${conf.color}20; color:${conf.color}; border: 1px solid ${conf.color}40;">${conf.label}</span>
            ${ev.impact ? `<span class="cal-badge" style="background:${impactColors[ev.impact]}15; color:${impactColors[ev.impact]}; border: 1px solid ${impactColors[ev.impact]}30;">IMPACT: ${ev.impact.toUpperCase()}</span>` : ''}
          </div>
        </div>
      `;
      listEl.appendChild(item);
    });

    if (firstUpcomingEl) {
      setTimeout(() => {
        firstUpcomingEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 250);
    }
  }

  // --- 3. RENDER FOCUS THIS WEEK SIDEBAR ---
  function renderThisWeek() {
    const container = document.getElementById('calendar-this-week');
    container.innerHTML = '';
    
    const today = new Date();
    today.setHours(0,0,0,0);
    
    const next7Days = new Date(today);
    next7Days.setDate(today.getDate() + 7);

    let upcoming = allEvents.filter(ev => {
      const d = new Date(ev.date + 'T00:00:00');
      return d >= today && d <= next7Days && ['high', 'medium'].includes(ev.impact);
    });

    if (upcoming.length === 0) {
      upcoming = allEvents.filter(ev => {
        const d = new Date(ev.date + 'T00:00:00');
        return d >= today && ['high', 'medium'].includes(ev.impact);
      }).slice(0, 4);
    }
    
    if (upcoming.length === 0) {
      upcoming = allEvents.filter(ev => new Date(ev.date + 'T00:00:00') >= today).slice(0, 4);
    }

    upcoming.forEach(ev => {
      const conf = typeConfig[ev.type] || { label: 'Event', color: '#ccc', icon: '📅' };
      const el = document.createElement('div');
      el.className = 'cal-sidebar-item';
      el.onclick = () => {
        showDayEvents(ev.date, [ev]);
      };
      
      el.innerHTML = `
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 4px; display:flex; justify-content:space-between;">
          <span>${formatDate(ev.date)}</span>
          ${ev.impact ? `<span style="color:${impactColors[ev.impact]}; font-weight:700;">${ev.impact.toUpperCase()}</span>` : ''}
        </div>
        <div style="font-weight: 600; display:flex; align-items:center; gap:6px;">
          ${conf.icon} ${ev.title}
        </div>
      `;
      container.appendChild(el);
    });
  }

  // --- 4. SHOW DAY EVENTS STACK IN DETAILS PANEL ---
  function showDayEvents(dateStr, events) {
    const detailCard = document.getElementById('calendar-detail-card');
    detailCard.style.display = 'block';

    const headerTitle = document.getElementById('cal-detail-title');
    
    const formattedDate = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });
    headerTitle.textContent = formattedDate;
    
    const bodyContainer = detailCard.querySelector('.cal-detail-body');
    bodyContainer.innerHTML = '';

    if (events.length === 0) {
      bodyContainer.innerHTML = `
        <div style="text-align:center; padding: 24px; color:var(--text-muted);">
          <div style="font-size: 1.5rem; margin-bottom: 8px;">💤</div>
          No scheduled market events for this date.
        </div>
      `;
      return;
    }

    events.forEach((ev, idx) => {
      const conf = typeConfig[ev.type] || { label: 'Event', color: '#ccc', icon: '📅' };
      const eventBlock = document.createElement('div');
      eventBlock.className = 'event-detail-block';
      eventBlock.style.borderLeft = `4px solid ${conf.color}`;
      eventBlock.style.paddingLeft = '12px';
      eventBlock.style.marginBottom = idx < events.length - 1 ? '20px' : '0';
      eventBlock.style.paddingBottom = idx < events.length - 1 ? '16px' : '0';
      if (idx < events.length - 1) {
        eventBlock.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
      }

      eventBlock.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
          <h3 style="margin:0; font-size:1.05rem; font-weight:600; color:var(--text-primary);">${conf.icon} ${ev.title}</h3>
          <span class="cal-badge" style="background:${conf.color}20; color:${conf.color}; border: 1px solid ${conf.color}40;">${conf.label}</span>
        </div>
        <div class="cal-detail-row" style="margin-bottom: 8px;">
          <span class="cal-detail-label">Time:</span>
          <span class="cal-detail-value">${ev.time || 'N/A'}</span>
        </div>
        ${ev.impact ? `
        <div class="cal-detail-row" style="margin-bottom: 8px;">
          <span class="cal-detail-label">Impact Level:</span>
          <span class="cal-detail-value" style="color:${impactColors[ev.impact]}">${ev.impact.toUpperCase()}</span>
        </div>` : ''}
        
        <div class="cal-detail-section" style="margin-top: 10px;">
          <h4 style="margin: 0 0 4px; font-size: 0.72rem; text-transform: uppercase; color: var(--text-muted); letter-spacing:0.05em;">Consensus / Target</h4>
          <p style="margin: 0; font-size: 0.9rem; font-weight: 500;">${ev.consensus || 'N/A'}</p>
          ${ev.expected_outcomes ? `<p style="margin: 4px 0 0; font-size:0.85rem; color:var(--text-muted); line-height: 1.4;">${ev.expected_outcomes}</p>` : ''}
        </div>

        ${ev.effect_of_deviation ? `
        <div class="cal-detail-section" style="margin-top: 10px;">
          <h4 style="margin: 0 0 4px; font-size: 0.72rem; text-transform: uppercase; color: var(--text-muted); letter-spacing:0.05em;">Market Implication (Deviation Effect)</h4>
          <p style="margin: 0; padding: 10px; background: rgba(255,255,255,0.04); border-radius: 6px; font-size:0.85rem; line-height: 1.4; color: var(--text-secondary); border-left: 2px solid ${conf.color}40;">${ev.effect_of_deviation}</p>
        </div>` : ''}
      `;

      bodyContainer.appendChild(eventBlock);
    });

    detailCard.animate([
      { transform: 'scale(0.98)', opacity: 0.8 },
      { transform: 'scale(1)', opacity: 1 }
    ], { duration: 200, easing: 'ease-out' });
  }

  // --- 5. BIND CONTROLS AND LISTENERS ---
  function bindEvents() {
    const filterContainer = document.getElementById('calendar-filters');
    if (filterContainer) {
      filterContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('metric-chip')) {
          filterContainer.querySelectorAll('.metric-chip').forEach(c => c.classList.remove('selected'));
          e.target.classList.add('selected');
          currentFilter = e.target.dataset.filter;
          updateCalendarView();
        }
      });
    }

    const refreshBtn = document.getElementById('btn-cal-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        loadCalendarData();
      });
    }

    const viewGridBtn = document.getElementById('btn-view-grid');
    const viewListBtn = document.getElementById('btn-view-list');
    
    if (viewGridBtn && viewListBtn) {
      viewGridBtn.addEventListener('click', () => {
        viewGridBtn.classList.add('selected');
        viewListBtn.classList.remove('selected');
        currentView = 'grid';
        updateCalendarView();
      });
      
      viewListBtn.addEventListener('click', () => {
        viewListBtn.classList.add('selected');
        viewGridBtn.classList.remove('selected');
        currentView = 'list';
        updateCalendarView();
      });
    }

    const monthSelect = document.getElementById('calendar-month-select');
    const prevMonthBtn = document.getElementById('btn-cal-prev-month');
    const nextMonthBtn = document.getElementById('btn-cal-next-month');

    if (monthSelect) {
      monthSelect.addEventListener('change', (e) => {
        currentMonthIdx = parseInt(e.target.value);
        renderGrid();
      });
    }

    if (prevMonthBtn) {
      prevMonthBtn.addEventListener('click', () => {
        if (currentMonthIdx > 0) {
          currentMonthIdx--;
          if (monthSelect) monthSelect.value = currentMonthIdx;
          renderGrid();
        }
      });
    }

    if (nextMonthBtn) {
      nextMonthBtn.addEventListener('click', () => {
        if (currentMonthIdx < 11) {
          currentMonthIdx++;
          if (monthSelect) monthSelect.value = currentMonthIdx;
          renderGrid();
        }
      });
    }
  }

  bindEvents();

  window.MarketCalendar = {
    init: loadCalendarData
  };

})();
