"use client";

import type { PropsWithChildren } from "react";
import { NextIntlClientProvider } from "next-intl";
import { catalogs } from "./messages";
import { defaultLocale } from "./routing";

export function IntlProvider({ children }: PropsWithChildren) {
  return (
    <NextIntlClientProvider locale={defaultLocale} messages={catalogs[defaultLocale]}>
      {children}
    </NextIntlClientProvider>
  );
}
