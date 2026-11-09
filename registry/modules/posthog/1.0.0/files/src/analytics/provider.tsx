"use client";

import type { PropsWithChildren } from "react";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";

export function AnalyticsProvider({ children }: PropsWithChildren) {
  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}
