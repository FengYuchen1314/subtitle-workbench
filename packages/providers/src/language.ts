import type { Profile } from "@subtitle/core";
const locales: Record<string, string> = {
  zh: "zh-CN",
  "zh-Hant": "zh-TW",
  en: "en-US",
  ja: "ja-JP",
  ko: "ko-KR",
  fr: "fr-FR",
  de: "de-DE",
  es: "es-ES",
  pt: "pt-BR",
  ru: "ru-RU",
  ar: "ar-SA",
  hi: "hi-IN",
};
export function asrLanguage(p: Profile, language: string): string | undefined {
  if (p.options.languageCode) return p.options.languageCode;
  if (p.provider === "iflytek")
    return p.model === "standard"
      ? language === "auto" || language.startsWith("zh")
        ? "cn"
        : language
      : ["auto", "zh", "zh-Hant", "en"].includes(language)
        ? "autodialect"
        : "autominor";
  if (language === "auto") return undefined;
  if (["azure", "aws", "google"].includes(p.provider))
    return locales[language] || language;
  if (p.provider === "speechmatics" && language.startsWith("zh")) return "cmn";
  return language === "zh-Hant" ? "zh" : language;
}
