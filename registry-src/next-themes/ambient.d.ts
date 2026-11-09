declare module "next-themes" {
  import type { ComponentType, PropsWithChildren } from "react";

  export const ThemeProvider: ComponentType<
    PropsWithChildren<{
      attribute?: "class" | "data-theme";
      defaultTheme?: string;
      enableSystem?: boolean;
    }>
  >;
}
