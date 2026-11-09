import { createAuthClient } from "better-auth/react";

/**
 * The browser-side Better Auth client; it talks to the `/api/auth` route handler.
 */
export const authClient = createAuthClient();
