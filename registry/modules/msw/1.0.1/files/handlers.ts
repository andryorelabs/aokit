import { http, HttpResponse } from "msw";

export const handlers = [http.get("/api/hello", () => HttpResponse.json({ message: "Hello" }))];
