import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  apiErrorHandler,
  throwUnauthorized,
  unauthorizedError,
} from "../../../server/utils/errors";
import type { ApiError as ApiErrorObject } from "../../../server/types/api.types";

const mockCreateError = vi.fn((options: object) => {
  const error = new Error("createError");
  Object.assign(error, options);
  return error;
});

beforeEach(() => {
  vi.stubGlobal("createError", mockCreateError);
  mockCreateError.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const sampleErrors: ApiErrorObject[] = [
  {
    status: "422",
    title: "Validation Error",
    detail: "Name is required",
    source: { pointer: "/data/attributes/name" },
  },
];

describe("ApiError", () => {
  it("stores the provided errors array and status code", () => {
    const apiError = new ApiError(sampleErrors, 422);

    expect(apiError.errors).toEqual(sampleErrors);
    expect(apiError.statusCode).toBe(422);
  });

  it("is an instance of Error", () => {
    const apiError = new ApiError(sampleErrors, 422);

    expect(apiError).toBeInstanceOf(Error);
  });

  it("throws RangeError when statusCode is below 400", () => {
    expect(() => new ApiError(sampleErrors, 200)).toThrow(RangeError);
    expect(() => new ApiError(sampleErrors, 200)).toThrow(
      "ApiError statusCode must be an integer between 400 and 599",
    );
  });

  it("throws RangeError when statusCode is above 599", () => {
    expect(() => new ApiError(sampleErrors, 600)).toThrow(RangeError);
    expect(() => new ApiError(sampleErrors, 600)).toThrow(
      "ApiError statusCode must be an integer between 400 and 599",
    );
  });

  it("throws RangeError when statusCode is not an integer", () => {
    expect(() => new ApiError(sampleErrors, 422.5)).toThrow(RangeError);
    expect(() => new ApiError(sampleErrors, 422.5)).toThrow(
      "ApiError statusCode must be an integer between 400 and 599",
    );
  });

  it("accepts boundary statusCode values 400 and 599", () => {
    expect(() => new ApiError(sampleErrors, 400)).not.toThrow();
    expect(() => new ApiError(sampleErrors, 599)).not.toThrow();
  });
});

describe("unauthorizedError", () => {
  it("is an ApiError carrying the 401 JSON:API envelope shape", () => {
    const apiError = unauthorizedError();

    expect(apiError).toBeInstanceOf(ApiError);
    expect(apiError.statusCode).toBe(401);
    expect(apiError.errors).toEqual([
      {
        status: "401",
        title: "Unauthorized",
        detail: "Authentication is required to access this resource.",
      },
    ]);
  });

  it("routes a 401 through apiErrorHandler as a { errors: [...] } body", () => {
    expect(() => apiErrorHandler(unauthorizedError())).toThrow();

    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 401,
      data: {
        errors: [
          expect.objectContaining({
            status: "401",
            detail: "Authentication is required to access this resource.",
          }),
        ],
      },
    });
  });
});

describe("throwUnauthorized", () => {
  it("throws the 401 JSON:API envelope through apiErrorHandler", () => {
    expect(() => throwUnauthorized()).toThrow();

    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 401,
      data: {
        errors: [
          {
            status: "401",
            title: "Unauthorized",
            detail: "Authentication is required to access this resource.",
          },
        ],
      },
    });
  });
});

describe("apiErrorHandler", () => {
  it("re-throws ApiError instances via createError with correct status and JSON API body", () => {
    const apiError = new ApiError(sampleErrors, 422);

    expect(() => apiErrorHandler(apiError)).toThrow();
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 422,
      data: { errors: sampleErrors },
    });
  });

  it("logs and throws a generic 500 createError for unknown errors", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    expect(() => apiErrorHandler(new Error("database exploded"))).toThrow();
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 500,
      statusMessage: "Internal Server Error",
    });
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("re-throws pre-formed HTTP errors untouched instead of masking them as a 500", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const httpError = Object.assign(new Error("Unauthorized"), {
      statusCode: 401,
      statusMessage: "Unauthorized",
    });

    let thrown: unknown;
    try {
      apiErrorHandler(httpError);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(httpError);
    expect(mockCreateError).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("handles non-Error unknown values for the 500 fallback", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    expect(() => apiErrorHandler("some string error")).toThrow();
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 500,
      statusMessage: "Internal Server Error",
    });

    consoleErrorSpy.mockRestore();
  });

  it("does not leak internal error details in the 500 response", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    expect(() => apiErrorHandler(new Error("secret db url leaked"))).toThrow();

    const callArgs = mockCreateError.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(callArgs)).not.toContain("secret db url leaked");

    consoleErrorSpy.mockRestore();
  });
});
