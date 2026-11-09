import { expect, test } from "vitest";
import { render } from "vitest-browser-react";

test("renders in a real browser", async () => {
  const screen = await render(<h1>Hello</h1>);
  expect(screen.getByText("Hello").element().textContent).toBe("Hello");
});
