declare module "@react-email/components" {
  type EmailProps = { children?: unknown; href?: string; style?: object };
  export function Html(props: EmailProps): object;
  export function Head(props: EmailProps): object;
  export function Body(props: EmailProps): object;
  export function Container(props: EmailProps): object;
  export function Heading(props: EmailProps): object;
  export function Text(props: EmailProps): object;
  export function Button(props: EmailProps): object;
  export function Preview(props: EmailProps): object;
}
