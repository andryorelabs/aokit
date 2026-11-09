declare module "prisma/config" {
  export function env(name: string): string;
  export function defineConfig(config: { schema: string; datasource: { url: string } }): object;
}
