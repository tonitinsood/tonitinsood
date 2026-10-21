#!/usr/bin/env python3
"""yfinance fallback metrics for idea-screener. Outputs JSON on stdout."""
from __future__ import annotations

import json
import sys


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"metrics_source": "partial"}))
        return
    ticker = sys.argv[1].upper()
    try:
        import yfinance as yf  # type: ignore
    except ImportError:
        print(json.dumps({"metrics_source": "partial", "error": "yfinance not installed"}))
        return

    t = yf.Ticker(ticker)
    info = {}
    try:
        info = t.info or {}
    except Exception:
        info = {}

    pe = info.get("trailingPE") or info.get("forwardPE")
    roic = info.get("returnOnEquity")  # proxy when ROIC unavailable
    ev = info.get("enterpriseValue")
    ebitda = info.get("ebitda")
    total_debt = info.get("totalDebt") or 0
    cash = info.get("totalCash") or 0
    net_debt_ebitda = None
    if ebitda and ebitda != 0:
        net_debt_ebitda = (float(total_debt) - float(cash)) / float(ebitda)

    ev_ebit = None
    try:
        fin = t.financials
        if fin is not None and not fin.empty and "EBIT" in fin.index:
            ebit = float(fin.loc["EBIT"].iloc[0])
            if ev and ebit:
                ev_ebit = float(ev) / ebit
    except Exception:
        pass

    partial = ev_ebit is None or pe is None
    out = {
        "pe": "" if pe is None else str(pe),
        "ev_ebit": "" if ev_ebit is None else str(ev_ebit),
        "roic": "" if roic is None else str(roic),
        "net_debt_ebitda": "" if net_debt_ebitda is None else str(net_debt_ebitda),
        "metrics_source": "partial" if partial else "yfinance",
    }
    print(json.dumps(out))


if __name__ == "__main__":
    main()
