"""MicroProfit Engine: simulation-only research prototype.

Uses synthetic prices and ledger records. It never accesses accounts or executes trades.
"""
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from random import Random

D = Decimal


@dataclass
class MarketQuote:
    venue: str
    bid: Decimal
    ask: Decimal
    fee_rate: Decimal
    slippage_rate: Decimal = D("0.0005")


def score_cross_market_buy_sell(buy: MarketQuote, sell: MarketQuote,
                                quantity: Decimal,
                                safety_buffer: Decimal = D("0.001")) -> dict:
    """Estimate net result for buying at one ask and selling at another bid."""
    if quantity <= 0:
        raise ValueError("quantity must be positive")
    cost = buy.ask * quantity
    proceeds = sell.bid * quantity
    fees = cost * buy.fee_rate + proceeds * sell.fee_rate
    slippage = (cost + proceeds) * max(buy.slippage_rate, sell.slippage_rate)
    buffer = (cost + proceeds) * safety_buffer
    net = proceeds - cost - fees - slippage - buffer
    return {
        "buy_venue": buy.venue,
        "sell_venue": sell.venue,
        "gross_spread": str(proceeds - cost),
        "estimated_fees": str(fees),
        "estimated_slippage": str(slippage),
        "safety_buffer": str(buffer),
        "estimated_net": str(net),
        "passes_threshold": net > 0,
        "note": "Simulation only; quotes may not be executable or simultaneous.",
    }


def reconcile_ledger(entries: list[dict]) -> dict:
    """Compare synthetic expected vs settled amounts; flag only for investigation."""
    expected = sum((D(str(x["expected"])) for x in entries), D("0"))
    settled = sum((D(str(x["settled"])) for x in entries), D("0"))
    residual = expected - settled
    return {
        "expected_total": str(expected),
        "settled_total": str(settled),
        "residual": str(residual),
        "status": "investigate" if residual != 0 else "balanced",
        "note": "A discrepancy is not ownership or permission to collect funds.",
    }


def simulate_micro_rounding(count: int = 1_000_000, seed: int = 7) -> dict:
    """Show rounding effects on synthetic values; not a profit mechanism."""
    rng = Random(seed)
    exact_total = D("0")
    rounded_total = D("0")
    cents = D("0.01")
    for _ in range(count):
        # Synthetic positive amount between $0.001 and $0.999.
        exact = D(rng.randrange(1, 1000)) / D("1000")
        rounded = exact.quantize(cents, rounding=ROUND_HALF_UP)
        exact_total += exact
        rounded_total += rounded
    return {
        "synthetic_transactions": count,
        "exact_total": str(exact_total.quantize(D("0.000001"))),
        "rounded_total": str(rounded_total.quantize(D("0.000001"))),
        "rounding_difference": str((rounded_total - exact_total).quantize(D("0.000001"))),
        "interpretation": "Rounding changes accounting totals; it does not create ownerless money.",
    }


def demo() -> None:
    print("MICROPROFIT ENGINE — SIMULATION ONLY\n")
    buy = MarketQuote("Synthetic A", D("99.90"), D("100.00"), D("0.001"))
    sell = MarketQuote("Synthetic B", D("100.25"), D("100.30"), D("0.0015"))
    print("Cross-market score:")
    print(score_cross_market_buy_sell(buy, sell, D("10")))
    print("\nLedger reconciliation:")
    print(reconcile_ledger([
        {"expected": "10.005", "settled": "10.00"},
        {"expected": "4.995", "settled": "4.99"},
    ]))
    print("\nRounding experiment (one million synthetic transactions):")
    print(simulate_micro_rounding())


if __name__ == "__main__":
    demo()
