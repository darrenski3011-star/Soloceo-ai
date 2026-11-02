# MicroProfit Engine (research prototype)

A simulation-first toolkit for evaluating tiny financial inefficiencies. This prototype does **not** connect to financial accounts, move funds, intercept payments, or claim balances.

## What it tests
- Rounding and settlement reconciliation using synthetic ledger entries.
- Cross-market price differences after fees, slippage, and a safety buffer.
- Repeated small opportunities and aggregate net outcomes.

## Run
Requires Python 3.10+; no third-party packages are needed.

```bash
python microprofit-engine/simulator.py
```

## Safety and limitations
- Synthetic data only. Results are not evidence of real market opportunities or expected returns.
- Real trading requires authorized market access, compliance review, and independent validation.
- A settlement discrepancy is a reason to investigate/reconcile, not permission to take funds.
- No live execution is implemented. Any future execution must require explicit approval, limits, audit logs, and a kill switch.
