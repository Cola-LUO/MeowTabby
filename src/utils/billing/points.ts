// src/utils/billing/points.ts
export const POINTS_PER_YUAN = 100

/**
 * Convert a yuan balance (from /me, up to 4 decimal places) into display points (1 yuan = 100 points).
 * Rounds to 2 decimal places to eliminate JS floating-point noise (e.g. 0.14 * 100) and trims trailing zeros.
 */
export function formatBalanceAsPoints(
  balanceYuan: string | number | null | undefined,
): string | undefined {
  if (balanceYuan === null || balanceYuan === undefined || balanceYuan === "") {
    return undefined
  }
  const numeric = typeof balanceYuan === "number" ? balanceYuan : Number(balanceYuan)
  if (!Number.isFinite(numeric)) {
    return undefined
  }
  const points = Math.round(numeric * POINTS_PER_YUAN * 100) / 100
  return Object.is(points, -0) ? "0" : String(points)
}
