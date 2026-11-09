import { expect, test } from "vitest";

test("happy-dom provides a document", () => {
  expect(typeof document).toBe("object");
});
