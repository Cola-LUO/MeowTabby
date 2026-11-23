// src/utils/billing/__tests__/points.test.ts
import { describe, expect, it } from "vitest"
import { formatBalanceAsPoints } from "../points"

describe("formatBalanceAsPoints", () => {
  it("converts yuan string or number to points (1 yuan = 100 points)", () => {
    expect(formatBalanceAsPoints(0.302)).toBe("30.2")
    expect(formatBalanceAsPoints("0.302")).toBe("30.2")
    expect(formatBalanceAsPoints("3.1400")).toBe("314")
    expect(formatBalanceAsPoints("0.3025")).toBe("30.25")
    expect(formatBalanceAsPoints(0)).toBe("0")
    expect(formatBalanceAsPoints("0.0000")).toBe("0")
  })

  it("avoids floating-point precision artifacts", () => {
    expect(formatBalanceAsPoints(0.14)).toBe("14")
    expect(formatBalanceAsPoints("0.29")).toBe("29")
    expect(formatBalanceAsPoints(19.99)).toBe("1999")
  })

  it("handles negative balances and avoids -0", () => {
    expect(formatBalanceAsPoints(-0.05)).toBe("-5")
    expect(formatBalanceAsPoints(-0.0001)).toBe("-0.01")
    expect(formatBalanceAsPoints(-0.00001)).toBe("0")
  })

  it("returns undefined for empty or invalid values", () => {
    expect(formatBalanceAsPoints(undefined)).toBeUndefined()
    expect(formatBalanceAsPoints(null)).toBeUndefined()
    expect(formatBalanceAsPoints("")).toBeUndefined()
    expect(formatBalanceAsPoints("not-a-number")).toBeUndefined()
  })
})
