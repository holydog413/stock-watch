"use strict";
const REFRESH_MS = 60_000;
let DATA = null, TAB = "gainers", SEL = null, RANGE = "1d", SORT = null;
let chart, rsiChart;
const $ = (s) => document.querySelector(s);
const ET = "America/New_York";

// ---------- formatting ----------
const fmtP = (v) => v == null ? "—" : "$" + (v < 1 ? v.toFixed(4) : v.toFixed(2));
const fmtPct = (v) => v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(2) + "%";
const fmtVol = (v) => v == null ? "—" : v >= 1e9 ? (v/1e9).toFixed(2)+"B" : v >= 1e6 ? (v/1e6).toFixed(1)+"M" : v >= 1e3 ? (v/1e3).toFixed(0)+"K" : String(v);
const fmtET = (d) => d.toLocaleString("en-US", { timeZone: ET, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET";
const cls = (v) => v > 0 ? "up" : v < 0 ? "down" : "";
function etParts(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: ET, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(d).map(x => [x.type, x.value]));
  return p;
}
function etOffsetSec(tSec) { // seconds to add to UTC to get ET wall-clock
  const p = etParts(new Date(tSec * 1000));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) / 1000;
  return asUTC - tSec;
}
const etDay = (tSec) => { const p = etParts(new Date(tSec * 1000)); return `${p.year}-${p.month}-${p.day}`; };

const rvOf = (s) => s.relVolumePace ?? s.relVolume;
// ---------- indicators ----------
function sma(vals, n) { const out = Array(vals.length).fill(null); let s = 0; for (let i = 0; i < vals.length; i++) { s += vals[i]; if (i >= n) s -= vals[i-n]; if (i >= n-1) out[i] = s / n; } return out; }
function rsi(vals, n = 14) {
  const out = Array(vals.length).fill(null); if (vals.length <= n) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = vals[i]-vals[i-1]; d > 0 ? g += d : l -= d; }
  g /= n; l /= n; out[n] = l === 0 ? 100 : 100 - 100/(1+g/l);
  for (let i = n+1; i < vals.length; i++) { const d = vals[i]-vals[i-1]; g = (g*(n-1) + Math.max(d,0))/n; l = (l*(n-1) + Math.max(-d,0))/n; out[i] = l === 0 ? 100 : 100 - 100/(1+g/l); }
  return out;
}
function vwap(bars) { // resets each ET session
  const out = []; let day = null, pv = 0, vv = 0;
  for (const b of bars) { const d = etDay(b[0]); if (d !== day) { day = d; pv = 0; vv = 0; } const tp = (b[2]+b[3]+b[4])/3; pv += tp*b[5]; vv += b[5]; out.push(vv ? pv/vv : null); }
  return out;
}
function analyze(stock) {
  const bars = DATA.charts[stock.symbol];
  const res = { score: 0, parts: [], signals: [], limited: !bars || bars.length < 25 };
  const chg = stock.changePct ?? 0, rv = rvOf(stock);
  const add = (pts, text, kind) => { res.score += pts; res.signals.push({ text, kind }); };
  if (chg >= 5) add(1, `Big move up today (${fmtPct(chg)})`, "pos");
  else if (chg <= -5) add(-1, `Big move down today (${fmtPct(chg)})`, "neg");
  if (rv != null && rv >= 2) {
    const dir = Math.sign(chg);
    if (Math.abs(chg) >= 5) add(dir, `Strong momentum + volume spike (${rv.toFixed(1)}× normal volume, ${dir > 0 ? "buyers" : "sellers"} in control)`, dir > 0 ? "pos" : "neg");
    else add(0, `Volume spike (${rv.toFixed(1)}× normal) without a big price move`, "warn");
  }
  if (!res.limited) {
    const c = bars.map(b => b[4]), last = c[c.length-1];
    const s9 = sma(c, 9), s20 = sma(c, 20), r = rsi(c, 14), vw = vwap(bars);
    Object.assign(res, { s9, s20, r, vw });
    const S9 = s9.at(-1), S20 = s20.at(-1), R = r.at(-1), VW = vw.at(-1);
    res.rsi = R; res.sma20 = S20; res.vwap = VW;
    if (S20 != null) last >= S20 ? add(1, `Above 20-period average (${fmtP(S20)}, 5-min bars)`, "pos") : add(-1, `Below 20-period average (${fmtP(S20)}, 5-min bars)`, "neg");
    if (S9 != null && S20 != null) S9 >= S20 ? add(1, "SMA 9 above SMA 20 — short-term uptrend", "pos") : add(-1, "SMA 9 below SMA 20 — short-term downtrend", "neg");
    if (VW != null) last >= VW ? add(1, `Trading above today's VWAP (${fmtP(VW)})`, "pos") : add(-1, `Trading below today's VWAP (${fmtP(VW)})`, "neg");
    if (R != null) {
      if (R > 70) add(-1, `Overbought (RSI ${R.toFixed(0)} > 70) — pullback risk`, "warn");
      else if (R < 30) add(1, `Oversold (RSI ${R.toFixed(0)} < 30) — bounce possible, but selling may continue`, "warn");
      else add(0, `RSI ${R.toFixed(0)} — neutral zone`, "");
    }
  } else res.signals.push({ text: "Intraday chart data not fetched for this ticker — score uses daily move and volume only", kind: "" });
  res.label = res.score >= 2 ? "Bullish" : res.score <= -2 ? "Bearish" : "Neutral";
  return res;
}
const badge = (a) => `<span class="badge ${a.label === "Bullish" ? "b-bull" : a.label === "Bearish" ? "b-bear" : "b-neu"}" title="Heuristic score ${a.score > 0 ? "+" : ""}${a.score}${a.limited ? " (limited data)" : ""}">${a.label} ${a.score > 0 ? "+" : ""}${a.score}${a.limited ? "*" : ""}</span>`;

// ---------- market status ----------
function marketStatus() {
  const fresh = DATA && (Date.now() - Date.parse(DATA.generatedAt)) < 25*60e3;
  const ms = fresh ? DATA.marketState : null;
  if (ms === "REGULAR") return ["Market open", "open"];
  if (ms === "PRE" || ms === "PREPRE") return ["Pre-market", "ext"];
  if (ms === "POST" || ms === "POSTPOST") return ["After-hours", "ext"];
  if (ms === "CLOSED") return ["Market closed", "closed"];
  const p = etParts(new Date()), m = (+p.hour % 24) * 60 + +p.minute;
  if (["Sat","Sun"].includes(p.weekday)) return ["Market closed (weekend)", "closed"];
  if (m >= 570 && m < 960) return ["Market open*", "open"];
  if (m >= 240 && m < 570) return ["Pre-market*", "ext"];
  if (m >= 960 && m < 1200) return ["After-hours*", "ext"];
  return ["Market closed", "closed"];
}
function renderStatus() {
  const [t, c] = marketStatus(); const el = $("#mkt"); el.textContent = t; el.className = "pill " + c;
  el.title = t.endsWith("*") ? "Estimated from the clock (holidays not detected)" : "From Yahoo Finance market state";
  if (DATA) {
    const g = new Date(DATA.generatedAt), age = Math.round((Date.now() - g) / 60000);
    $("#updated").textContent = `Last updated: ${fmtET(g)} (${age} min ago)`;
  }
}

// ---------- list ----------
function listFor(tab) {
  const s = DATA.stocks.slice();
  if (tab === "gainers") return s.filter(x => x.changePct > 0).sort((a,b) => b.changePct - a.changePct).slice(0, 40);
  if (tab === "losers") return s.filter(x => x.changePct < 0).sort((a,b) => a.changePct - b.changePct).slice(0, 40);
  return s.sort((a,b) => b.volume - a.volume).slice(0, 40);
}
const COLS = [["symbol","Ticker"],["price","Price"],["changePct","% Chg"],["volume","Volume",1],["relVolumePace","Rel Vol"],["score","Signal"]];
function renderTable() {
  if (!DATA) return;
  let rows = listFor(TAB).map(s => ({ s, a: analyze(s) }));
  if (SORT) { const [k, dir] = SORT; rows.sort((x, y) => { const vx = k === "score" ? x.a.score : x.s[k], vy = k === "score" ? y.a.score : y.s[k]; return (vx > vy ? 1 : vx < vy ? -1 : 0) * dir; }); }
  if (!rows.length) { $("#tablewrap").innerHTML = `<p class="muted pad">No stocks in this list match the filters right now (data unavailable or no qualifying movers).</p>`; return; }
  const head = COLS.map(([k, t, sm]) => `<th data-k="${k}" class="${sm ? "hide-sm" : ""}">${t}${SORT && SORT[0] === k ? (SORT[1] > 0 ? " ▲" : " ▼") : ""}</th>`).join("");
  const body = rows.map(({ s, a }) => `<tr data-s="${s.symbol}" class="${s.symbol === SEL ? "sel" : ""}">
    <td><span class="sym">${s.symbol}</span><span class="nm">${esc(s.name)}</span></td>
    <td>${fmtP(s.price)}</td><td class="${cls(s.changePct)}">${fmtPct(s.changePct)}</td>
    <td class="hide-sm">${fmtVol(s.volume)}</td>
    <td class="${rvOf(s) >= 2 ? "rv-hot" : ""}" title="Raw: ${s.relVolume ?? "—"}× full-day average">${rvOf(s) == null ? "—" : rvOf(s).toFixed(1) + "×"}</td>
    <td>${badge(a)}</td></tr>`).join("");
  $("#tablewrap").innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table><p class="muted" style="padding:6px 10px;font-size:11px">* limited data (no intraday bars) · Rel Vol = today's volume vs. the 3-month average expected by this time of day (pace-adjusted, approximate); ≥2× highlighted</p>`;
  $("#tablewrap").querySelectorAll("th").forEach(th => th.onclick = () => { const k = th.dataset.k; SORT = SORT && SORT[0] === k ? [k, -SORT[1]] : [k, k === "symbol" ? 1 : -1]; renderTable(); });
  $("#tablewrap").querySelectorAll("tbody tr").forEach(tr => tr.onclick = () => select(tr.dataset.s, true));
  if (!SEL && rows.length) select(rows[0].s.symbol, false);
}
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));

// ---------- detail ----------
function select(sym, scroll) {
  SEL = sym; document.querySelectorAll("tbody tr").forEach(tr => tr.classList.toggle("sel", tr.dataset.s === sym));
  renderDetail(); if (scroll && window.innerWidth < 860) $("#detail").scrollIntoView({ behavior: "smooth" });
}
function renderDetail() {
  const s = DATA && DATA.stocks.find(x => x.symbol === SEL);
  if (!s) { $("#detailBody").hidden = true; $("#detailEmpty").hidden = false; return; }
  $("#detailBody").hidden = false; $("#detailEmpty").hidden = true;
  const a = analyze(s);
  $("#dSym").textContent = s.symbol; $("#dName").textContent = `${s.name} · ${s.exchange || ""}`;
  $("#dPrice").innerHTML = `${fmtP(s.price)}<div class="${cls(s.changePct)}" style="font-size:14px">${s.change != null ? (s.change > 0 ? "+" : "") + s.change.toFixed(s.price < 1 ? 4 : 2) : ""} (${fmtPct(s.changePct)})</div>`;
  const pos = ((Math.max(-6, Math.min(6, a.score)) + 6) / 12) * 100;
  $("#dScore").innerHTML = `<div>Heuristic score: ${badge(a)} <span class="muted" style="font-size:12px">— a summary of current indicators, not a forecast</span></div><div class="scorebar"><i style="left:calc(${pos}% - 2px)"></i></div><div class="muted" style="display:flex;justify-content:space-between;font-size:11px"><span>Bearish −6</span><span>+6 Bullish</span></div>`;
  $("#dSignals").innerHTML = a.signals.map(x => `<li class="${x.kind}">${esc(x.text)}</li>`).join("");
  const st = [["Open", fmtP(s.open)], ["High", fmtP(s.high)], ["Low", fmtP(s.low)], ["Prev close", fmtP(s.prevClose)], ["Volume", fmtVol(s.volume)], ["Avg vol (3M)", fmtVol(s.avgVolume)], ["Rel vol (pace)", rvOf(s) != null ? rvOf(s).toFixed(2) + "×" : "—"], ["Market cap", s.marketCap ? "$" + fmtVol(s.marketCap) : "—"], ["RSI(14)", a.rsi != null ? a.rsi.toFixed(1) : "—"], ["Quote time", s.quoteTime ? fmtET(new Date(s.quoteTime * 1000)) : "—"]];
  $("#dStats").innerHTML = st.map(([k, v]) => `<div><b>${k}</b>${v}</div>`).join("");
  drawChart(s, a);
}
function ensureCharts() {
  if (chart || !window.LightweightCharts) return !!chart;
  const opts = { layout: { background: { color: "#161b22" }, textColor: "#8b949e" }, grid: { vertLines: { color: "#21262d" }, horzLines: { color: "#21262d" } }, timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#30363d" }, rightPriceScale: { borderColor: "#30363d" }, autoSize: true };
  chart = LightweightCharts.createChart($("#chart"), opts);
  chart.candles = chart.addCandlestickSeries({ upColor: "#26a641", downColor: "#f85149", borderVisible: false, wickUpColor: "#26a641", wickDownColor: "#f85149" });
  chart.s9 = chart.addLineSeries({ color: "#f5c542", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  chart.s20 = chart.addLineSeries({ color: "#4ea8ff", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  chart.vw = chart.addLineSeries({ color: "#c77dff", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
  rsiChart = LightweightCharts.createChart($("#rsiChart"), { ...opts, timeScale: { ...opts.timeScale, visible: false } });
  rsiChart.line = rsiChart.addLineSeries({ color: "#e6edf3", lineWidth: 1, priceLineVisible: false });
  [70, 30].forEach(v => rsiChart.line.createPriceLine({ price: v, color: v === 70 ? "#f85149" : "#26a641", lineStyle: 2, lineWidth: 1, axisLabelVisible: true, title: v === 70 ? "Overbought" : "Oversold" }));
  return true;
}
function drawChart(s, a) {
  const bars = DATA.charts[s.symbol];
  if (!bars || !bars.length) { $("#chart").innerHTML = `<p class="muted pad">Chart data unavailable for ${s.symbol}.</p>`; $("#rsiChart").innerHTML = ""; chart = rsiChart = null; return; }
  if (!ensureCharts()) { $("#chart").innerHTML = `<p class="err">Chart library failed to load.</p>`; return; }
  let start = 0;
  if (RANGE === "1d") { const d = etDay(bars.at(-1)[0]); start = bars.findIndex(b => etDay(b[0]) === d); }
  const T = (i) => bars[i][0] + etOffsetSec(bars[i][0]);
  const line = (arr) => { const o = []; for (let i = start; i < bars.length; i++) if (arr && arr[i] != null) o.push({ time: T(i), value: arr[i] }); return o; };
  const candles = []; for (let i = start; i < bars.length; i++) candles.push({ time: T(i), open: bars[i][1], high: bars[i][2], low: bars[i][3], close: bars[i][4] });
  chart.candles.setData(candles);
  chart.candles.applyOptions({ priceFormat: { type: "price", precision: s.price < 1 ? 4 : 2, minMove: s.price < 1 ? 0.0001 : 0.01 } });
  chart.s9.setData(line(a.s9)); chart.s20.setData(line(a.s20)); chart.vw.setData(line(a.vw)); rsiChart.line.setData(line(a.r));
  chart.timeScale().fitContent(); rsiChart.timeScale().fitContent();
}

// ---------- data loading ----------
async function load() {
  try {
    const r = await fetch("data.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    if (!d.stocks || !d.stocks.length) throw new Error("no stocks in data file");
    DATA = d; renderTable(); renderDetail();
  } catch (e) {
    if (!DATA) $("#tablewrap").innerHTML = `<p class="err">Data unavailable (${esc(e.message)}). The data job may not have run yet or the source failed. Retrying automatically…</p>`;
    console.error(e);
  }
  renderStatus();
}
document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => { document.querySelectorAll(".tabs button").forEach(x => x.classList.remove("active")); b.classList.add("active"); TAB = b.dataset.tab; SORT = null; renderTable(); });
document.querySelectorAll(".chartTabs button").forEach(b => b.onclick = () => { document.querySelectorAll(".chartTabs button").forEach(x => x.classList.remove("active")); b.classList.add("active"); RANGE = b.dataset.range; renderDetail(); });
$("#refresh").onclick = load;
load(); setInterval(load, REFRESH_MS); setInterval(renderStatus, 30_000);
