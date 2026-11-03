import type { PropsWithChildren } from "react";

import.meta.glob("./styles.css", { eager: true });

export function TailwindProvider({ children }: PropsWithChildren) {
  return children;
}
