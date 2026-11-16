"use client";

import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import type { PropsWithChildren } from "react";

export function AnalyticsProvider({ children }: PropsWithChildren) {
  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}
