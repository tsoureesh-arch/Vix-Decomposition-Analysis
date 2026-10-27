#!/usr/bin/env python3
"""
Incremental updater for VIX decomposition data.
Fetches ALL missing days sequentially (to avoid CBOE rate-limiting),
enriches with Yahoo Finance AND Google News historical macro events.
"""

import json
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
import ssl
import sys
import time
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
import os

DATA_FILE = os.path.join(os.path.dirname(__file__), "data", "vix_decomposition_history.json")
ssl_ctx = ssl.create_default_context()

# ---- Utilities ----
def get_trading_days(start_date_str, end_date_str):
    start = datetime.strptime(start_date_str, "%Y-%m-%d")
    end = datetime.strptime(end_date_str, "%Y-%m-%d")
    days = []
    current = start
    while current <= end:
        if current.weekday() < 5:  # Mon-Fri
            days.append(current.strftime("%Y-%m-%d"))
        current += timedelta(days=1)
    return days

# ---- CBOE Fetching ----
def fetch_json(url):
    import urllib.error
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'Referer': 'https://www.cboe.com/tradable-products/vix/vix-decomposition/',
        'Accept': 'application/json',
    })
    
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=30, context=ssl_ctx) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            if e.code in (400, 404):
                # Permanent error for this date (e.g. data not yet released or holiday)
                return None
            if attempt == 4:
                print(f"  [!] Failed to fetch after 5 attempts: {e}")
                return None
            wait_time = 2 * (attempt + 1)
            print(f"  [*] Retry {attempt+1}/4 in {wait_time}s... ({e})")
            time.sleep(wait_time)
        except Exception as e:
            if attempt == 4:
                print(f"  [!] Failed to fetch after 5 attempts: {e}")
                return None
            wait_time = 2 * (attempt + 1)  # 2, 4, 6, 8 seconds
            print(f"  [*] Retry {attempt+1}/4 in {wait_time}s... ({e})")
            time.sleep(wait_time)

def classify_context(spx_pct, vix_pct, ss, ps, psk):
    if vix_pct < -8 and spx_pct > 0.5: return "Rally / Vol Crush"
    elif vix_pct > 15 and spx_pct < -1: return "Sharp Selloff / Vol Spike"
    elif vix_pct > 8 and spx_pct < -0.5: return "Selloff / Broad Vol Rise"
    elif vix_pct < -5 and spx_pct > 0.3: return "Relief Rally / Vol Crush"
    elif vix_pct < -10: return "Bounce / Vol Mean Reversion"
    elif abs(spx_pct) < 0.15 and abs(vix_pct) > 3: return "Flat SPX / Vol Bid"
    elif vix_pct > 3 and psk > 0.3: return "Selloff / Put Demand"
    elif vix_pct > 3 and ps > 0.5: return "Selloff / Skew Steepening"
    elif spx_pct < -0.3: return "Mild Pullback"
    elif spx_pct > 0.3: return "Mild Rally"
    elif abs(vix_pct) < 2: return "Quiet Day"
    else: return "Mixed"

def fetch_cboe_pair(from_date, to_date):
    decomp = fetch_json(f"https://www-api.cboe.com/vix_decomposition/?date1={from_date}&date2={to_date}")
    # Add a small delay between API calls to avoid rate-limiting
    time.sleep(1)
    closing = fetch_json(f"https://www-api.cboe.com/vix_decomposition/get_closing_data/?date1={from_date}&date2={to_date}")

    if not decomp or 'factors' not in decomp or not closing:
        return None

    spx_from = spx_to = vix_from = vix_to = None
    for item in closing:
        name, date, val = item[0], item[1], float(item[2])
        if name == "SPX" and date == from_date: spx_from = val
        elif name == "SPX" and date == to_date: spx_to = val
        elif name == "VIX" and date == from_date: vix_from = val
        elif name == "VIX" and date == to_date: vix_to = val

    if not all([spx_from, spx_to, vix_from, vix_to]):
        return None

    f = decomp['factors']
    spx_chg = round(spx_to - spx_from, 2)
    spx_pct = round((spx_chg / spx_from) * 100, 2)
    vix_chg = round(vix_to - vix_from, 2)
    vix_pct = round((vix_chg / vix_from) * 100, 2)

    ss = round(f.get('stickyStrike', 0) * 100, 2)
    ps = round(f.get('parallelShift', 0) * 100, 2)
    psk = round(f.get('putSkew', 0) * 100, 2)
    csk = round(f.get('callSkew', 0) * 100, 2)
    dc = round(f.get('downsideConvexity', 0) * 100, 2)
    uc = round(f.get('upsideConvexity', 0) * 100, 2)

    return {
        "date_from": from_date, "date_to": to_date,
        "spx_from": round(spx_from, 2), "spx_to": round(spx_to, 2),
        "spx_change_abs": spx_chg, "spx_change_pct": spx_pct,
        "vix_from": round(vix_from, 2), "vix_to": round(vix_to, 2),
        "vix_change_abs": vix_chg, "vix_change_pct": vix_pct,
        "sticky_strike": ss, "parallel_shift": ps,
        "put_skew": psk, "call_skew": csk,
        "downside_convexity": dc, "upside_convexity": uc,
        "total": round(ss + ps + psk + csk + dc + uc, 2),
        "market_context": classify_context(spx_pct, vix_pct, ss, ps, psk),
    }

# ---- YFinance Fetching ----
def get_yfinance_data(ticker, num_days=60):
    """Fetch Yahoo Finance data with a configurable lookback period."""
    req = urllib.request.Request(
        f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range={num_days}d",
        headers={'User-Agent': 'Mozilla/5.0'}
    )
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode())
            result = data['chart']['result'][0]
            timestamps, quote = result['timestamp'], result['indicators']['quote'][0]
            res_dict = {}
            for t, o, h, l, c in zip(timestamps, quote['open'], quote['high'], quote['low'], quote['close']):
                if c is not None:
                    res_dict[datetime.fromtimestamp(t).strftime('%Y-%m-%d')] = {
                        'open': o if o is not None else c,
                        'high': h if h is not None else c,
                        'low': l if l is not None else c,
                        'close': c
                    }
            return res_dict
    except Exception as e:
        print(f"  [!] Yahoo Finance error for {ticker}: {e}")
        return {}

def fetch_daily_news(date_str):
    """Fetches top 2 financial/macro headlines for a specific date from Google News RSS."""
    try:
        d = datetime.strptime(date_str, '%Y-%m-%d')
        after = (d - timedelta(days=1)).strftime('%Y-%m-%d')
        before = (d + timedelta(days=1)).strftime('%Y-%m-%d')
        
        query = f'"stock market" AND (CPI OR Fed OR earnings OR war OR inflation OR NFP OR rates) after:{after} before:{before}'
        encoded_query = urllib.parse.quote(query)
        url = f'https://news.google.com/rss/search?q={encoded_query}&hl=en-US&gl=US&ceid=US:en'
        
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            tree = ET.parse(resp)
            root = tree.getroot()
            items = root.findall('.//item')
            headlines = []
            for item in items:
                title = item.find('title').text
                if " - " in title: title = title.rsplit(" - ", 1)[0]
                if title not in headlines: headlines.append(title)
                if len(headlines) >= 2: break
            return headlines
    except Exception:
        return []

def generate_macro_synopsis(record, headlines):
    spx_pct, vix_pct = record['spx_change_pct'], record['vix_change_pct']
    spx_h, spx_l = record.get('spx_high', 0), record.get('spx_low', 0)
    
    factors = {
        'Sticky Strike': abs(record['sticky_strike']),
        'Parallel Shift': abs(record['parallel_shift']),
        'Put Skew': abs(record['put_skew']),
        'Call Skew': abs(record['call_skew']),
        'Downside Convexity': abs(record['downside_convexity']),
        'Upside Convexity': abs(record['upside_convexity'])
    }
    primary_driver = max(factors, key=factors.get)
    spx_dir = "rallied" if spx_pct > 0 else "declined"
    vix_dir = "increased" if vix_pct > 0 else "dropped"
    
    synopsis = (
        f"On {record['date_to']}, the S&P 500 {spx_dir} by {abs(spx_pct)}%, trading between a low of {spx_l:.2f} "
        f"and a high of {spx_h:.2f}. In response, the VIX {vix_dir} by {abs(vix_pct)}%. "
        f"The primary driver of the VIX movement on this day was '{primary_driver}', "
        f"which accounted for {factors[primary_driver]:.2f} points of implied volatility contribution.<br><br>"
    )
    
    ctx = record.get('market_context', '')
    if ctx == "Rally / Vol Crush": synopsis += "<strong>Market Regime:</strong> Classic risk-on environment where equity gains compressed implied volatility across the curve.<br>"
    elif ctx == "Sharp Selloff / Vol Spike": synopsis += "<strong>Market Regime:</strong> Significant risk-off macro regime with panicked downside protection bidding.<br>"
    elif vix_pct > 5 and spx_pct > -0.5: synopsis += "<strong>Market Regime:</strong> Volatility was bid despite relatively muted equity weakness, showing underlying market jitters.<br>"
    else: synopsis += "<strong>Market Regime:</strong> Realized typical equity-to-volatility inverse correlation dynamics.<br>"
        
    synopsis += "<br><strong>Notable Macro Events Displayed for the Day:</strong><br>"
    if headlines and len(headlines) > 0:
        for h in headlines: synopsis += f"* {h}<br>"
    else:
        synopsis += "* No major macro events reported; likely regular market movement.<br>"
        
    return synopsis

def process_enrichment(r, spx_data, vix_data, skew_data):
    dt = r['date_to']
    dt_from = r['date_from']
    if dt in spx_data: r['spx_high'], r['spx_low'] = round(spx_data[dt]['high'], 2), round(spx_data[dt]['low'], 2)
    if dt in vix_data: r['vix_high'], r['vix_low'] = round(vix_data[dt]['high'], 2), round(vix_data[dt]['low'], 2)
    
    if dt in skew_data:
        r['skew_open'] = round(skew_data[dt]['open'], 2)
        r['skew_high'] = round(skew_data[dt]['high'], 2)
        r['skew_low'] = round(skew_data[dt]['low'], 2)
        r['skew_close'] = round(skew_data[dt]['close'], 2)
        if dt_from in skew_data:
            skew_from = skew_data[dt_from]['close']
            skew_to = skew_data[dt]['close']
            r['skew_from'] = round(skew_from, 2)
            r['skew_to'] = round(skew_to, 2)
            r['skew_change_abs'] = round(skew_to - skew_from, 2)
            r['skew_change_pct'] = round((skew_to - skew_from) / skew_from * 100, 2) if skew_from > 0 else 0
        else:
            r['skew_from'] = r['skew_open']
            r['skew_to'] = r['skew_close']
            r['skew_change_abs'] = round(r['skew_close'] - r['skew_open'], 2)
            r['skew_change_pct'] = round((r['skew_close'] - r['skew_open']) / r['skew_open'] * 100, 2) if r['skew_open'] > 0 else 0

    headlines = fetch_daily_news(dt)
    r['macro_synopsis'] = generate_macro_synopsis(r, headlines)
    return r

def main():
    if not os.path.exists(DATA_FILE): return print(f"File not found: {DATA_FILE}")
        
    with open(DATA_FILE, 'r') as f: existing = json.load(f)
    if not existing: return
    
    # Deduplicate existing data by date_to (in case of prior partial writes)
    seen_dates = set()
    deduped = []
    for r in existing:
        if r['date_to'] not in seen_dates:
            seen_dates.add(r['date_to'])
            deduped.append(r)
    existing = deduped
        
    last_date = existing[-1]['date_to']
    today = datetime.now().strftime('%Y-%m-%d')
    days_to_check = get_trading_days(last_date, today)
    if not days_to_check or len(days_to_check) < 2: return print(f"Data is already up to date! Last date: {last_date}")
        
    print(f"Checking for missing data between {last_date} and {today} ({len(days_to_check)-1} potential trading days)...")
        
    last_success_date = existing[-1]['date_to']
    new_records = []
    
    print(f"Checking for missing data starting from {last_success_date}...")
    
    # Try each potential trading day as a 'to_date'
    # We skip the first element because it's our starting point (last_success_date)
    for i, target_date in enumerate(days_to_check[1:]):
        print(f"  [{i+1}/{len(days_to_check)-1}] Attempting to fetch up to {target_date} ...")
        try:
            # We use the LAST SUCCESSFUL date as the 'from' date for the next chunk
            res = fetch_cboe_pair(last_success_date, target_date)
            if res:
                new_records.append(res)
                print(f"    [OK] Success: {last_success_date} -> {target_date} ({res['market_context']})")
                last_success_date = target_date # Advance our cursor
            else:
                print(f"    [SKIP] No data for {target_date} (likely holiday or market closure)")
        except Exception as e:
            print(f"    [FAIL] Error for {target_date}: {e}")
        
        # Throttle
        time.sleep(1.2)
                
    if not new_records:
        print("No new data available from CBOE yet (likely weekend, holiday, or late update).")
        return
        
    new_records.sort(key=lambda r: r['date_to'])
    print(f"Fetched {len(new_records)} new records. Enriching...")
    
    # Calculate how many days of Yahoo data we need
    days_gap = (datetime.strptime(today, '%Y-%m-%d') - datetime.strptime(last_date, '%Y-%m-%d')).days
    yf_lookback = max(days_gap + 10, 30)  # At least 30 days, or gap + 10 buffer
    print(f"Fetching Yahoo Finance data with {yf_lookback}-day lookback...")
    
    spx_data = get_yfinance_data("%5EGSPC", yf_lookback)
    vix_data = get_yfinance_data("%5EVIX", yf_lookback)
    skew_data = get_yfinance_data("^SKEW", yf_lookback)
    
    print(f"  Yahoo data: SPX={len(spx_data)} days, VIX={len(vix_data)} days, SKEW={len(skew_data)} days")
    
    # Enrich sequentially (news fetching can be slow, no need to overwhelm Google)
    enriched_new = []
    for i, r in enumerate(new_records):
        print(f"  Enriching [{i+1}/{len(new_records)}] {r['date_to']}...")
        enriched = process_enrichment(r, spx_data, vix_data, skew_data)
        enriched_new.append(enriched)
    
    enriched_new.sort(key=lambda x: x['date_to'])
    existing.extend(enriched_new)
        
    print(f"Saving {len(existing)} total records ({len(enriched_new)} new). Success!")
    with open(DATA_FILE, 'w') as f: json.dump(existing, f, indent=2)

if __name__ == "__main__":
    main()
