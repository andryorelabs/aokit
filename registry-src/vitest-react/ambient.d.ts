declare module "vitest/config" {
  export function defineConfig(config: {
    test?: {
      projects?: {
        test: {
          name: string;
          environment?: string;
          include: string[];
          browser?: {
            enabled: boolean;
            headless: boolean;
            provider: unknown;
            instances: { browser: string }[];
          };
        };
      }[];
    };
  }): object;
}

declare module "@vitest/browser-playwright" {
  export function playwright(): unknown;
}

declare module "vitest-browser-react" {
  export function render(
    ui: unknown,
  ): Promise<{ getByText(text: string): { element(): { textContent: string | null } } }>;
}
