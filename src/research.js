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

  const tab=document.createElement('button'); tab.className='tab-btn';tab.dataset.tab='research';tab.innerHTML='<span class="tab-icon" aria-hidden="true"></span> Daily Intelligence';
  document.querySelector('#tab-bar').append(tab);
  const section=document.createElement('div');section.className='tab-panel';section.dataset.tab='research';
  section.innerHTML=`<style>
    .intel-hero{padding:22px;border-radius:22px;background:linear-gradient(135deg,rgba(72,129,255,.16),rgba(116,80,255,.08));border:1px solid rgba(126,155,255,.23)}
    .intel-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(260px,.75fr);gap:16px;margin:16px 0}
    .intel-panel{padding:18px;border-radius:18px;background:var(--card-bg,rgba(255,255,255,.04));border:1px solid var(--border-color,rgba(255,255,255,.08))}
    .intel-panel h3,.intel-hero h3{margin-top:0}.intel-kicker{font-size:.74rem;letter-spacing:.12em;text-transform:uppercase;opacity:.62}
    .intel-list{display:grid;gap:10px;margin:12px 0 0;padding:0;list-style:none}.intel-list li{display:flex;gap:10px;align-items:flex-start}
    .intel-dot{width:8px;height:8px;border-radius:50%;margin-top:.48rem;background:#7b91ff;flex:none}
    .intel-signals{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.intel-signal{padding:12px;border-radius:14px;background:rgba(126,145,255,.07)}
    .intel-signal strong{display:block;font-size:1.02rem}.intel-signal small{opacity:.65}
    .intel-catalysts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.intel-card{padding:16px;border-radius:18px;border:1px solid var(--border-color,rgba(255,255,255,.08));background:var(--card-bg,rgba(255,255,255,.035))}
    .intel-card h3{font-size:1rem;line-height:1.38;margin:8px 0}.intel-meta{display:flex;gap:7px;flex-wrap:wrap}.intel-pill{font-size:.7rem;padding:4px 8px;border-radius:999px;background:rgba(126,145,255,.1)}
    .intel-high{background:rgba(255,92,102,.13);color:#ff8a92}.intel-risk-on{color:#54d69b}.intel-risk-off{color:#ff8a92}.intel-mixed{color:#f1c86e}
    .intel-card p{font-size:.86rem;opacity:.75}.intel-card a,.intel-sources a{font-weight:650}.intel-source-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.intel-sources{padding:13px;border-radius:14px;background:rgba(126,145,255,.06)}
    .intel-xlinks{display:flex;gap:8px;flex-wrap:wrap}.intel-xlinks a{padding:8px 11px;border-radius:999px;border:1px solid var(--border-color,rgba(255,255,255,.12));font-size:.8rem}
    .intel-all-news{margin-top:16px}.intel-all-news summary{cursor:pointer;font-weight:700}.intel-news-row{padding:12px 0;border-bottom:1px solid var(--border-color,rgba(255,255,255,.08))}
    @media(max-width:880px){.intel-grid,.intel-catalysts{grid-template-columns:1fr}.intel-source-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:560px){.intel-source-grid,.intel-signals{grid-template-columns:1fr}.intel-hero,.intel-panel{padding:15px}}
  </style><section class="glass-card"><div class="section-header"><div><div class="intel-kicker">Personal market briefing</div><h2>Daily Intelligence</h2></div><button class="btn" id="research-refresh">Refresh</button></div><p class="section-desc">A one-page view of what matters for the S&amp;P 500 and volatility, built from live cross-market signals, official releases and trusted market publishers.</p><p id="research-state" aria-live="polite">Open this tab to build today’s briefing.</p><div id="intel-brief"><div class="intel-hero"><p>Waiting for current market and news data…</p></div></div></section>`;
  document.querySelector('#app-main').append(section);
  const categories=[['Volatility & positioning',/\b(vix|volatil|option|skew|hedg|gamma|position|correlation)\b/i],['Macro & rates',/\b(fed|fomc|inflation|cpi|pce|ppi|treasur|yield|rates?|payroll|jobs?|oil|dollar|yen|tariff|war|gdp)\b/i]];
  const relevant=/\b(s&p|spx|stocks?|markets?|equity|equities|nasdaq|dow|vix|volatil(?:ity)?|options?|skew|gamma|correlation|fed|fomc|inflation|cpi|pce|ppi|treasur(?:y|ies)|yields?|rates?|payrolls?|jobs?|oil|crude|dollar|yen|tariffs?|earnings|nvidia|apple|microsoft|amazon|meta|google|alphabet|semiconductors?|credit|bonds?|futures|economy|recession|trade|china|japan|korea|kospi|gdp)\b/i;
  const personalFinance=/\b(social security|retirement|widow|mortgage|credit card|student loan|medicare|estate planning|homebuyer|tax refund)\b/i;
  const officialSources=new Set(['Federal Reserve','Bureau of Economic Analysis','U.S. Energy Information Administration','Official economic releases search']);
  const sourceWeight=source=>officialSources.has(source)?10:/Reuters/.test(source)?9:/CNBC/.test(source)?7:/MarketWatch|Yahoo/.test(source)?6:4;
  const parseTime=value=>{const t=Date.parse(value||'');return Number.isFinite(t)?t:0;};
  const classify=item=>categories.find(([,re])=>re.test(item.title))?.[0]||'Equities & global';
  const direction=title=>{const off=(title.match(/\b(fall|falls|fell|selloff|plunge|drop|down|war|crisis|spike|hotter|hike|tariff|default|downgrade|scandal|weak)\b/ig)||[]).length;const on=(title.match(/\b(rally|rallies|rise|rises|gain|gains|cool|easing|cut|beat|rebound|strong|surge)\b/ig)||[]).length;return off>on?'Risk-off':on>off?'Risk-on':'Mixed';};
  const whyItMatters=item=>{const t=item.title;if(/\b(vix|volatil|option|skew|gamma)\b/i.test(t))return 'Directly affects volatility pricing, hedging demand or the shape of the VIX complex.';if(/\b(fed|fomc|inflation|cpi|pce|ppi|payroll|jobs|yield|treasur|rate)\b/i.test(t))return 'Can reprice the rate path, equity multiples and index-level volatility.';if(/\b(oil|crude|war|tariff|china|japan|korea|yen|dollar)\b/i.test(t))return 'A cross-asset or global catalyst that can change inflation, liquidity or risk appetite.';if(/\b(nvidia|apple|microsoft|amazon|meta|alphabet|semiconductor|earnings)\b/i.test(t))return 'Mega-cap concentration means this can materially influence the S&P 500 and Nasdaq.';return 'Potentially relevant to broad risk appetite or index leadership; confirm the details at the source.';};
  function score(item,asof){const ageHours=Math.max(0,(asof-parseTime(item.pubDate))/36e5);let s=sourceWeight(item.source)+(ageHours<=6?7:ageHours<=24?5:ageHours<=48?2:0);s+=(item.title.match(/\b(fed|fomc|cpi|pce|payroll|vix|spx|s&p|treasury|oil|nvidia|war|tariff)\b/ig)||[]).length*2;return s;}
  function quoteMap(payload){return Object.fromEntries((payload.quotes||[]).filter(q=>q.ok).map(q=>[q.symbol,q]));}
  const signalCard=(label,q,suffix='')=>`<div class="intel-signal"><small>${esc(label)}</small><strong>${q?`${fmt(q.price)}${suffix}`:'—'}</strong><span class="${q?.change_pct>0?'intel-risk-on':q?.change_pct<0?'intel-risk-off':'intel-mixed'}">${q?`${q.change_pct>0?'+':''}${fmt(q.change_pct)}%`:'Unavailable'}</span></div>`;
  function marketRead(quotes){const spx=quotes['^GSPC'],vix=quotes['^VIX'],v9=quotes['^VIX9D'],v3=quotes['^VIX3M'],ten=quotes['^TNX'],oil=quotes['CL=F'],yen=quotes['JPY=X'];const bullets=[];if(spx&&vix)bullets.push(`S&amp;P 500 is <strong>${spx.change_pct>=0?'up':'down'} ${fmt(Math.abs(spx.change_pct))}%</strong> while VIX is <strong>${vix.change_pct>=0?'up':'down'} ${fmt(Math.abs(vix.change_pct))}%</strong>. ${spx.change_pct>0&&vix.change_pct>0?'The positive SPX/VIX correlation is unusual and deserves caution.':spx.change_pct<0&&vix.change_pct>0?'The usual risk-off relationship is active.':'Volatility is confirming the equity move.'}`);if(v9&&vix&&v3)bullets.push(v9.price>vix.price?'<strong>Near-term event premium is elevated:</strong> VIX9D is above VIX.':vix.price>v3.price?'<strong>Spot stress is elevated:</strong> VIX is above VIX3M.':'The volatility curve is not inverted across VIX9D, VIX and VIX3M.');if(ten)bullets.push(`The US 10-year yield is ${fmt(ten.price)}% (${ten.change_pct>=0?'+':''}${fmt(ten.change_pct)}% versus prior close); ${Math.abs(ten.change_pct)>=1?'rates are an active cross-asset driver.':'the daily move is not currently extreme.'}`);if(oil&&yen)bullets.push(`WTI is ${oil.change_pct>=0?'up':'down'} ${fmt(Math.abs(oil.change_pct))}% and USD/JPY is ${yen.change_pct>=0?'up':'down'} ${fmt(Math.abs(yen.change_pct))}%; ${Math.max(Math.abs(oil.change_pct),Math.abs(yen.change_pct))>=2?'at least one is large enough to review as a catalyst.':'neither is beyond the configured 2% alert threshold.'}`);return bullets;}
  function sourceUrl(source){const urls={'Federal Reserve':'https://www.federalreserve.gov/newsevents.htm','Bureau of Economic Analysis':'https://www.bea.gov/news','U.S. Energy Information Administration':'https://www.eia.gov/todayinenergy/','Reuters markets search':'https://www.reuters.com/markets/','Official economic releases search':'https://www.bls.gov/bls/newsrels.htm','CNBC Markets':'https://www.cnbc.com/markets/','CNBC':'https://www.cnbc.com/markets/','MarketWatch':'https://www.marketwatch.com/markets','Yahoo Finance':'https://finance.yahoo.com/','Volatility news search':'https://news.google.com/search?q=VIX%20options%20volatility%20SPX','Global catalysts search':'https://news.google.com/search?q=SP500%20Treasury%20oil%20yen%20KOSPI'};return urls[source]||'https://news.google.com/';}
  function renderBrief(payload,quotesPayload,history){const asof=Date.parse(payload.asof)||Date.now();const items=(payload.news||[]).filter(n=>relevant.test(n.title)&&!personalFinance.test(n.title)).map(n=>({...n,category:classify(n),direction:direction(n.title),score:score(n,asof)})).sort((a,b)=>b.score-a.score||parseTime(b.pubDate)-parseTime(a.pubDate));const seen=new Set(),ranked=items.filter(n=>{const key=n.title.toLowerCase().replace(/[^a-z0-9 ]/g,'').split(/\s+/).filter(w=>w.length>4).slice(0,5).join(' ');if(seen.has(key))return false;seen.add(key);return true;});const top=ranked.slice(0,8),quotes=quoteMap(quotesPayload),bullets=marketRead(quotes);const themes=[...new Set(top.slice(0,5).map(x=>x.category))];const summary=bullets.map(b=>`<li><span class="intel-dot"></span><span>${b}</span></li>`).join('');const catalystCards=top.map((n,i)=>`<article class="intel-card"><div class="intel-meta"><span class="intel-pill ${i<3?'intel-high':''}">${i<3?'High':'Medium'} attention</span><span class="intel-pill ${n.direction==='Risk-on'?'intel-risk-on':n.direction==='Risk-off'?'intel-risk-off':'intel-mixed'}">${esc(n.direction)}</span><span class="intel-pill">${esc(n.category)}</span></div><h3>${esc(n.title)}</h3><p>${esc(whyItMatters(n))}</p><small>${esc(n.source)} · ${n.pubDate?esc(new Date(n.pubDate).toLocaleString()):'Time unavailable'}</small><br><a href="${esc(/^https?:\/\//.test(n.link)?n.link:'#')}" target="_blank" rel="noopener noreferrer">Read source ↗</a></article>`).join('');const sources=[...new Set(items.map(n=>n.source))].sort((a,b)=>sourceWeight(b)-sourceWeight(a)).slice(0,9).map(s=>`<div class="intel-sources"><small>${officialSources.has(s)?'Official source':'Market publisher'}</small><br><a href="${esc(sourceUrl(s))}" target="_blank" rel="noopener noreferrer">${esc(s)} ↗</a></div>`).join('');const all=ranked.slice(8,38).map(n=>`<div class="intel-news-row"><small>${esc(n.category)} · ${esc(n.source)} · ${n.pubDate?esc(new Date(n.pubDate).toLocaleString()):'Time unavailable'}</small><br><a href="${esc(/^https?:\/\//.test(n.link)?n.link:'#')}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a></div>`).join('');document.querySelector('#intel-brief').innerHTML=`<div class="intel-hero"><div class="intel-kicker">Today’s read · ${esc(new Date(quotesPayload.asof||payload.asof).toLocaleString())}</div><h3>${themes.length?`Focus: ${themes.join(' · ')}`:'No dominant headline theme detected'}</h3><ul class="intel-list">${summary}</ul><p><strong>Interpretation:</strong> This is a rules-based synthesis of prices and source headlines. Open the linked report before treating a headline as confirmed causality.</p></div><div class="intel-grid"><article class="intel-panel"><h3>Live cross-market signals</h3><div class="intel-signals">${signalCard('S&P 500',quotes['^GSPC'])}${signalCard('VIX',quotes['^VIX'])}${signalCard('VIX 9-Day',quotes['^VIX9D'])}${signalCard('VIX 3-Month',quotes['^VIX3M'])}${signalCard('US 10Y',quotes['^TNX'],'%')}${signalCard('WTI crude',quotes['CL=F'])}</div></article><aside class="intel-panel"><h3>What to watch next</h3><ul class="intel-list"><li><span class="intel-dot"></span><span>Confirm the top three catalysts at their original sources.</span></li><li><span class="intel-dot"></span><span>Check whether VIX9D, VIX and VIX3M are becoming more inverted.</span></li><li><span class="intel-dot"></span><span>Compare today’s live setup with the ${esc(history.latest_session||'latest')} completed decomposition session.</span></li></ul></aside></div><div class="section-header"><h2>Ranked catalysts</h2><span>${top.length} selected from ${items.length}</span></div><div class="intel-catalysts">${catalystCards||'<p>No sufficiently relevant catalysts found.</p>'}</div><div class="intel-panel" style="margin-top:16px"><h3>Trusted source desk</h3><div class="intel-source-grid">${sources}</div></div><div class="intel-panel" style="margin-top:16px"><h3>X watch links</h3><p>These links open official or established accounts. X posts are not automatically summarized because reliable ingestion requires authenticated API access; the briefing above uses independently accessible sources.</p><div class="intel-xlinks"><a href="https://x.com/federalreserve" target="_blank" rel="noopener noreferrer">Federal Reserve</a><a href="https://x.com/BLS_gov" target="_blank" rel="noopener noreferrer">BLS</a><a href="https://x.com/BEA_News" target="_blank" rel="noopener noreferrer">BEA</a><a href="https://x.com/EIAgov" target="_blank" rel="noopener noreferrer">EIA</a><a href="https://x.com/CBOE" target="_blank" rel="noopener noreferrer">Cboe</a><a href="https://x.com/Reuters" target="_blank" rel="noopener noreferrer">Reuters</a><a href="https://x.com/search?q=SPX%20VIX%20options&src=typed_query&f=live" target="_blank" rel="noopener noreferrer">Live SPX/VIX search</a></div></div><details class="intel-panel intel-all-news"><summary>More relevant headlines (${Math.max(0,ranked.length-8)})</summary>${all||'<p>No additional headlines.</p>'}</details>`;return {count:items.length,top:top.length};}
  let lastLoad=0,loading=false;
  async function loadNews(){if(loading)return;loading=true;const status=document.querySelector('#research-state');status.textContent='Building today’s briefing from trusted sources…';try{const responses=await Promise.all([fetch('/api/pulse/news'),fetch('/api/pulse/quotes'),fetch('/api/history/status',{cache:'no-store'})]);if(responses.some(r=>!r.ok))throw new Error('One or more briefing sources are unavailable');const [payload,quotes,history]=await Promise.all(responses.map(r=>r.json()));const rendered=renderBrief(payload,quotes,history);lastLoad=Date.now();status.textContent=`Updated ${new Date(payload.asof).toLocaleString()} · ${rendered.top} priority catalysts from ${rendered.count} relevant items${payload.failed_sources?.length?' · unavailable: '+payload.failed_sources.join(', '):''}`;}catch(e){status.textContent=`${e.message}. The previous briefing remains visible.`;}finally{loading=false;}}
  tab.addEventListener('click',()=>{if(Date.now()-lastLoad>300000)loadNews();});
  document.querySelector('#research-refresh').addEventListener('click',loadNews);
  setInterval(()=>{if(section.classList.contains('active'))loadNews();},300000);

  const freshness=document.createElement('p');freshness.className='section-desc';freshness.setAttribute('aria-live','polite');document.querySelector('#date-nav').append(freshness);
  let observedSession=null;
  async function checkHistory(){try{const res=await fetch('/api/history/status',{cache:'no-store'});if(!res.ok)return;const state=await res.json();freshness.textContent=`Latest published session: ${state.latest_session} · ${state.running?'checking for new Cboe data…':state.error?'update failed; retrying automatically':state.last_success?'last checked '+new Date(state.last_success).toLocaleString():'automatic check pending'} · checks hourly while server is awake; cloud schedule preserves history.`;if(observedSession&&state.latest_session>observedSession){freshness.textContent+=' · New session available. Reload to display it.';if(document.querySelector('#date-select')?.selectedIndex===document.querySelector('#date-select')?.options.length-1)location.reload();}observedSession=state.latest_session;}catch(e){freshness.textContent='Unable to check data freshness. Displayed session date remains authoritative.';}}
  checkHistory();setInterval(checkHistory,60000);
})();
