import { Button as BaseButton } from "@base-ui/react/button";
import type { PropsWithChildren } from "react";

export function Button({ children }: PropsWithChildren) {
  return <BaseButton>{children}</BaseButton>;
}
