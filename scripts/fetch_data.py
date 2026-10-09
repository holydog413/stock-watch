#!/usr/bin/env python3
"""Fetch low-priced, high-volatility US stock data from Yahoo Finance (server-side) and write data.json.
Stdlib only. Never invents data: failures are recorded in the 'errors' field."""
import json, sys, time, urllib.request, urllib.error
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

UA = "Mozilla/5.0"
HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]
SCREENS = ["day_gainers", "day_losers", "most_actives", "small_cap_gainers", "aggressive_small_caps"]
MIN_P, MAX_P, MIN_VOL = 0.5, 10.0, 1_000_000
MAX_DETAIL = 45
errors = []

def get(path):
    last = None
    for attempt in range(3):
        for h in HOSTS:
            try:
                req = urllib.request.Request(f"https://{h}{path}", headers={"User-Agent": UA, "Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=20) as r:
                    return json.loads(r.read().decode())
            except Exception as e:
                last = e
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"{path}: {last}")

def session_fraction(ts):
    """Fraction of the 9:30-16:00 ET session elapsed at quote time (min 0.1), used for pace-adjusted relative volume."""
    if not ts:
        return 1.0
    t = datetime.fromtimestamp(ts, ZoneInfo("America/New_York"))
    mins = (t.hour * 60 + t.minute) - 570
    if mins >= 390:
        return 1.0
    # approximate cumulative share of daily volume (U-shaped intraday profile: heavy open & close)
    prof = [(0, 0.0), (30, 0.12), (60, 0.20), (120, 0.33), (180, 0.43), (240, 0.52), (300, 0.62), (360, 0.78), (390, 1.0)]
    for (m0, f0), (m1, f1) in zip(prof, prof[1:]):
        if mins <= m1:
            return max(0.08, f0 + (f1 - f0) * max(0, mins - m0) / (m1 - m0))
    return 1.0

def main(out):
    quotes, sources = {}, {}
    for s in SCREENS:
        try:
            d = get(f"/v1/finance/screener/predefined/saved?scrIds={s}&count=250")
            for q in d["finance"]["result"][0]["quotes"]:
                sym = q.get("symbol")
                if not sym or q.get("quoteType") != "EQUITY" or q.get("market") != "us_market":
                    continue
                quotes[sym] = q
                sources.setdefault(sym, []).append(s)
        except Exception as e:
            errors.append(f"screener {s}: {e}")
    rows = []
    for sym, q in quotes.items():
        p, v = q.get("regularMarketPrice"), q.get("regularMarketVolume") or 0
        if p is None or not (MIN_P <= p <= MAX_P) or v < MIN_VOL:
            continue
        avg = q.get("averageDailyVolume3Month") or q.get("averageDailyVolume10Day") or 0
        rows.append({
            "symbol": sym, "name": q.get("shortName") or q.get("longName") or sym,
            "exchange": q.get("fullExchangeName"), "price": p,
            "change": q.get("regularMarketChange"), "changePct": q.get("regularMarketChangePercent"),
            "open": q.get("regularMarketOpen"), "high": q.get("regularMarketDayHigh"), "low": q.get("regularMarketDayLow"),
            "prevClose": q.get("regularMarketPreviousClose"), "volume": v, "avgVolume": avg,
            "relVolume": round(v / avg, 2) if avg else None,
            "relVolumePace": round(v / (avg * session_fraction(q.get("regularMarketTime"))), 2) if avg else None, "marketCap": q.get("marketCap"),
            "quoteTime": q.get("regularMarketTime"), "marketState": q.get("marketState"),
            "delayMin": q.get("exchangeDataDelayedBy"), "sources": sources[sym],
        })
    # pick detail candidates: biggest absolute movers weighted by relative volume
    rows.sort(key=lambda r: abs(r["changePct"] or 0) * (1 + min(r["relVolume"] or 0, 10)), reverse=True)
    charts = {}
    for r in rows[:MAX_DETAIL]:
        try:
            d = get(f"/v8/finance/chart/{r['symbol']}?range=5d&interval=5m&includePrePost=false")
            res = d["chart"]["result"][0]
            ts, qd = res.get("timestamp") or [], res["indicators"]["quote"][0]
            bars = []
            for i, t in enumerate(ts):
                o, h, l, c, v = (qd[k][i] for k in ("open", "high", "low", "close", "volume"))
                if None in (o, h, l, c):
                    continue
                bars.append([t, round(o, 4), round(h, 4), round(l, 4), round(c, 4), int(v or 0)])
            if bars:
                charts[r["symbol"]] = bars
            time.sleep(0.25)
        except Exception as e:
            errors.append(f"chart {r['symbol']}: {e}")
    if not rows and errors:
        print("No data fetched:", errors, file=sys.stderr)
    data = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "Yahoo Finance (unofficial public endpoints, fetched server-side by GitHub Actions)",
        "filters": {"minPrice": MIN_P, "maxPrice": MAX_P, "minVolume": MIN_VOL},
        "marketState": next((r["marketState"] for r in rows if r.get("marketState")), None),
        "stocks": rows, "charts": charts, "errors": errors,
    }
    with open(out, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"stocks={len(rows)} charts={len(charts)} errors={len(errors)}")
    return 0 if rows else 1

if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "data.json"))
