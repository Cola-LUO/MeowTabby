import { describe, expect, it } from "vitest"
import { buildPdfTranslateSystemPrompt, pdfPromptResolver } from "../pdf-translate"

describe("buildPdfTranslateSystemPrompt", () => {
  it("keeps the translation rule separate from document context", () => {
    const prompt = buildPdfTranslateSystemPrompt("Chinese")
    expect(prompt).not.toContain("%%")
    expect(prompt).toContain("Translate only the text in the user message")
    expect(prompt).toContain("Translation Rules")
  })

  it("interpolates the target language name", () => {
    expect(buildPdfTranslateSystemPrompt("Chinese")).toContain("into Chinese")
    expect(buildPdfTranslateSystemPrompt("English")).toContain("into English")
    expect(buildPdfTranslateSystemPrompt("Japanese")).toContain("into Japanese")
  })

  it("keeps the LaTeX preservation rule", () => {
    expect(buildPdfTranslateSystemPrompt("Chinese")).toContain("LaTeX")
    expect(buildPdfTranslateSystemPrompt("Chinese")).toContain("$")
  })
})

describe("pdfPromptResolver", () => {
  it("passes the input through as the prompt and resolves the system prompt from targetLang", async () => {
    const result = await pdfPromptResolver("Chinese", "Hello", { context: { summary: "Context" } })
    expect(result.prompt).toBe("Hello")
    expect(result.systemPrompt).toContain("into Chinese")
    expect(result.systemPrompt).toContain("Abstract (reference only):\nContext")
  })
})
