export const locales = ["en"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

export const localeCookie = "NEXT_LOCALE";

/**
 * Narrows an arbitrary string, such as a cookie value or a language tag, to a supported locale.
 */
export function toLocale(value: string | null | undefined): Locale | undefined {
  return locales.find((locale) => locale === value);
}
