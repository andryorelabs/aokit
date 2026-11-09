declare module "next-intl/plugin" {
  import type { NextConfig } from "next";

  export default function createNextIntlPlugin(
    requestConfigPath?: string,
  ): (config: NextConfig) => NextConfig;
}

declare module "next-intl" {
  import type { ComponentType, PropsWithChildren } from "react";

  export const NextIntlClientProvider: ComponentType<
    PropsWithChildren<{ locale?: string; messages?: Record<string, unknown> }>
  >;
}

declare module "next-intl/server" {
  export function getRequestConfig(
    factory: () => Promise<{ locale: string; messages: Record<string, unknown> }>,
  ): unknown;
}

declare module "next/headers" {
  export function cookies(): Promise<{ get(name: string): { value: string } | undefined }>;
}
