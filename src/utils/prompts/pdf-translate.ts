import type { PromptResolver } from "@/utils/host/translate/api/ai"

export function buildPdfTranslateSystemPrompt(lang: string): string {
  return `You are a professional ${lang} native translator who needs to fluently translate text into ${lang}.

## Translation Rules
1. Translate only the text in the user message. Output only its translation, without explanations or additional content.
2. Maintain the original paragraph format.
3. If the article contains mathematical formulas: convert them to LaTeX and wrap them in delimiters — inline formulas as $...$, standalone formulas as $$...$$. Do not translate the formula content itself.

## Math Formula Rules
1. Inline formulas → wrap in $...$, e.g. energy $E = mc^2$ holds.
2. Standalone formulas → wrap in $$...$$, e.g. $$x^2 + y^2 = r^2$$
3. Use only standard LaTeX commands; keep the formula mathematically identical to the source.`
}

export const pdfPromptResolver: PromptResolver<{ summary?: string }> = (
  targetLang,
  input,
  options,
) => {
  const summary = options?.context?.summary
  return Promise.resolve({
    systemPrompt:
      buildPdfTranslateSystemPrompt(targetLang) +
      (summary ? `\n\n## Document Context\nAbstract (reference only):\n${summary}` : ""),
    prompt: input,
  })
}
