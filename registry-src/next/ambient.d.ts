declare module "next" {
  export interface NextConfig {
    reactCompiler?: boolean;
  }
  export interface Metadata {
    title?: string;
    description?: string;
  }
}

declare module "next/server" {
  export const NextResponse: { next(): Response };
}
