import { NextResponse } from "next/server";
import { defaultLocale, localeCookie, toLocale } from "./i18n/routing";

/**
 * Picks the first supported language of an `Accept-Language` header.
 */
function negotiateLocale(header: string | null) {
  const tags = (header ?? "").split(",").map((part) => part.split(";")[0]?.trim().slice(0, 2));
  return tags.map((tag) => toLocale(tag)).find((locale) => locale !== undefined);
}

export function proxy(request: Request) {
  const response = NextResponse.next();
  const hasCookie = (request.headers.get("cookie") ?? "").includes(`${localeCookie}=`);
  if (!hasCookie) {
    const locale = negotiateLocale(request.headers.get("accept-language")) ?? defaultLocale;
    response.headers.append("set-cookie", `${localeCookie}=${locale}; Path=/; SameSite=Lax`);
  }
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
