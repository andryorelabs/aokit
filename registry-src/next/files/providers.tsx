"use client";

import type { ComponentType, PropsWithChildren, ReactNode } from "react";

export const providers: ComponentType<PropsWithChildren>[] = [];

export function Providers({ children }: PropsWithChildren) {
  return providers.reduceRight<ReactNode>(
    (tree, Provider) => <Provider>{tree}</Provider>,
    children,
  );
}
