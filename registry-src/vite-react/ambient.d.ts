declare module "@rolldown/plugin-babel" {
  export default function babel(options: { presets: unknown[] }): { name?: string };
}

declare module "@vitejs/plugin-react" {
  export function reactCompilerPreset(): unknown;
}

declare module "react" {
  export function createElement(type: unknown, props: unknown, ...children: unknown[]): ReactNode;
}
