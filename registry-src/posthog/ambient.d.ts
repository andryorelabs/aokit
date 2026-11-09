declare module "posthog-js" {
  interface PostHog {
    init(key: string, options?: { api_host?: string; defaults?: string }): void;
  }

  const posthog: PostHog;
  export default posthog;
}

declare module "posthog-js/react" {
  import type { ComponentType, PropsWithChildren } from "react";

  export const PostHogProvider: ComponentType<PropsWithChildren<{ client: object }>>;
}
