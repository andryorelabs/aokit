declare module "better-auth/react" {
  export interface AuthClient {
    signIn: object;
    signUp: object;
    signOut(): Promise<unknown>;
    useSession(): object;
  }
  export function createAuthClient(options?: { baseURL?: string }): AuthClient;
}
