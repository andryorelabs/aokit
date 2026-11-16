import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from "@react-email/components";

interface WelcomeEmailProps {
  name?: string;
  url?: string;
}

/**
 * A starter template; preview it with `bun run email:dev`.
 */
export default function WelcomeEmail({
  name = "there",
  url = "https://example.com",
}: WelcomeEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Welcome aboard</Preview>
      <Body>
        <Container>
          <Heading>Welcome, {name}</Heading>
          <Text>Thanks for signing up.</Text>
          <Button href={url}>Get started</Button>
        </Container>
      </Body>
    </Html>
  );
}
