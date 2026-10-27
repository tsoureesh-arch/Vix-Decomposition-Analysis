#!/usr/bin/env python3
import http.server
import socketserver
import subprocess
import json
import os
import signal
import webbrowser
import threading
import time
import sys
import re
import urllib.request
import urllib.parse
import ssl
import math
from datetime import datetime, timezone, date, timedelta
import pandas as pd
import numpy as np
import requests
import hashlib
from bs4 import BeautifulSoup
import yfinance as yf

PORT = int(os.environ.get("PORT", 8888))
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

# ============================================================
#  MARKET PULSE - free-data helpers (no API key required)
# ============================================================
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}

from concurrent.futures import ThreadPoolExecutor

PULSE_SYMBOLS = [
    {"sym": "ES=F",      "name": "S&P 500 Futures (ES)", "group": "futures"},
    {"sym": "NQ=F",      "name": "Nasdaq 100 Futures",   "group": "futures"},
    {"sym": "YM=F",      "name": "Dow Futures",          "group": "futures"},
    {"sym": "RTY=F",     "name": "Russell 2000 Futures", "group": "futures"},
    {"sym": "^GSPC",     "name": "S&P 500 Index",        "group": "index"},
    {"sym": "^IXIC",     "name": "Nasdaq Composite",     "group": "index"},
    {"sym": "^DJI",      "name": "Dow Jones",            "group": "index"},
    {"sym": "^RUT",      "name": "Russell 2000",         "group": "index"},
    {"sym": "^VIX",      "name": "VIX (Spot Volatility)","group": "vol"},
    {"sym": "^VIX9D",    "name": "VIX 9-Day (Short-Term)","group": "vol"},
    {"sym": "^SKEW",     "name": "CBOE Skew Index",      "group": "vol"},
    {"sym": "^VVIX",     "name": "VVIX (Vol of Vol)",    "group": "vol"},
    {"sym": "2YY=F",     "name": "US 2Y Yield",          "group": "rates"},
    {"sym": "^TNX",      "name": "US 10Y Yield",         "group": "rates"},
    {"sym": "^TYX",      "name": "US 30Y Yield",         "group": "rates"},
    {"sym": "^IRX",      "name": "US 13W T-Bill",        "group": "rates"},
    {"sym": "DX-Y.NYB",  "name": "US Dollar Index (DXY)","group": "macro"},
    {"sym": "CL=F",      "name": "Crude Oil (WTI)",      "group": "macro"},
    {"sym": "GC=F",      "name": "Gold",                 "group": "macro"},
    {"sym": "SI=F",      "name": "Silver",               "group": "macro"},
    {"sym": "BTC-USD",   "name": "Bitcoin",              "group": "macro"},
    {"sym": "ETH-USD",   "name": "Ethereum",             "group": "macro"},
    {"sym": "^MOVE",     "name": "MOVE Bond Vol",        "group": "macro"},
    {"sym": "^KS11",     "name": "KOSPI Composite",      "group": "global"},
    {"sym": "^N225",     "name": "Nikkei 225",           "group": "global"},
    {"sym": "^GDAXI",    "name": "DAX Performance Index","group": "global"},
    {"sym": "^FTSE",     "name": "FTSE 100",             "group": "global"},
    {"sym": "^HSI",      "name": "Hang Seng Index",      "group": "global"},
    {"sym": "000001.SS", "name": "Shanghai Composite",   "group": "global"},
]

_quotes_cache = {"data": None, "ts": 0}
_rates_cache = {"data": None, "ts": 0}


def _http_get(url, timeout=12):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def _fetch_single_quote(item):
    sym = item["sym"]
    try:
        url = ("https://query1.finance.yahoo.com/v8/finance/chart/"
               + urllib.parse.quote(sym) + "?range=1d&interval=5m")
        raw = _http_get(url, timeout=8)
        data = json.loads(raw)
        res = data["chart"]["result"][0]
        meta = res.get("meta", {})
        price = meta.get("regularMarketPrice")
        prev = meta.get("chartPreviousClose") or meta.get("previousClose")
        change = chg_pct = None
        if price is not None and prev:
            change = price - prev
            chg_pct = (change / prev) * 100 if prev else None

        quote_ind = res.get("indicators", {}).get("quote", [{}])[0]
        closes = [c for c in quote_ind.get("close", []) if c is not None and c == c]
        highs = [h for h in quote_ind.get("high", []) if h is not None and h == h]
        lows = [l for l in quote_ind.get("low", []) if l is not None and l == l]
        
        day_high = max(highs) if highs else (meta.get("regularMarketDayHigh") or price)
        day_low = min(lows) if lows else (meta.get("regularMarketDayLow") or price)

        # Sample 16 points for inline mini sparklines
        sparkline = []
        if closes:
            step = max(1, len(closes) // 16)
            sparkline = [round(c, 4) for c in closes[::step]]
            if sparkline[-1] != round(closes[-1], 4):
                sparkline.append(round(closes[-1], 4))

        return {
            "symbol": sym, "name": item["name"], "group": item["group"],
            "price": price, "prev_close": prev,
            "day_high": day_high, "day_low": day_low,
            "change": change, "change_pct": chg_pct,
            "sparkline": sparkline,
            "currency": meta.get("currency", ""),
            "ok": price is not None,
        }
    except Exception as e:
        return {
            "symbol": sym, "name": item["name"], "group": item["group"],
            "ok": False, "error": str(e)
        }


def fetch_quotes():
    now = time.time()
    if _quotes_cache["data"] and (now - _quotes_cache["ts"] < 25):
        return _quotes_cache["data"]

    try:
        with ThreadPoolExecutor(max_workers=10) as executor:
            out = list(executor.map(_fetch_single_quote, PULSE_SYMBOLS))
        
        payload = {"asof": datetime.now(timezone.utc).isoformat(), "quotes": out}
        _quotes_cache["data"] = payload
        _quotes_cache["ts"] = now
        return payload
    except Exception as e:
        if _quotes_cache["data"]:
            return _quotes_cache["data"]
        return {"asof": datetime.now(timezone.utc).isoformat(), "quotes": [], "error": str(e)}


def fetch_rates():
    now = time.time()
    if _rates_cache["data"] and (now - _rates_cache["ts"] < 45):
        return _rates_cache["data"]

    rates_info = {
        "asof": datetime.now(timezone.utc).isoformat(),
        "target_from": 3.50,
        "target_to": 3.75,
        "effr": 3.63,
        "effr_date": None,
        "effr_volume": 114,
        "sofr": 3.65,
        "sofr_date": None,
        "sofr_volume": 2882,
        "ust3m": {"price": 3.74, "change": 0.0},
        "ust2y": {"price": 3.96, "change": 0.0},
        "ust5y": {"price": 4.51, "change": 0.0},
        "ust10y": {"price": 4.76, "change": 0.0},
        "ust30y": {"price": 5.24, "change": 0.0},
        "spread_10y_2y": {"bps": 80.0, "pct": 0.80, "status": "Normal / Steepening"},
        "spread_10y_3m": {"bps": 102.0, "pct": 1.02},
        "curve": []
    }

    # 1. Official New York Fed Reference Rates API
    try:
        ny_url = "https://markets.newyorkfed.org/api/rates/all/latest.json"
        raw_ny = _http_get(ny_url, timeout=6)
        ny_data = json.loads(raw_ny)
        ref = {r.get("type"): r for r in ny_data.get("refRates", []) if isinstance(r, dict)}
        
        effr = ref.get("EFFR", {})
        if effr:
            if effr.get("targetRateFrom") is not None:
                rates_info["target_from"] = effr.get("targetRateFrom")
            if effr.get("targetRateTo") is not None:
                rates_info["target_to"] = effr.get("targetRateTo")
            if effr.get("percentRate") is not None:
                rates_info["effr"] = effr.get("percentRate")
            rates_info["effr_date"] = effr.get("effectiveDate")
            rates_info["effr_volume"] = effr.get("volumeInBillions")
            rates_info["effr_p25"] = effr.get("percentPercentile25")
            rates_info["effr_p75"] = effr.get("percentPercentile75")

        sofr = ref.get("SOFR", {})
        if sofr:
            if sofr.get("percentRate") is not None:
                rates_info["sofr"] = sofr.get("percentRate")
            rates_info["sofr_date"] = sofr.get("effectiveDate")
            rates_info["sofr_volume"] = sofr.get("volumeInBillions")
    except Exception as e:
        print(f"[WARN] NY Fed API fetch error: {e}")

    # 2. Benchmark Treasuries from Yahoo Finance
    ts_map = {
        "ust3m": "^IRX",
        "ust2y": "2YY=F",
        "ust5y": "^FVX",
        "ust10y": "^TNX",
        "ust30y": "^TYX"
    }

    def fetch_ts(k_sym):
        k, sym = k_sym
        try:
            url = ("https://query1.finance.yahoo.com/v8/finance/chart/"
                   + urllib.parse.quote(sym) + "?range=1d&interval=5m")
            raw = _http_get(url, timeout=6)
            d = json.loads(raw)
            meta = d["chart"]["result"][0]["meta"]
            p = meta.get("regularMarketPrice")
            prev = meta.get("chartPreviousClose") or meta.get("previousClose")
            chg = (p - prev) if (p is not None and prev) else 0.0
            return k, {"price": round(p, 3) if p else None, "prev": round(prev, 3) if prev else None, "change": round(chg, 3)}
        except Exception as e:
            return k, {"price": None, "error": str(e)}

    try:
        with ThreadPoolExecutor(max_workers=5) as executor:
            ts_res = dict(executor.map(fetch_ts, ts_map.items()))
        for k, v in ts_res.items():
            if v.get("price") is not None:
                rates_info[k] = v
    except Exception as e:
        print(f"[WARN] Treasury yields fetch error: {e}")

    # 3. Calculate key yield curve spreads & status
    t10 = rates_info.get("ust10y", {}).get("price")
    t2 = rates_info.get("ust2y", {}).get("price")
    t3m = rates_info.get("ust3m", {}).get("price")
    t5 = rates_info.get("ust5y", {}).get("price")
    t30 = rates_info.get("ust30y", {}).get("price")

    if t10 is not None and t2 is not None:
        sp = round(t10 - t2, 3)
        status = "Inverted (Recession Signal)" if sp < -0.05 else ("Normal / Steepening" if sp > 0.40 else "Flat / Neutral")
        rates_info["spread_10y_2y"] = {"bps": round(sp * 100, 1), "pct": sp, "status": status}

    if t10 is not None and t3m is not None:
        sp3 = round(t10 - t3m, 3)
        rates_info["spread_10y_3m"] = {"bps": round(sp3 * 100, 1), "pct": sp3}

    # 4. Treasury Yield Curve points
    rates_info["curve"] = [
        {"tenor": "3M", "name": "3-Month T-Bill", "rate": t3m},
        {"tenor": "2Y", "name": "2-Year Treasury", "rate": t2},
        {"tenor": "5Y", "name": "5-Year Treasury", "rate": t5},
        {"tenor": "10Y", "name": "10-Year Treasury", "rate": t10},
        {"tenor": "30Y", "name": "30-Year Treasury", "rate": t30},
    ]

    # 5. Legacy backward compatibility structure
    rates_info["rates"] = {
        "fed_upper": {"value": rates_info["target_to"], "date": rates_info["effr_date"]},
        "fed_lower": {"value": rates_info["target_from"], "date": rates_info["effr_date"]},
        "effr": {"value": rates_info["effr"], "date": rates_info["effr_date"]},
        "sofr": {"value": rates_info["sofr"], "date": rates_info["sofr_date"]},
        "ust10y": {"value": t10},
        "ust2y": {"value": t2},
        "ust3m": {"value": t3m},
    }

    _rates_cache["data"] = rates_info
    _rates_cache["ts"] = now
    return rates_info


def _parse_rss(xml, source, limit=8):
    items = []
    for block in re.findall(r"<item[ >].*?</item>", xml, re.S | re.I):
        def pick(tag):
            m = re.search(r"<%s[^>]*>(.*?)</%s>" % (tag, tag), block, re.S | re.I)
            if not m:
                return ""
            val = m.group(1)
            cd = re.search(r"<!\[CDATA\[(.*?)\]\]>", val, re.S)
            if cd:
                val = cd.group(1)
            return re.sub(r"<[^>]+>", "", val).strip()
        title = pick("title")
        if title:
            items.append({"title": title, "link": pick("link"),
                          "pubDate": pick("pubDate"), "source": source})
        if len(items) >= limit:
            break
    return items


def fetch_news():
    feeds = [
        ("CNBC", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114"),
        ("Yahoo Finance", "https://finance.yahoo.com/news/rssindex"),
        ("MarketWatch", "http://feeds.marketwatch.com/marketwatch/topstories/"),
        ("CNBC Markets", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258"),
    ]
    all_items = []
    for name, url in feeds:
        try:
            all_items.extend(_parse_rss(_http_get(url), name, limit=6))
        except Exception:
            continue
    return {"asof": datetime.now(timezone.utc).isoformat(), "news": all_items[:24]}


def fetch_sentiment():
    out = {}
    for tkr in ("SPY", "QQQ"):
        try:
            url = "https://api.stocktwits.com/api/2/streams/symbol/%s.json" % tkr
            data = json.loads(_http_get(url))
            bull = bear = neutral = 0
            msgs = []
            for m in data.get("messages", [])[:30]:
                basic = (((m.get("entities") or {}).get("sentiment")) or {}).get("basic")
                if basic == "Bullish":
                    bull += 1
                elif basic == "Bearish":
                    bear += 1
                else:
                    neutral += 1
                if len(msgs) < 8:
                    msgs.append({"body": m.get("body", "")[:240],
                                 "user": (m.get("user") or {}).get("username", ""),
                                 "sentiment": basic})
            out[tkr] = {"bullish": bull, "bearish": bear, "neutral": neutral, "messages": msgs}
        except Exception as e:
            out[tkr] = {"error": str(e)}
    return {"asof": datetime.now(timezone.utc).isoformat(), "sentiment": out}


def fetch_historical_prices(symbol, range_str="1mo", interval="1d"):
    r_map = {
        "1d": ("1d", "5m"),
        "5d": ("5d", "15m"),
        "30d": ("1mo", "1d"),
        "1mo": ("1mo", "1d"),
        "1m": ("1mo", "1d"),
        "90d": ("3mo", "1d"),
        "3mo": ("3mo", "1d"),
        "3m": ("3mo", "1d"),
        "180d": ("6mo", "1d"),
        "6mo": ("6mo", "1d"),
        "6m": ("6mo", "1d"),
        "365d": ("1y", "1d"),
        "1y": ("1y", "1d"),
        "ytd": ("ytd", "1d"),
    }
    r_key = (range_str or "1mo").lower()
    default_range, default_interval = r_map.get(r_key, ("1mo", "1d"))
    actual_range = default_range
    actual_interval = interval if interval else default_interval

    try:
        url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}"
               f"?range={actual_range}&interval={actual_interval}")
        raw = _http_get(url, timeout=10)
        data = json.loads(raw)
        result = data["chart"]["result"][0]
        meta = result.get("meta", {})
        timestamps = result.get("timestamp", [])
        q = result.get("indicators", {}).get("quote", [{}])[0]
        closes = q.get("close", [])
        opens = q.get("open", [])
        highs = q.get("high", [])
        lows = q.get("low", [])
        volumes = q.get("volume", [])

        points = []
        history = []
        for i, ts in enumerate(timestamps):
            c = closes[i] if i < len(closes) else None
            if ts is not None and c is not None and not math.isnan(c):
                dt = datetime.fromtimestamp(ts, timezone.utc)
                o = opens[i] if (i < len(opens) and opens[i] is not None and not math.isnan(opens[i])) else c
                h = highs[i] if (i < len(highs) and highs[i] is not None and not math.isnan(highs[i])) else c
                l = lows[i] if (i < len(lows) and lows[i] is not None and not math.isnan(lows[i])) else c
                v = volumes[i] if (i < len(volumes) and volumes[i] is not None and not math.isnan(volumes[i])) else 0
                
                if actual_range in ("1d", "5d"):
                    time_label = dt.strftime("%H:%M")
                    full_label = dt.strftime("%b %d, %Y %H:%M UTC")
                else:
                    time_label = dt.strftime("%Y-%m-%d")
                    full_label = dt.strftime("%b %d, %Y")
                
                pt = {
                    "ts": ts,
                    "date": time_label,
                    "full_date": full_label,
                    "close": round(c, 4),
                    "open": round(o, 4),
                    "high": round(h, 4),
                    "low": round(l, 4),
                    "volume": int(v)
                }
                points.append(pt)
                history.append({"date": time_label, "value": round(c, 4)})

        stats = {}
        if points:
            first_val = points[0]["open"]
            last_val = points[-1]["close"]
            all_highs = [p["high"] for p in points]
            all_lows = [p["low"] for p in points]
            chg = last_val - first_val
            chg_pct = (chg / first_val * 100) if first_val else 0.0
            
            stats = {
                "period_open": first_val,
                "period_close": last_val,
                "period_high": max(all_highs),
                "period_low": min(all_lows),
                "change": round(chg, 4),
                "change_pct": round(chg_pct, 2),
                "currency": meta.get("currency", ""),
                "prev_close": meta.get("chartPreviousClose") or meta.get("previousClose"),
                "symbol": symbol
            }

        return {
            "symbol": symbol,
            "range": actual_range,
            "interval": actual_interval,
            "stats": stats,
            "points": points,
            "history": history
        }
    except Exception as e:
        return {"symbol": symbol, "error": str(e), "history": [], "points": [], "stats": {}}


# ─── VIX Central helpers ────────────────────────────────────────────────────
MONTH_NUMS = {'Jan':1,'Feb':2,'Mar':3,'Apr':4,'May':5,'Jun':6,
               'Jul':7,'Aug':8,'Sep':9,'Oct':10,'Nov':11,'Dec':12}

def _vix_expiration_date(month_int, year):
    """Calculate VIX futures expiration date.
    Uses authoritative CBOE dates for 2025-2027 (including holiday adjustments),
    with algorithmic fallback (30 days before 3rd Friday of next month) for other years."""
    # Hardcoded CBOE-verified VIX futures expiration dates
    _VIX_EXP_DATES = {
        2025: {1:'2025-01-22',2:'2025-02-19',3:'2025-03-18',4:'2025-04-16',
               5:'2025-05-21',6:'2025-06-18',7:'2025-07-16',8:'2025-08-20',
               9:'2025-09-17',10:'2025-10-22',11:'2025-11-19',12:'2025-12-17'},
        2026: {1:'2026-01-21',2:'2026-02-18',3:'2026-03-18',4:'2026-04-15',
               5:'2026-05-19',6:'2026-06-17',7:'2026-07-22',8:'2026-08-19',
               9:'2026-09-16',10:'2026-10-21',11:'2026-11-18',12:'2026-12-16'},
        2027: {1:'2027-01-20',2:'2027-02-17',3:'2027-03-17',4:'2027-04-14',
               5:'2027-05-19',6:'2027-06-16',7:'2027-07-21',8:'2027-08-18',
               9:'2027-09-15',10:'2027-10-20',11:'2027-11-17',12:'2027-12-15'},
    }
    lookup = _VIX_EXP_DATES.get(year, {}).get(month_int)
    if lookup:
        return date.fromisoformat(lookup)
    # Algorithmic fallback: 30 days before the 3rd Friday of the next month
    if month_int == 12:
        ny, nm = year + 1, 1
    else:
        ny, nm = year, month_int + 1
    first = date(ny, nm, 1)
    days_to_fri = (4 - first.weekday()) % 7
    third_friday = first + timedelta(days=days_to_fri + 14)
    return third_friday - timedelta(days=30)


def _compute_dte(month_name, ref_date=None):
    """Return days-to-expiration for a VIX futures month label."""
    if ref_date is None:
        ref_date = date.today()
    mo = MONTH_NUMS.get(month_name)
    if mo is None:
        return None
    yr = ref_date.year if mo >= ref_date.month else ref_date.year + 1
    exp = _vix_expiration_date(mo, yr)
    dte = (exp - ref_date).days
    # Handle Jan/Feb wrapping across year-end
    if dte < 0:
        exp = _vix_expiration_date(mo, yr + 1)
        dte = (exp - ref_date).days
    return max(0, dte)


def _normalize_live_payload(raw):
    """Convert raw VIX Central ajax_update array into a clean dict.
    raw[0]  = month names  e.g. ['Jul','Aug',...]
    raw[2]  = Last prices  (futures F1..F8)
    raw[3]  = Open prices
    raw[5]  = High prices
    raw[7]  = Low prices
    raw[8]  = VIX Index   (repeated constant)
    raw[9]  = VXV Index
    raw[10] = VXST Index
    raw[11] = VXMT Index
    raw[13] = VIXMO Index
    """
    if not isinstance(raw, list) or len(raw) < 9:
        raise ValueError('Unexpected VIX Central payload')
    months  = raw[0]
    last    = raw[2]
    opens   = raw[3]
    highs   = raw[5]
    lows    = raw[7]
    vix_val = raw[8][0] if isinstance(raw[8], list) and raw[8] else None
    vxv_val = raw[9][0] if isinstance(raw[9], list) and raw[9] else None
    vxst_val= raw[10][0] if len(raw) > 10 and isinstance(raw[10], list) and raw[10] else None
    vxmt_val= raw[11][0] if len(raw) > 11 and isinstance(raw[11], list) and raw[11] else None
    vixmo   = raw[13][0] if len(raw) > 13 and isinstance(raw[13], list) and raw[13] else None

    today = date.today()
    contracts = []
    for i, m in enumerate(months[:8]):
        price = last[i] if i < len(last) else None
        if price is None or price == 0:
            price = opens[i] if i < len(opens) and opens[i] else None
        if price is None:
            continue
        dte = _compute_dte(m, today)
        mo_num = MONTH_NUMS.get(m, 0)
        yr = today.year if mo_num >= today.month else today.year + 1
        exp = _vix_expiration_date(mo_num, yr)
        contracts.append({
            'idx': i + 1,
            'month': m,
            'year': yr,
            'exp_date': exp.strftime('%Y-%m-%d'),
            'dte': dte,
            'last': round(float(price), 4),
            'open': round(float(opens[i]), 4) if i < len(opens) and opens[i] else None,
            'high': round(float(highs[i]), 4) if i < len(highs) and highs[i] else None,
            'low':  round(float(lows[i]),  4) if i < len(lows)  and lows[i]  else None,
        })

    return {
        'vix':  round(float(vix_val),  4) if vix_val  else None,
        'vxv':  round(float(vxv_val),  4) if vxv_val  else None,
        'vxst': round(float(vxst_val), 4) if vxst_val else None,
        'vxmt': round(float(vxmt_val), 4) if vxmt_val else None,
        'vixmo':round(float(vixmo),    4) if vixmo    else None,
        'contracts': contracts,
        'as_of': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    }


def _normalize_historical_payload(raw, date_str):
    """Convert raw VIX Central ajax_historical array into a clean dict.
    raw[0]   = start_month (1-based: 1=Jan, 7=Jul, etc.)
    raw[1..] = F1, F2, ..., F8 futures prices (for start_month onwards)
    The sequence wraps around 12 months cyclically.
    """
    if isinstance(raw, str) or not isinstance(raw, list) or len(raw) < 2:
        raise ValueError(f'No data available for {date_str}')

    start_month = int(raw[0])   # 1-based month index
    futures_raw = raw[1:]        # all remaining elements are futures prices

    # Derive reference year from the requested date
    try:
        ref = date.fromisoformat(date_str)
    except Exception:
        ref = date.today()

    month_names_all = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

    # Build month labels per the VIX Central JS formula:
    # new_xaxis[i] = month_names[(i + start_month - 1) % 12]  for i in 0..len-1
    l = len(futures_raw)
    labels = [month_names_all[(i + start_month - 1) % 12] for i in range(l)]

    contracts = []
    for i, price in enumerate(futures_raw):
        if price is None or float(price) == 0:
            continue
        mname = labels[i]
        mo = MONTH_NUMS[mname]
        # Determine year: if the futures month comes before or after ref month
        yr = ref.year
        if mo < ref.month:
            yr = ref.year + 1
        # But if start_month > mo numerically, it wrapped into next year
        if i + start_month - 1 >= 12:
            yr = ref.year + 1
        exp = _vix_expiration_date(mo, yr)
        dte = (exp - ref).days
        contracts.append({
            'idx': i + 1,
            'month': mname,
            'year': yr,
            'exp_date': exp.strftime('%Y-%m-%d'),
            'dte': max(0, dte),
            'last': round(float(price), 4),
            'open': None, 'high': None, 'low': None,
        })

    # spot VIX is not in the historical payload - set to None
    return {
        'vix': None,
        'vxv': None, 'vxst': None, 'vxmt': None, 'vixmo': None,
        'contracts': contracts,
        'as_of': date_str,
    }


VIX_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': 'https://vixcentral.com/'
}


def fetch_vix_term_live():
    url = 'https://vixcentral.com/ajax_update'
    req = urllib.request.Request(url, headers=VIX_HEADERS)
    with urllib.request.urlopen(req, timeout=20) as r:
        raw = json.loads(r.read().decode('utf-8', 'ignore'))
    return _normalize_live_payload(raw)


def fetch_vix_term_historical(date_str):
    url = f'https://vixcentral.com/ajax_historical?n1={date_str}'
    req = urllib.request.Request(url, headers=VIX_HEADERS)
    with urllib.request.urlopen(req, timeout=20) as r:
        raw = json.loads(r.read().decode('utf-8', 'ignore'))
    return _normalize_historical_payload(raw, date_str)


# ============================================================
#  TOP 25 SPX STOCKS & ECONOMIC INDICATORS SCRAPERS
# ============================================================

TOP_25_SPX = {
    'NVDA':  'NVIDIA', 'AAPL':  'Apple', 'MSFT':  'Microsoft', 'AMZN':  'Amazon',
    'GOOGL': 'Alphabet', 'AVGO':  'Broadcom', 'TSLA':  'Tesla', 'META':  'Meta',
    'MU':    'Micron', 'LLY':   'Eli Lilly', 'BRK-B': 'Berkshire', 'WMT':   'Walmart',
    'JPM':   'JPMorgan', 'AMD':   'AMD', 'INTC':  'Intel', 'V':     'Visa',
    'JNJ':   'Johnson & Johnson', 'XOM':   'ExxonMobil', 'AMAT':  'Applied Materials',
    'LRCX':  'Lam Research', 'CAT':   'Caterpillar', 'CSCO':  'Cisco', 'ABBV':  'AbbVie',
    'MA':    'Mastercard', 'ORCL':  'Oracle'
}

ECON_INDICATORS = {
    'NFP': {
        'label': 'Non-Farm Payrolls', 'url': 'https://tradingeconomics.com/united-states/non-farm-payrolls',
        'unit': 'K', 'category': 'Labor', 'icon': '👷', 'lower_is_better': False
    },
    'CPI': {
        'label': 'CPI (YoY)', 'url': 'https://tradingeconomics.com/united-states/inflation-cpi',
        'unit': '%', 'category': 'Inflation', 'icon': '🔥', 'lower_is_better': True
    },
    'FOMC Rate': {
        'label': 'FOMC Rate Decision', 'url': 'https://tradingeconomics.com/united-states/interest-rate',
        'unit': '%', 'category': 'FOMC', 'icon': '🏦', 'lower_is_better': False
    },
    'Core PCE': {
        'label': 'Core PCE Inflation (MoM)', 'url': 'https://tradingeconomics.com/united-states/core-pce-price-index-mom',
        'unit': '%', 'category': 'Inflation', 'icon': '💳', 'lower_is_better': True
    },
    'ISM Manufacturing': {
        'label': 'ISM Manufacturing PMI', 'url': 'https://tradingeconomics.com/united-states/business-confidence',
        'unit': '', 'category': 'Activity', 'icon': '🔧', 'lower_is_better': False
    },
    'Unemployment': {
        'label': 'Unemployment Rate', 'url': 'https://tradingeconomics.com/united-states/unemployment-rate',
        'unit': '%', 'category': 'Labor', 'icon': '📊', 'lower_is_better': True
    },
    'Retail Sales': {
        'label': 'Retail Sales (MoM)', 'url': 'https://tradingeconomics.com/united-states/retail-sales',
        'unit': '%', 'category': 'Consumer', 'icon': '🛒', 'lower_is_better': False
    },
    'Jobless Claims': {
        'label': 'Initial Jobless Claims', 'url': 'https://tradingeconomics.com/united-states/jobless-claims',
        'unit': 'K', 'category': 'Labor', 'icon': '📉', 'lower_is_better': True
    },
    'Avg Hourly Earnings': {
        'label': 'Average Hourly Earnings (MoM)', 'url': 'https://tradingeconomics.com/united-states/average-hourly-earnings-mom',
        'unit': '%', 'category': 'Labor', 'icon': '💵', 'lower_is_better': False
    },
    'JOLTS': {
        'label': 'JOLTS Job Openings', 'url': 'https://tradingeconomics.com/united-states/job-offers',
        'unit': 'M', 'category': 'Labor', 'icon': '💼', 'lower_is_better': False
    },
    'ADP': {
        'label': 'ADP Employment Change', 'url': 'https://tradingeconomics.com/united-states/adp-employment-change',
        'unit': 'K', 'category': 'Labor', 'icon': '🏢', 'lower_is_better': False
    }
}

_stocks_cache = {}
_stocks_cache_lock = threading.Lock()
_stocks_refresh_lock = threading.Lock()

_econ_cache = {}
_econ_cache_lock = threading.Lock()
_econ_refresh_lock = threading.Lock()

def safe_float(val):
    try:
        if pd.isna(val) or (isinstance(val, float) and np.isnan(val)):
            return None
        return float(val)
    except Exception:
        return None

def fetch_stock_earnings(ticker):
    try:
        tk = yf.Ticker(ticker)
        result = {
            'ticker': ticker,
            'company': TOP_25_SPX.get(ticker, ticker),
            'market_cap': 0,
            'current': None,
            'prev_close': None,
            'pct_change': None,
            'high_52w': None,
            'low_52w': None,
            'quarters': [],
            'next_earnings': None,
        }

        try:
            fast = tk.fast_info
            result['market_cap'] = fast.get('marketCap', 0) if fast else 0
        except Exception:
            pass

        # Price data
        hist = tk.history(period='2y', interval='1d', auto_adjust=True, actions=False)
        hist_tz = None
        if not hist.empty:
            hist_tz = hist.copy()
            if hist_tz.index.tz is None:
                hist_tz.index = hist_tz.index.tz_localize('UTC')
            else:
                hist_tz.index = hist_tz.index.tz_convert('UTC')
            
            hist.index = hist.index.tz_localize(None).normalize()
            hist = hist[~hist.index.duplicated(keep='last')]
            close = hist['Close']
            result['current'] = safe_float(close.iloc[-1])
            result['prev_close'] = safe_float(close.iloc[-2]) if len(close) >= 2 else None
            if result['prev_close'] and result['prev_close'] != 0:
                result['pct_change'] = safe_float(
                    (close.iloc[-1] - close.iloc[-2]) / abs(close.iloc[-2]) * 100
                )
            result['high_52w'] = safe_float(hist['High'].tail(252).max())
            result['low_52w']  = safe_float(hist['Low'].tail(252).min())

        # Earnings history — last 5 quarters
        try:
            ed = tk.get_earnings_dates(limit=12)
            if ed is not None and not ed.empty:
                now_ts = pd.Timestamp.now(tz='UTC')
                if ed.index.tz is None:
                    ed.index = ed.index.tz_localize('UTC')
                else:
                    ed.index = ed.index.tz_convert('UTC')
                    
                past = ed[ed.index < now_ts].copy()
                past = past.sort_index(ascending=False)
                quarters = []
                for date_idx, row in past.head(5).iterrows():
                    eps_est = row.get('EPS Estimate') if 'EPS Estimate' in row else None
                    eps_act = row.get('Reported EPS') if 'Reported EPS' in row else None
                    surprise = row.get('Surprise(%)') if 'Surprise(%)' in row else None
                    
                    reaction = None
                    if hist_tz is not None and not hist_tz.empty:
                        future_hist = hist_tz[hist_tz.index > date_idx]
                        if len(future_hist) > 0:
                            post_day = future_hist.iloc[0]
                            post_idx_in_hist = hist_tz.index.get_loc(post_day.name)
                            if post_idx_in_hist > 0:
                                pre_day = hist_tz.iloc[post_idx_in_hist - 1]
                                if pre_day['Close'] != 0 and not pd.isna(pre_day['Close']):
                                    reaction = float((post_day['Close'] - pre_day['Close']) / pre_day['Close'] * 100)

                    try:
                        date_str = date_idx.strftime('%Y-%m-%d')
                    except Exception:
                        date_str = str(date_idx)[:10]
                    quarters.append({
                        'date': date_str,
                        'eps_estimate': safe_float(eps_est),
                        'eps_actual':   safe_float(eps_act),
                        'surprise_pct': safe_float(surprise),
                        'reaction': safe_float(reaction),
                    })
                result['quarters'] = quarters

                # Upcoming earnings: future dates
                future = ed[ed.index >= now_ts].copy()
                future = future.sort_index(ascending=True)
                if not future.empty:
                    next_dt = future.index[0]
                    try:
                        result['next_earnings'] = next_dt.strftime('%Y-%m-%d')
                    except Exception:
                        result['next_earnings'] = str(next_dt)[:10]
        except Exception:
            pass

        # Fallback 1
        if not result['quarters'] or all(q['eps_actual'] is None for q in result['quarters']):
            try:
                qe = tk.quarterly_earnings
                if qe is not None and not qe.empty:
                    quarters = []
                    for idx, row in qe.iloc[::-1].head(5).iterrows():
                        quarters.append({
                            'date': str(idx),
                            'eps_estimate': None,
                            'eps_actual': safe_float(row.get('Earnings')),
                            'surprise_pct': None,
                            'reaction': None,
                        })
                    result['quarters'] = quarters
            except Exception:
                pass

        # Fallback 2
        if not result['quarters'] or all(q['eps_actual'] is None for q in result['quarters']):
            try:
                inc = tk.quarterly_income_stmt
                if inc is not None and not inc.empty and 'Diluted EPS' in inc.index:
                    eps_row = inc.loc['Diluted EPS'].dropna()
                    quarters = []
                    for col in list(eps_row.index[:5]):
                        quarters.append({
                            'date': str(col)[:10],
                            'eps_estimate': None,
                            'eps_actual': safe_float(eps_row[col]),
                            'surprise_pct': None,
                            'reaction': None,
                        })
                    result['quarters'] = quarters
            except Exception:
                pass

        # Fallback upcoming
        if result['next_earnings'] is None:
            try:
                cal = tk.calendar
                if cal is not None:
                    if isinstance(cal, dict):
                        ed_val = cal.get('Earnings Date')
                        if ed_val:
                            if isinstance(ed_val, (list, tuple)) and len(ed_val) > 0:
                                result['next_earnings'] = str(ed_val[0])[:10]
                            else:
                                result['next_earnings'] = str(ed_val)[:10]
                    elif isinstance(cal, pd.DataFrame) and 'Earnings Date' in cal.index:
                        result['next_earnings'] = str(cal.loc['Earnings Date'].iloc[0])[:10]
            except Exception:
                pass

        return result
    except Exception as e:
        print(f"[ERROR] fetch_stock_earnings({ticker}): {e}")
        return {
            'ticker': ticker, 'company': TOP_25_SPX.get(ticker, ticker), 'market_cap': 0,
            'current': None, 'prev_close': None, 'pct_change': None,
            'high_52w': None, 'low_52w': None, 'quarters': [], 'next_earnings': None,
        }

def update_top_25_spx():
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'}
        r = requests.get('https://www.slickcharts.com/sp500', headers=headers, timeout=10)
        if r.status_code == 200:
            soup = BeautifulSoup(r.text, 'html.parser')
            tables = soup.find_all('table')
            if tables:
                rows = tables[0].find_all('tr')[1:26]
                new_top = {}
                for row in rows:
                    cols = row.find_all('td')
                    if len(cols) >= 3:
                        name = cols[1].text.strip()
                        ticker = cols[2].text.strip().replace('.', '-')
                        new_top[ticker] = name
                if len(new_top) == 25:
                    global TOP_25_SPX
                    TOP_25_SPX.clear()
                    TOP_25_SPX.update(new_top)
                    print("[VixTerm] Updated TOP_25_SPX weights.")
    except Exception as e:
        print(f"[WARN] Failed to fetch top 25 from Slickcharts: {e}")

def refresh_stock_data():
    if not _stocks_refresh_lock.acquire(blocking=False):
        return
    try:
        print("[VixTerm] Starting stock earnings data refresh...")
        update_top_25_spx()
        stocks = []
        for ticker in list(TOP_25_SPX.keys()):
            stocks.append(fetch_stock_earnings(ticker))
            time.sleep(0.5)
        stocks.sort(key=lambda x: x.get('market_cap', 0), reverse=True)
        payload = {
            'stocks': stocks,
            'last_updated': datetime.now().isoformat(),
        }
        with _stocks_cache_lock:
            _stocks_cache['data'] = payload
        print("[VixTerm] Stock earnings refresh complete.")
    finally:
        _stocks_refresh_lock.release()

def fetch_econ_indicator(key, cfg):
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
    }
    try:
        r = requests.get(cfg['url'], headers=headers, timeout=8)
        soup = BeautifulSoup(r.text, 'lxml')
        table = soup.find('table')
        if not table:
            return None
        rows = table.find_all('tr')
        releases = []
        for row in rows:
            cols = [c.text.strip() for c in row.find_all('td')]
            if len(cols) < 7:
                continue
            date_str = cols[0]
            if not (len(date_str) >= 8 and date_str[:4].isdigit()):
                continue
            if key == 'FOMC Rate' and 'Fed Interest Rate Decision' not in (cols[2] if len(cols) > 2 else ''):
                continue
            actual   = cols[4]
            forecast = cols[5]
            previous = cols[6]
            period   = cols[3]

            def clean(v):
                v = v.strip().replace('%','').replace('K','').replace('M','').replace('B','').strip()
                try: return float(v)
                except: return None

            act_v = clean(actual)
            fct_v = clean(forecast)
            lib   = cfg.get('lower_is_better', False)
            beat  = None
            if act_v is not None and fct_v is not None:
                if lib:
                    beat = act_v <= fct_v
                else:
                    beat = act_v >= fct_v

            releases.append({
                'date':      date_str,
                'period':    period,
                'actual':    actual if actual else None,
                'forecast':  forecast if forecast else None,
                'previous':  previous if previous else None,
                'actual_v':  act_v,
                'forecast_v': fct_v,
                'beat':      beat,
            })

        releases = sorted(releases, key=lambda x: x['date'], reverse=True)[:5]
        return {
            'key':      key,
            'label':    cfg['label'],
            'unit':     cfg['unit'],
            'category': cfg['category'],
            'icon':     cfg['icon'],
            'lower_is_better': cfg.get('lower_is_better', False),
            'releases': releases,
        }
    except Exception as e:
        print(f"[WARN] econ fetch {key}: {e}")
        return None

def refresh_econ_data():
    if not _econ_refresh_lock.acquire(blocking=False):
        return
    try:
        print("[VixTerm] Starting economic indicators refresh...")
        indicators = []
        for key, cfg in ECON_INDICATORS.items():
            result = fetch_econ_indicator(key, cfg)
            if result:
                indicators.append(result)
            time.sleep(0.8)
        payload = {
            'indicators': indicators,
            'last_updated': datetime.now().isoformat(),
        }
        with _econ_cache_lock:
            _econ_cache['data'] = payload
        print("[VixTerm] Economic indicators refresh complete.")
    finally:
        _econ_refresh_lock.release()

def get_stocks_data():
    with _stocks_cache_lock:
        return _stocks_cache.get('data', {'stocks': [], 'status': 'loading'})

def get_economics_data():
    with _econ_cache_lock:
        return _econ_cache.get('data', {'indicators': [], 'status': 'loading'})


PULSE_ROUTES = {
    "/api/pulse/quotes": fetch_quotes,
    "/api/pulse/rates": fetch_rates,
    "/api/pulse/news": fetch_news,
    "/api/pulse/sentiment": fetch_sentiment,
}


class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Never let the browser serve a stale cached page.
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

    def _send_json(self, payload, code=200):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header('Content-type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parts = self.path.split('?', 1)
        path = parts[0]
        query = parts[1] if len(parts) > 1 else ""

        if path == "/api/pulse/historical":
            params = urllib.parse.parse_qs(query)
            symbol = params.get("symbol", [""])[0]
            range_str = params.get("range", ["1mo"])[0]
            interval = params.get("interval", [""])[0]
            if not symbol:
                self._send_json({"error": "Missing symbol parameter"}, 400)
                return
            try:
                self._send_json(fetch_historical_prices(symbol, range_str, interval))
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
            return

        if path == "/api/vix_term/live":
            try:
                self._send_json(fetch_vix_term_live())
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
            return

        if path == "/api/vix_term/historical":
            params = urllib.parse.parse_qs(query)
            date_str = params.get("date", [""])[0]
            if not date_str:
                self._send_json({"error": "Missing date parameter"}, 400)
                return
            try:
                self._send_json(fetch_vix_term_historical(date_str))
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
            return

        if path == "/api/stocks":
            try:
                self._send_json(get_stocks_data())
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
            return

        if path == "/api/economics":
            try:
                self._send_json(get_economics_data())
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
            return

        handler = PULSE_ROUTES.get(path)
        if handler:
            try:
                self._send_json(handler())
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
            return
        return super().do_GET()

    def do_POST(self):
        if self.path == '/api/sync':
            try:
                subprocess.run([sys.executable, "update_data.py"], check=True, cwd=DIRECTORY)
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "success"}).encode())
            except subprocess.CalledProcessError as e:
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "error", "message": "Failed to sync"}).encode())
        else:
            self.send_error(404, "Endpoint not found")


def kill_port(port):
    try:
        if os.name == 'nt':
            output = subprocess.check_output(
                f'netstat -ano | findstr :{port}', shell=True, text=True
            )
            for line in output.strip().split('\n'):
                parts = line.strip().split()
                if parts and parts[-1].isdigit():
                    pid = int(parts[-1])
                    try:
                        subprocess.run(f'taskkill /PID {pid} /F', shell=True,
                                       check=True, capture_output=True)
                        print(f"Killed existing process on port {port} (PID: {pid})")
                    except subprocess.CalledProcessError:
                        pass
        else:
            output = subprocess.check_output(f"lsof -t -i:{port}", shell=True, text=True)
            for pid in output.strip().split('\n'):
                if pid:
                    os.kill(int(pid), signal.SIGKILL)
                    print(f"Killed existing process on port {port} (PID: {pid})")
    except subprocess.CalledProcessError:
        pass


def background_refresh_loops():
    # Warm up caches immediately in background thread so server starts instantly
    try:
        refresh_stock_data()
    except Exception as e:
        print(f"[WARN] Initial stock refresh failed: {e}")

    try:
        refresh_econ_data()
    except Exception as e:
        print(f"[WARN] Initial economic indicators refresh failed: {e}")

    # Polling loops
    last_stock_refresh = time.time()
    last_econ_refresh = time.time()
    while True:
        try:
            time.sleep(15)
            now = time.time()
            if now - last_stock_refresh > 300: # 5 mins
                refresh_stock_data()
                last_stock_refresh = now
            if now - last_econ_refresh > 3600: # 1 hour
                refresh_econ_data()
                last_econ_refresh = now
        except Exception as e:
            print(f"[ERROR] Background refresh loop failed: {e}")


def start_server():
    # A cloud service owns its assigned port.  Only clear an existing local
    # listener when running this dashboard directly on a desktop machine.
    cloud_hosted = any(os.environ.get(name) for name in ("RENDER", "KOYEB_APP_NAME", "RAILWAY_ENVIRONMENT"))
    if not cloud_hosted:
        kill_port(PORT)
    # Start background refresh threads
    threading.Thread(target=background_refresh_loops, daemon=True).start()

    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("", PORT), CustomHandler) as httpd:
        import socket
        hostname = socket.gethostname()
        local_ip = socket.gethostbyname(hostname)
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
            s.close()
        except Exception:
            pass

        print("VIX Analyzer Server is running!")
        print("")
        print(f"  Local:            http://localhost:{PORT}")
        print(f"  On Your Network:  http://{local_ip}:{PORT}")
        print("")
        print("Ready to serve files and handle data syncs!")

        if not cloud_hosted:
            def open_browser():
                time.sleep(1.5)
                webbrowser.open(f"http://localhost:{PORT}")

            threading.Thread(target=open_browser, daemon=True).start()

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server...")


if __name__ == '__main__':
    start_server()
