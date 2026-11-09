import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "../providers";
// oxlint-disable-next-line import/no-unassigned-import -- the side-effect import registers the stylesheets
import "../styles";

export const metadata: Metadata = {
  title: "App",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
