import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import en from "../messages/en.json";
import { defaultLocale, localeCookie, toLocale, type Locale } from "./routing";

export const catalogs: Record<Locale, typeof en> = { en };

export default getRequestConfig(async () => {
  const store = await cookies();
  const locale = toLocale(store.get(localeCookie)?.value) ?? defaultLocale;
  return { locale, messages: catalogs[locale] };
});
