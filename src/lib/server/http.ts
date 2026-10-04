import "server-only";
import { z } from "zod";
import { AppError } from "./errors";
export async function api<T>(work: () => Promise<T>): Promise<Response> {
  try {
    return Response.json(await work(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: error.issues.map((i) => i.message).join(" "),
          },
        },
        { status: 400 },
      );
    if (error instanceof AppError)
      return Response.json(
        { error: { code: error.code, message: error.message } },
        {
          status: error.status,
          headers: error.status === 429 ? { "Retry-After": "60" } : {},
        },
      );
    return Response.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message:
            "The request could not be completed. No results were fabricated. Retry or check server configuration.",
        },
      },
      { status: 500 },
    );
  }
}
export async function body(request: Request): Promise<unknown> {
  const origin = request.headers.get("origin");
  // Next's internal request URL may use localhost while the browser uses 127.0.0.1.
  // Compare with the incoming Host header, which browser JS cannot override.
  if (origin) {
    let sameHost = false;
    try {
      const supplied = new URL(origin);
      sameHost =
        ["http:", "https:"].includes(supplied.protocol) &&
        supplied.host ===
          (request.headers.get("host") ?? new URL(request.url).host);
    } catch {
      /* Malformed origins are rejected below. */
    }
    if (!sameHost)
      throw new AppError(
        "ORIGIN_REJECTED",
        "Cross-origin requests are not allowed.",
        403,
      );
  }
  if (Number(request.headers.get("content-length") ?? 0) > 16000)
    throw new AppError("BODY_TOO_LARGE", "Request too large.", 413);
  const text = await request.text();
  if (text.length > 16000)
    throw new AppError("BODY_TOO_LARGE", "Request too large.", 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("INVALID_JSON", "Request body must be valid JSON.", 400);
  }
}
