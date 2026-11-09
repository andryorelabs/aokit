declare module "@base-ui/react/button" {
  import type { ComponentType, PropsWithChildren } from "react";

  export const Button: ComponentType<PropsWithChildren<{ disabled?: boolean }>>;
}
