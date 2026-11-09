declare module "tsdown" {
  export function defineConfig(config: {
    entry?: string[];
    format?: string | string[];
    dts?: boolean;
    tsconfig?: string;
    clean?: boolean;
    outDir?: string;
  }): unknown;
}
