import { describe, expect, it } from "vitest"
import { looksLikePdfUrl } from "../pdf-detect"

describe("looksLikePdfUrl", () => {
  it("detects .pdf suffix (case-insensitive)", () => {
    expect(looksLikePdfUrl("https://example.com/paper.pdf")).toBe(true)
    expect(looksLikePdfUrl("https://example.com/paper.PDF")).toBe(true)
  })

  it("detects path-style pdf routes like arxiv", () => {
    expect(looksLikePdfUrl("https://arxiv.org/pdf/2401.00001v2")).toBe(true)
  })

  it("rejects non-pdf urls", () => {
    expect(looksLikePdfUrl("https://example.com/")).toBe(false)
    expect(looksLikePdfUrl("https://example.com/paper.html")).toBe(false)
    expect(looksLikePdfUrl("chrome-extension://abc/popup.html")).toBe(false)
  })

  it("does not false-positive on urls merely containing 'pdf' in query", () => {
    expect(looksLikePdfUrl("https://example.com/page?file=pdf-notes")).toBe(false)
  })
})
