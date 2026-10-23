import { describe, expect, it } from 'vitest';
import { SYNTHETIC_SNAPSHOT } from '@/features/house-scanner/mock/synthetic-household';
import type { Listing } from '@/features/house-scanner/types/contracts';
import {
  type CostInput,
  housingCost,
  monthlyFee,
  startingPrice,
} from '@/features/house-scanner/utils/housing-cost';

const original = SYNTHETIC_SNAPSHOT.listings[0];
function home(
  facts: Partial<Listing['facts']>,
  conflicts: Listing['conflicts'] = [],
): Listing {
  return { ...original, conflicts, facts: { ...original.facts, ...facts } };
}

// Booli's calculator for the same inputs shows 7 340 interest, 4 943 amortization and 17 318 in total.
const booli: CostInput = {
  priceSek: 3_295_000,
  cashSek: 329_500,
  interestRatePercent: 2.97,
  taxDeduction: true,
  operatingCostsSek: 0,
  feeSek: 7_237,
  ownership: false,
};

describe('housingCost', () => {
  it('matches Booli for a cooperative apartment at 90% loan-to-value', () => {
    expect(housingCost(booli)).toEqual({
      kind: 'cost',
      cost: {
        loanSek: 2_965_500,
        amortizationPercent: 2,
        interestSek: 7_340,
        deductionSek: 2_202,
        amortizationSek: 4_943,
        feeSek: 7_237,
        operatingCostsSek: 0,
        totalSek: 17_318,
        titleFeeSek: null,
        deedFeeSek: null,
      },
    });
  });

  it.each([0, 1000, 1500])(
    'adds %s in operating costs without changing the monthly fee',
    (operatingCostsSek) => {
      const result = housingCost({ ...booli, operatingCostsSek });
      expect(result.kind === 'cost' && result.cost).toMatchObject({
        operatingCostsSek,
        feeSek: 7237,
        totalSek: 17318 + operatingCostsSek,
      });
    },
  );

  it('removes tax relief without changing operating costs or the fee', () => {
    const result = housingCost({
      ...booli,
      operatingCostsSek: 1000,
      taxDeduction: false,
    });
    expect(result.kind === 'cost' && result.cost).toMatchObject({
      deductionSek: 0,
      operatingCostsSek: 1000,
      feeSek: 7237,
      totalSek: 17318 + 1000 + 2202,
    });
  });

  it('steps amortization down above 70% and above 50% loan-to-value', () => {
    const percent = (cashSek: number) => {
      const result = housingCost({ ...booli, priceSek: 1_000_000, cashSek });
      return result.kind === 'cost' ? result.cost.amortizationPercent : null;
    };
    expect(percent(299_999)).toBe(2);
    expect(percent(300_000)).toBe(1);
    expect(percent(499_999)).toBe(1);
    expect(percent(500_000)).toBe(0);
  });

  it('reports the missing cash below the 10% minimum instead of a loan', () => {
    expect(housingCost({ ...booli, cashSek: 300_000 })).toEqual({
      kind: 'short',
      shortfallSek: 29_500,
    });
  });

  it('cuts the deduction to 21% above 100 000 SEK of yearly interest', () => {
    const result = housingCost({
      ...booli,
      priceSek: 5_000_000,
      cashSek: 1_000_000,
      interestRatePercent: 5,
    });
    // 200 000 a year: 30 000 + 21 000 back.
    expect(result.kind === 'cost' && result.cost.deductionSek).toBe(4_250);
  });

  it('adds one-time title and deed fees for ownership', () => {
    const result = housingCost({ ...booli, ownership: true, feeSek: null });
    expect(result.kind === 'cost' && result.cost).toMatchObject({
      titleFeeSek: 50_250,
      deedFeeSek: 59_685,
      totalSek: 7_340 - 2_202 + 4_943,
    });
  });
});

describe('listing inputs', () => {
  it('starts from the higher of bid and asking price, then the estimate middle', () => {
    expect(
      startingPrice(
        home({ askingPriceSek: 3_000_000, highestBidSek: 3_200_000 }),
      ),
    ).toBe(3_200_000);
    expect(
      startingPrice(home({ askingPriceSek: 3_000_000, highestBidSek: null })),
    ).toBe(3_000_000);
    expect(
      startingPrice(home({ askingPriceSek: 3_000_000, highestBidSek: null }), {
        lowSek: 1,
        highSek: 2,
        basedOn: 6,
        farthestM: 1,
      }),
    ).toBe(3_000_000);
    expect(
      startingPrice(home({ askingPriceSek: null, highestBidSek: null }), {
        lowSek: 2_000_000,
        highSek: 3_000_000,
        basedOn: 6,
        farthestM: 1,
      }),
    ).toBe(2_500_000);
    expect(
      startingPrice(
        home({ askingPriceSek: 3_000_000, highestBidSek: null }, [
          'askingPriceSek',
        ]),
      ),
    ).toBeNull();
  });

  it('never treats an unknown or disputed fee as zero', () => {
    expect(monthlyFee(home({ baseFeeSek: null }))).toBeNull();
    expect(monthlyFee(home({ baseFeeSek: 4_000 }, ['baseFeeSek']))).toBeNull();
    expect(
      monthlyFee(home({ baseFeeSek: 4_000, mandatoryMonthlySek: 300 })),
    ).toBe(4_300);
    expect(
      monthlyFee(home({ baseFeeSek: 4_000, mandatoryMonthlySek: null })),
    ).toBe(4_000);
  });
});
