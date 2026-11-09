declare module "clsx" {
  export type ClassValue = string | number | boolean | null | undefined | ClassValue[];

  export function clsx(...inputs: ClassValue[]): string;
}

declare module "tailwind-merge" {
  export function twMerge(...classNames: (string | null | undefined | false)[]): string;
}

declare module "sonner" {
  import type { ComponentType } from "react";

  export const Toaster: ComponentType<{ theme?: "light" | "dark" | "system" }>;
}
