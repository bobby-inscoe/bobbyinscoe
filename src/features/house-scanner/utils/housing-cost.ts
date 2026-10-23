import type {
  Financing,
  Listing,
} from '@/features/house-scanner/types/contracts';
import type { PriceEstimate } from '@/features/house-scanner/utils/price-estimate';

// The median average 3-month rate customers paid at Swedish banks in September 2026. Average rather than list
// rates, because few buyers pay the list rate. Update both together; saved household rates never follow it.
export const TYPICAL_RATE_PERCENT = 2.7;
export const TYPICAL_RATE_MONTH = '2026-09';

export const DEFAULT_FINANCING: Financing = {
  cashSek: null,
  interestRatePercent: TYPICAL_RATE_PERCENT,
  taxDeduction: true,
};

// Swedish rules in force since 1 April 2026: banks lend at most 90% of the price, amortization depends only on
// the starting loan-to-value, and 30% of interest is deductible up to 100 000 SEK a year, 21% above.
const MIN_CASH_SHARE = 0.1;
const DEDUCTION_LIMIT_SEK = 100_000;
// Ownership (äganderätt) only. The deed fee assumes the home has no existing mortgage deeds.
const TITLE_FEE_SHARE = 0.015;
const TITLE_FEE_SEK = 825;
const DEED_FEE_SHARE = 0.02;
const DEED_FEE_SEK = 375;

export function minimumCash(priceSek: number): number {
  return Math.ceil(priceSek * MIN_CASH_SHARE);
}

// The household's cash, or the minimum when it has not said, never more than the price.
export function startingCash(priceSek: number, financing: Financing): number {
  return Math.min(priceSek, financing.cashSek ?? minimumCash(priceSek));
}

// The highest published bid when it is above the asking price, else the asking price, else the middle of the
// estimate. Disputed amounts are not used.
export function startingPrice(
  listing: Listing,
  estimate?: PriceEstimate,
): number | null {
  const { facts, conflicts } = listing;
  const asking = conflicts.includes('askingPriceSek')
    ? null
    : facts.askingPriceSek;
  const bid = conflicts.includes('highestBidSek')
    ? null
    : (facts.highestBidSek ?? null);
  if (bid !== null && (asking === null || bid > asking)) return bid;
  if (asking !== null) return asking;
  return estimate ? (estimate.lowSek + estimate.highSek) / 2 : null;
}

// The monthly fee with any known required additions. Null when the fee is unknown or disputed.
export function monthlyFee(listing: Listing): number | null {
  const { facts, conflicts } = listing;
  if (facts.baseFeeSek === null || conflicts.includes('baseFeeSek'))
    return null;
  const extra =
    facts.mandatoryMonthlySek === null ||
    conflicts.includes('mandatoryMonthlySek')
      ? 0
      : facts.mandatoryMonthlySek;
  return facts.baseFeeSek + extra;
}

export interface CostInput {
  priceSek: number;
  cashSek: number;
  interestRatePercent: number;
  taxDeduction: boolean;
  feeSek: number | null;
  ownership: boolean;
}

// Monthly amounts are rounded to whole kronor and the total is their sum, so the rows add up on screen.
export interface HousingCost {
  loanSek: number;
  amortizationPercent: 0 | 1 | 2;
  interestSek: number;
  deductionSek: number;
  amortizationSek: number;
  feeSek: number | null;
  totalSek: number;
  // One-time fees, for ownership only.
  titleFeeSek: number | null;
  deedFeeSek: number | null;
}

export type CostResult =
  | { kind: 'cost'; cost: HousingCost }
  | { kind: 'short'; shortfallSek: number };

export function housingCost(input: CostInput): CostResult {
  const { priceSek, interestRatePercent, taxDeduction, feeSek, ownership } =
    input;
  const cashSek = Math.min(input.cashSek, priceSek);
  const shortfallSek = minimumCash(priceSek) - cashSek;
  if (shortfallSek > 0) return { kind: 'short', shortfallSek };
  const loanSek = priceSek - cashSek;
  const loanToValue = loanSek / priceSek;
  const amortizationPercent = loanToValue > 0.7 ? 2 : loanToValue > 0.5 ? 1 : 0;
  const yearlyInterest = (loanSek * interestRatePercent) / 100;
  const yearlyDeduction = taxDeduction
    ? 0.3 * Math.min(yearlyInterest, DEDUCTION_LIMIT_SEK) +
      0.21 * Math.max(0, yearlyInterest - DEDUCTION_LIMIT_SEK)
    : 0;
  const interestSek = Math.round(yearlyInterest / 12);
  const deductionSek = Math.round(yearlyDeduction / 12);
  const amortizationSek = Math.round(
    (loanSek * amortizationPercent) / 100 / 12,
  );
  return {
    kind: 'cost',
    cost: {
      loanSek,
      amortizationPercent,
      interestSek,
      deductionSek,
      amortizationSek,
      feeSek,
      totalSek: interestSek - deductionSek + amortizationSek + (feeSek ?? 0),
      titleFeeSek: ownership
        ? Math.round(priceSek * TITLE_FEE_SHARE) + TITLE_FEE_SEK
        : null,
      deedFeeSek: ownership
        ? loanSek > 0
          ? Math.round(loanSek * DEED_FEE_SHARE) + DEED_FEE_SEK
          : 0
        : null,
    },
  };
}
