import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { catalogs } from "./messages";
import { defaultLocale, localeCookie, toLocale } from "./routing";

export default getRequestConfig(async () => {
  const store = await cookies();
  const locale = toLocale(store.get(localeCookie)?.value) ?? defaultLocale;
  return { locale, messages: catalogs[locale] };
});
