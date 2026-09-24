import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("$fetch", mockFetch);

function makeTokenResource(overrides: Record<string, unknown> = {}) {
  return {
    type: "api_tokens",
    id: "uuid-1",
    attributes: {
      name: "obsidian-laptop",
      prefix: "mp_live_8f2a",
      createdAt: "2026-04-02T00:00:00.000Z",
      lastUsedAt: "2026-06-27T12:00:00.000Z",
      expiresAt: null,
      scopes: null,
      ...overrides,
    },
  };
}

function makeListResponse(resources = [makeTokenResource()]) {
  return { data: resources };
}

function makeErrorResponse(detail = "Something went wrong.") {
  return { errors: [{ detail }] };
}

// prettier-ignore
function makeMintResponse(token = "mp_live_abc123", expiresAt: string | null = null) { // gitleaks:allow
  return {
    data: {
      type: "api_tokens",
      id: "uuid-new",
      attributes: {
        name: "new-token",
        prefix: "mp_live_abc",
        createdAt: "2026-06-27T00:00:00.000Z",
        expiresAt,
        token,
      },
    },
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("useApiTokens", () => {
  describe("loadTokens", () => {
    it("populates tokens from the API response", async () => {
      mockFetch.mockResolvedValueOnce(makeListResponse());
      const { tokens, loadTokens } = useApiTokens();
      await loadTokens();
      expect(tokens.value).toHaveLength(1);
      expect(tokens.value[0].name).toBe("obsidian-laptop");
      expect(tokens.value[0].id).toBe("uuid-1");
    });

    it("deserializes createdAt string to a Date object", async () => {
      mockFetch.mockResolvedValueOnce(makeListResponse());
      const { tokens, loadTokens } = useApiTokens();
      await loadTokens();
      expect(tokens.value[0].createdAt).toBeInstanceOf(Date);
      expect(tokens.value[0].createdAt?.toISOString()).toBe(
        "2026-04-02T00:00:00.000Z",
      );
    });

    it("deserializes lastUsedAt string to a Date object", async () => {
      mockFetch.mockResolvedValueOnce(makeListResponse());
      const { tokens, loadTokens } = useApiTokens();
      await loadTokens();
      expect(tokens.value[0].lastUsedAt).toBeInstanceOf(Date);
      expect(tokens.value[0].lastUsedAt?.toISOString()).toBe(
        "2026-06-27T12:00:00.000Z",
      );
    });

    it("sets lastUsedAt to null when the field is null", async () => {
      mockFetch.mockResolvedValueOnce(
        makeListResponse([makeTokenResource({ lastUsedAt: null })]),
      );
      const { tokens, loadTokens } = useApiTokens();
      await loadTokens();
      expect(tokens.value[0].lastUsedAt).toBeNull();
    });

    it("deserializes expiresAt string to a Date object", async () => {
      mockFetch.mockResolvedValueOnce(
        makeListResponse([
          makeTokenResource({ expiresAt: "2026-09-25T00:00:00.000Z" }),
        ]),
      );
      const { tokens, loadTokens } = useApiTokens();
      await loadTokens();
      expect(tokens.value[0].expiresAt).toBeInstanceOf(Date);
      expect(tokens.value[0].expiresAt?.toISOString()).toBe(
        "2026-09-25T00:00:00.000Z",
      );
    });

    it("sets expiresAt to null when the field is null", async () => {
      mockFetch.mockResolvedValueOnce(makeListResponse());
      const { tokens, loadTokens } = useApiTokens();
      await loadTokens();
      expect(tokens.value[0].expiresAt).toBeNull();
    });

    it("sets scopes to null (full access) when the field is null", async () => {
      mockFetch.mockResolvedValueOnce(makeListResponse());
      const { tokens, loadTokens } = useApiTokens();
      await loadTokens();
      expect(tokens.value[0].scopes).toBeNull();
    });

    it("passes through a scoped token's scope list", async () => {
      mockFetch.mockResolvedValueOnce(
        makeListResponse([
          makeTokenResource({ scopes: ["records:read", "records:write"] }),
        ]),
      );
      const { tokens, loadTokens } = useApiTokens();
      await loadTokens();
      expect(tokens.value[0].scopes).toEqual(["records:read", "records:write"]);
    });

    it("sets loadError when the response carries an errors body", async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse("DB unavailable."));
      const { loadError, loadTokens } = useApiTokens();
      await loadTokens();
      expect(loadError.value).toBe("DB unavailable.");
    });

    it("sets loadError when $fetch throws", async () => {
      mockFetch.mockRejectedValueOnce({
        data: { errors: [{ detail: "Server exploded." }] },
      });
      const { loadError, loadTokens } = useApiTokens();
      await loadTokens();
      expect(loadError.value).toBe("Server exploded.");
    });

    it("uses fallback message when $fetch throws without error detail", async () => {
      mockFetch.mockRejectedValueOnce(new Error("network error"));
      const { loadError, loadTokens } = useApiTokens();
      await loadTokens();
      expect(loadError.value).toBe("Failed to load tokens.");
    });

    it("clears loadError on a successful retry", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValueOnce(makeListResponse());
      const { loadError, loadTokens } = useApiTokens();
      await loadTokens();
      expect(loadError.value).toBeTruthy();
      await loadTokens();
      expect(loadError.value).toBeNull();
    });

    it("does not start a second concurrent load", async () => {
      let resolveFirst!: () => void;
      mockFetch.mockImplementationOnce(
        () =>
          new Promise<unknown>((resolve) => {
            resolveFirst = () => resolve(makeListResponse());
          }),
      );

      const { loadTokens } = useApiTokens();
      const firstLoad = loadTokens();
      const secondLoad = loadTokens();

      resolveFirst();
      await Promise.all([firstLoad, secondLoad]);

      expect(mockFetch).toHaveBeenCalledOnce();
    });
  });

  describe("mintToken", () => {
    it("sets revealedToken from the API response", async () => {
      mockFetch
        .mockResolvedValueOnce(makeMintResponse("mp_live_abc123")) // gitleaks:allow
        .mockResolvedValueOnce(makeListResponse());
      const { revealedToken, mintToken } = useApiTokens();
      await mintToken("new-token");
      expect(revealedToken.value).toBe("mp_live_abc123");
    });

    it("passes expiresInDays in the mint request body when provided", async () => {
      mockFetch
        .mockResolvedValueOnce(makeMintResponse())
        .mockResolvedValueOnce(makeListResponse());
      const { mintToken } = useApiTokens();
      await mintToken("new-token", 30);

      expect(mockFetch).toHaveBeenNthCalledWith(1, "/api/tokens", {
        method: "POST",
        body: {
          data: {
            type: "api_tokens",
            attributes: { name: "new-token", expiresInDays: 30 },
          },
        },
      });
    });

    it("omits expiresInDays from the mint request body when not provided", async () => {
      mockFetch
        .mockResolvedValueOnce(makeMintResponse())
        .mockResolvedValueOnce(makeListResponse());
      const { mintToken } = useApiTokens();
      await mintToken("new-token");

      expect(mockFetch).toHaveBeenNthCalledWith(1, "/api/tokens", {
        method: "POST",
        body: {
          data: {
            type: "api_tokens",
            attributes: { name: "new-token" },
          },
        },
      });
    });

    it("passes scopes in the mint request body when provided", async () => {
      mockFetch
        .mockResolvedValueOnce(makeMintResponse())
        .mockResolvedValueOnce(makeListResponse());
      const { mintToken } = useApiTokens();
      await mintToken("new-token", 30, ["records:read"]);

      expect(mockFetch).toHaveBeenNthCalledWith(1, "/api/tokens", {
        method: "POST",
        body: {
          data: {
            type: "api_tokens",
            attributes: {
              name: "new-token",
              expiresInDays: 30,
              scopes: ["records:read"],
            },
          },
        },
      });
    });

    it("omits scopes from the mint request body when not provided (full access)", async () => {
      mockFetch
        .mockResolvedValueOnce(makeMintResponse())
        .mockResolvedValueOnce(makeListResponse());
      const { mintToken } = useApiTokens();
      await mintToken("new-token");

      expect(mockFetch).toHaveBeenNthCalledWith(1, "/api/tokens", {
        method: "POST",
        body: {
          data: {
            type: "api_tokens",
            attributes: { name: "new-token" },
          },
        },
      });
    });

    it("calls loadTokens after a successful mint", async () => {
      mockFetch
        .mockResolvedValueOnce(makeMintResponse())
        .mockResolvedValueOnce(makeListResponse());
      const { mintToken } = useApiTokens();
      await mintToken("new-token");
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenNthCalledWith(2, "/api/tokens");
    });

    it("refreshes token list even when initial loadTokens is still in flight", async () => {
      let resolveInitialLoad!: () => void;
      mockFetch
        .mockImplementationOnce(
          () =>
            new Promise<unknown>((resolve) => {
              resolveInitialLoad = () => resolve(makeListResponse());
            }),
        )
        .mockResolvedValueOnce(makeMintResponse("mp_live_new")) // gitleaks:allow
        .mockResolvedValueOnce(makeListResponse([makeTokenResource()]));

      const { tokens, loadTokens, mintToken } = useApiTokens();
      const initialLoad = loadTokens();
      const mint = mintToken("new-token");

      resolveInitialLoad();
      await Promise.all([initialLoad, mint]);

      // After mint completes, the list should reflect the post-mint refresh
      expect(tokens.value).toHaveLength(1);
    });

    it("sets mintError when the response carries an errors body", async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse("Name required."));
      const { mintError, mintToken } = useApiTokens();
      await mintToken("new-token");
      expect(mintError.value).toBe("Name required.");
    });

    it("sets mintError when the response has no data and no errors", async () => {
      mockFetch.mockResolvedValueOnce({});
      const { mintError, mintToken } = useApiTokens();
      await mintToken("new-token");
      expect(mintError.value).toBe("Failed to generate token.");
    });

    it("sets mintError when $fetch throws", async () => {
      mockFetch.mockRejectedValueOnce({
        data: { errors: [{ detail: "Server error." }] },
      });
      const { mintError, mintToken } = useApiTokens();
      await mintToken("new-token");
      expect(mintError.value).toBe("Server error.");
    });

    it("does not start a second concurrent mint", async () => {
      let resolveFirst!: () => void;
      mockFetch
        .mockImplementationOnce(
          () =>
            new Promise<unknown>((resolve) => {
              resolveFirst = () => resolve(makeMintResponse());
            }),
        )
        .mockResolvedValueOnce(makeListResponse());

      const { mintToken } = useApiTokens();
      const firstMint = mintToken("token-a");
      const secondMint = mintToken("token-b");

      resolveFirst();
      await Promise.all([firstMint, secondMint]);

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("revokeToken", () => {
    it("removes the token from the local list on success", async () => {
      mockFetch
        .mockResolvedValueOnce(makeListResponse())
        .mockResolvedValueOnce({ data: null });
      const { tokens, loadTokens, revokeToken } = useApiTokens();
      await loadTokens();
      expect(tokens.value).toHaveLength(1);
      await revokeToken("uuid-1");
      expect(tokens.value).toHaveLength(0);
    });

    it("sets revokeError when the response carries an errors body", async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse("Cannot revoke."));
      const { revokeError, revokeToken } = useApiTokens();
      await revokeToken("uuid-1");
      expect(revokeError.value).toBe("Cannot revoke.");
    });

    it("sets revokeError when $fetch throws", async () => {
      mockFetch.mockRejectedValueOnce({
        data: { errors: [{ detail: "Not found." }] },
      });
      const { revokeError, revokeToken } = useApiTokens();
      await revokeToken("uuid-1");
      expect(revokeError.value).toBe("Not found.");
    });

    it("does not remove the token from the list when revoke fails", async () => {
      mockFetch
        .mockResolvedValueOnce(makeListResponse())
        .mockRejectedValueOnce(new Error("network error"));
      const { tokens, loadTokens, revokeToken } = useApiTokens();
      await loadTokens();
      await revokeToken("uuid-1");
      expect(tokens.value).toHaveLength(1);
    });

    it("does not start a second concurrent revoke", async () => {
      let resolveFirst!: () => void;
      mockFetch.mockImplementationOnce(
        () =>
          new Promise<unknown>((resolve) => {
            resolveFirst = () => resolve({ data: null });
          }),
      );

      const { revokeToken } = useApiTokens();
      const firstRevoke = revokeToken("uuid-1");
      const secondRevoke = revokeToken("uuid-1");

      resolveFirst();
      await Promise.all([firstRevoke, secondRevoke]);

      expect(mockFetch).toHaveBeenCalledOnce();
    });
  });

  describe("clearRevealedToken", () => {
    it("resets revealedToken to empty string", async () => {
      mockFetch
        .mockResolvedValueOnce(makeMintResponse("mp_live_xyz")) // gitleaks:allow
        .mockResolvedValueOnce(makeListResponse());
      const { revealedToken, mintToken, clearRevealedToken } = useApiTokens();
      await mintToken("my-token");
      expect(revealedToken.value).toBe("mp_live_xyz");
      clearRevealedToken();
      expect(revealedToken.value).toBe("");
    });

    it("resets revealedTokenExpiresAt to null", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeMintResponse("mp_live_xyz", "2026-09-25T00:00:00.000Z"), // gitleaks:allow
        )
        .mockResolvedValueOnce(makeListResponse());
      const { revealedTokenExpiresAt, mintToken, clearRevealedToken } =
        useApiTokens();
      await mintToken("my-token", 90);
      expect(revealedTokenExpiresAt.value).not.toBeNull();
      clearRevealedToken();
      expect(revealedTokenExpiresAt.value).toBeNull();
    });
  });

  describe("revealedTokenExpiresAt", () => {
    it("deserializes the minted token's expiresAt to a Date", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeMintResponse("mp_live_abc", "2026-09-25T00:00:00.000Z"), // gitleaks:allow
        )
        .mockResolvedValueOnce(makeListResponse());
      const { revealedTokenExpiresAt, mintToken } = useApiTokens();
      await mintToken("my-token", 90);
      expect(revealedTokenExpiresAt.value).toBeInstanceOf(Date);
      expect(revealedTokenExpiresAt.value?.toISOString()).toBe(
        "2026-09-25T00:00:00.000Z",
      );
    });

    it("is null when the minted token has no expiry", async () => {
      mockFetch
        .mockResolvedValueOnce(makeMintResponse("mp_live_abc")) // gitleaks:allow
        .mockResolvedValueOnce(makeListResponse());
      const { revealedTokenExpiresAt, mintToken } = useApiTokens();
      await mintToken("my-token");
      expect(revealedTokenExpiresAt.value).toBeNull();
    });
  });
});
