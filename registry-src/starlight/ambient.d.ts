declare module "@astrojs/starlight" {
  export default function starlight(options: { title: string }): unknown;
}

declare module "@astrojs/starlight/loaders" {
  export function docsLoader(): unknown;
}

declare module "@astrojs/starlight/schema" {
  export function docsSchema(): unknown;
}

declare module "astro:content" {
  export function defineCollection(config: { loader: unknown; schema: unknown }): unknown;
}
