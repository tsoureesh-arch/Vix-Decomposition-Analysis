/* Multi-session analogues use only observations available before the selected date. */
(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = (v, digits = 2) => Number.isFinite(v) ? v.toFixed(digits) : '—';
  const average = xs => xs.length ? xs.reduce((a,b) => a+b,0)/xs.length : NaN;
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const ordinal = value => {
    const rounded = Math.round(value);
    const mod100 = rounded % 100;
    const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : ({1:'st',2:'nd',3:'rd'}[rounded % 10] || 'th');
    return `${rounded}${suffix}`;
  };
  let liveHtml = '<p>Loading current cross-market context…</p>';
  async function liveContext() {
    try {
      const response = await fetch('/api/pulse/quotes');
      if (!response.ok) throw new Error('Current quotes unavailable');
      const payload = await response.json();
      const quotes = payload.quotes || [];
      const q = symbol => quotes.find(item => item.symbol === symbol && item.ok);
      const warnings = [];
      if (q('^VIX9D') && q('^VIX') && q('^VIX9D').price > q('^VIX').price) warnings.push('Short-term volatility exceeds VIX: near-term event premium is elevated.');
      if (q('^VIX3M') && q('^VIX') && q('^VIX').price > q('^VIX3M').price) warnings.push('VIX exceeds three-month volatility: inverted spot term structure signals stress.');
      if (q('^GSPC') && q('^VIX') && q('^GSPC').change_pct > 0 && q('^VIX').change_pct > 0) warnings.push('SPX and VIX are both higher: volatility is not confirming a simple risk-on interpretation.');
      for (const symbol of ['CL=F','JPY=X','^TNX']) {
        const quote = q(symbol);
        if (quote && Math.abs(quote.change_pct) >= 2) warnings.push(`${quote.name} moved ${fmt(quote.change_pct)}% versus its prior close; review this catalyst before relying on analogues.`);
      }
      const rows = ['^GSPC','^VIX','^VIX9D','^VIX3M','^VVIX','^TNX','CL=F','JPY=X','^KS11'].map(symbol => {
        const quote = q(symbol);
        return `<tr><td>${esc(quote?.name || symbol)}</td><td>${fmt(quote?.price)}</td><td>${fmt(quote?.change_pct)}%</td><td>${quote?.quote_time ? esc(new Date(quote.quote_time * 1000).toLocaleString()) : 'Unavailable'}</td></tr>`;
      }).join('');
      liveHtml = `<h3>Current cross-market check</h3><p>Retrieved ${esc(new Date(payload.asof).toLocaleString())}. Markets retain their last session when closed.</p><p>${warnings.length ? warnings.map(esc).join('<br>') : 'No configured divergence trigger is active; this does not establish a trading edge.'}</p><div class="table-container"><table><thead><tr><th>Market</th><th>Level</th><th>Change %</th><th>Quote time</th></tr></thead><tbody>${rows}</tbody></table></div><p>Review defined-risk hedges when short-term stress rises. Premium-selling candidates require actual implied-versus-realized volatility and event-risk checks; index analogues alone cannot establish attractive option prices.</p>`;
    } catch (error) {
      liveHtml = `<p>${esc(error.message)}. Current-context assessment is incomplete.</p>`;
    }
    const slot = document.querySelector('#strategy-live');
    if (slot) slot.innerHTML = liveHtml;
  }
  function features(data, i) {
    const r = data[i], prior = data[i-5];
    if (!prior || ![r.spx_to, prior.spx_to,r.vix_to,prior.vix_to].every(finite)) return null;
    return [r.vix_to, r.skew_to, r.spx_change_pct, r.vix_change_pct,
      (r.spx_to/prior.spx_to-1)*100, r.vix_to-prior.vix_to,
      ...['parallel_shift','put_skew','call_skew','downside_convexity'].map(k => average(data.slice(i-4,i+1).map(x=>x[k]).filter(finite)))];
  }
  function analyse(record, input) {
    const data = input.filter(r=>r.date_to<=record.date_to).slice().sort((a,b)=>a.date_to.localeCompare(b.date_to));
    const end=data.length-1, target=features(data,end);
    if (!target || !target.every(finite)) return {data, matches:[], target:null};
    const pool=[];
    // Leave all 20 forward sessions in the past; never use future outcomes to select matches.
    for(let i=5;i+20<end;i++) { const x=features(data,i); if(x?.every(finite)) pool.push({i,x}); }
    const scales=target.map((_,k)=>{const xs=pool.map(p=>p.x[k]),mean=average(xs);return Math.sqrt(average(xs.map(x=>(x-mean)**2)))||1;});
    pool.forEach(p=>p.distance=Math.sqrt(average(p.x.map((v,k)=>((v-target[k])/scales[k])**2))));
    pool.sort((a,b)=>a.distance-b.distance);
    const matches=[];
    for(const p of pool) {
      if(matches.every(m=>Math.abs(m.i-p.i)>20)) matches.push(p);
      if(matches.length===20) break;
    }
    return {data,matches,target,scales};
  }
  function panel(record, input) {
    const {data,matches,target}=analyse(record,input);
    if(!target || matches.length<3) return '<p>Not enough complete prior sessions for a reliable multi-session comparison.</p>';
    const prior=data.slice(0,-1), pct=k=>100*prior.filter(r=>finite(r[k])&&r[k]<=record[k]).length/Math.max(1,prior.filter(r=>finite(r[k])).length);
    const signals=['parallel_shift','put_skew','call_skew','downside_convexity'].filter(k=>finite(record[k])&&(pct(k)>=90||pct(k)<=10));
    const latest=input.reduce((a,b)=>a.date_to>b.date_to?a:b).date_to;
    let html=`<div class="analysis-text"><h3>Market setup · ${esc(record.date_to)}</h3><p>${record.date_to===latest?'Latest available closing setup':'Historical snapshot; live headlines are separate'} · VIX ${fmt(record.vix_to)} · five-session SPX ${fmt(target[4])}% · five-session VIX ${fmt(target[5])} points.</p><p>${signals.length?signals.map(k=>`${esc(k.replaceAll('_',' '))}: ${ordinal(pct(k))} historical percentile`).join(' · '):'No decomposition factor outside the prior-history 10th–90th percentile range.'}</p><p>These are factor contributions to VIX changes, not option prices. Attractiveness needs current implied-versus-realized volatility, term structure and executable spreads; it cannot be established from these factors alone.</p></div><div id="strategy-live" class="analysis-text">${liveHtml}</div>`;
    html+=`<h3>Similar five-session buildups</h3><p>Matched on VIX and SKEW levels, daily SPX/VIX moves, five-session SPX/VIX moves and five-session skew/surface contributions. Standardized distance; up to 20 nearest episodes spaced more than 20 sessions apart. ${matches.length} episodes available. Lower distance means closer.</p><div class="table-container"><table><thead><tr><th>Forward sessions</th><th>Episodes</th><th>SPX up</th><th>Mean return</th><th>Mean down move</th><th>Worst return</th><th>Mean VIX change</th></tr></thead><tbody>`;
    for(const horizon of [1,5,10,20]) {
      const outcomes=matches.map(m=>({r:(data[m.i+horizon].spx_to/data[m.i].spx_to-1)*100,v:data[m.i+horizon].vix_to-data[m.i].vix_to})).filter(x=>finite(x.r)&&finite(x.v));
      html+=`<tr><td>${horizon}</td><td>${outcomes.length}</td><td>${fmt(100*outcomes.filter(x=>x.r>0).length/outcomes.length,0)}%</td><td>${fmt(average(outcomes.map(x=>x.r)))}%</td><td>${fmt(average(outcomes.filter(x=>x.r<0).map(x=>x.r)))}%</td><td>${fmt(Math.min(...outcomes.map(x=>x.r)))}%</td><td>${fmt(average(outcomes.map(x=>x.v)))}</td></tr>`;
    }
    html+='</tbody></table></div><p>Exploratory historical outcomes, not a calibrated forecast or a trading backtest. Small samples, regime changes, transaction costs and selection choices matter. Do not infer option profitability from index returns.</p>';
    html+='<details><summary>Inspect matching dates and outcomes</summary><div class="table-container"><table><thead><tr><th>Episode</th><th>Distance</th><th>5-session SPX after</th><th>20-session SPX after</th></tr></thead><tbody>';
    matches.forEach(m=>html+=`<tr><td>${esc(data[m.i].date_to)}</td><td>${fmt(m.distance)}</td><td>${fmt((data[m.i+5].spx_to/data[m.i].spx_to-1)*100)}%</td><td>${fmt((data[m.i+20].spx_to/data[m.i].spx_to-1)*100)}%</td></tr>`);
    setTimeout(liveContext, 0);
    return html+'</tbody></table></div></details><div class="analysis-text"><h3>Decision checklist</h3><p>Unusual readings above flag what is off relative to prior history. Compare the analogue outcomes with the live Market Drivers and Research Brief before taking a directional view. Check VIX9D versus VIX, the term curve, Treasury yields, USD/JPY, oil and upcoming releases. A current catalyst can invalidate a historical comparison. No automatic high-conviction trade is assigned.</p></div>';
  }
  StrategyEngine.renderStrategyPanel=panel;
  window.MarketResearch={analyse};

  const tab=document.createElement('button'); tab.className='tab-btn';tab.dataset.tab='research';tab.innerHTML='<span class="tab-icon" aria-hidden="true"></span> Research Brief';
  document.querySelector('#tab-bar').append(tab);
  const section=document.createElement('div');section.className='tab-panel';section.dataset.tab='research';
  section.innerHTML='<section class="glass-card"><div class="section-header"><h2>Research Brief</h2><button class="btn" id="research-refresh">Refresh</button></div><p class="section-desc">S&P 500 catalysts, volatility, positioning, rates, currencies and global markets. Source-linked headlines are context, not verified causal explanations.</p><p id="research-state" aria-live="polite">Open this tab to load the latest feed.</p><select id="research-filter" aria-label="Research topic"><option>All</option><option>Volatility & positioning</option><option>Macro & rates</option><option>Equities & global</option></select><div id="research-items"></div><p>X live posts are not connected: authenticated API access is required. This feed uses public publisher RSS; source failures are shown.</p></section>';
  document.querySelector('#app-main').append(section);
  const categories=[['Volatility & positioning',/vix|volatil|option|skew|hedg|gamma|position|correlation/i],['Macro & rates',/fed|inflation|treasur|yield|rate|payroll|jobs|oil|dollar|yen|tariff|war/i]];
  let news=[],lastLoad=0,loading=false;
  function renderNews(){const filter=document.querySelector('#research-filter').value;document.querySelector('#research-items').innerHTML=news.filter(n=>filter==='All'||n.category===filter).map(n=>`<article class="analysis-text" style="margin-top:14px"><small>${esc(n.category)} · ${esc(n.source)} · ${esc(n.pubDate||'Publication time unavailable')}</small><h3><a href="${esc(/^https?:\/\//.test(n.link)?n.link:'#')}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a></h3></article>`).join('')||'<p>No items for this topic. Try refreshing or selecting All.</p>';}
  async function loadNews(){if(loading)return;loading=true;const status=document.querySelector('#research-state');status.textContent='Checking sources…';try{const response=await fetch('/api/pulse/news');if(!response.ok)throw new Error('News sources unavailable');const payload=await response.json();const relevant=/s&p|spx|stock|market|equity|nasdaq|dow|vix|volatil|option|skew|gamma|correlation|fed|inflation|treasur|yield|rate|payroll|jobs|oil|dollar|yen|tariff|earnings|nvidia|apple|microsoft|amazon|meta|google|alphabet|semiconductor|credit|bond|futures|economy|recession|trade|china|japan|korea|kospi/i;news=(payload.news||[]).filter(n=>relevant.test(n.title)).map(n=>({...n,category:categories.find(([,re])=>re.test(n.title))?.[0]||'Equities & global'}));lastLoad=Date.now();status.textContent=`Checked ${new Date(payload.asof).toLocaleString()} · ${news.length} market-relevant headlines${payload.failed_sources?.length?' · unavailable: '+payload.failed_sources.join(', '):''}`;renderNews();}catch(e){status.textContent=e.message;}finally{loading=false;}}
  tab.addEventListener('click',()=>{if(Date.now()-lastLoad>300000)loadNews();});
  document.querySelector('#research-refresh').addEventListener('click',loadNews);
  document.querySelector('#research-filter').addEventListener('change',renderNews);
  setInterval(()=>{if(section.classList.contains('active'))loadNews();},300000);

  const freshness=document.createElement('p');freshness.className='section-desc';freshness.setAttribute('aria-live','polite');document.querySelector('#date-nav').append(freshness);
  let observedSession=null;
  async function checkHistory(){try{const res=await fetch('/api/history/status',{cache:'no-store'});if(!res.ok)return;const state=await res.json();freshness.textContent=`Latest published session: ${state.latest_session} · ${state.running?'checking for new Cboe data…':state.error?'update failed; retrying automatically':state.last_success?'last checked '+new Date(state.last_success).toLocaleString():'automatic check pending'} · checks hourly while server is awake; cloud schedule preserves history.`;if(observedSession&&state.latest_session>observedSession){freshness.textContent+=' · New session available. Reload to display it.';if(document.querySelector('#date-select')?.selectedIndex===document.querySelector('#date-select')?.options.length-1)location.reload();}observedSession=state.latest_session;}catch(e){freshness.textContent='Unable to check data freshness. Displayed session date remains authoritative.';}}
  checkHistory();setInterval(checkHistory,60000);
})();
