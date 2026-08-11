import { describe, expect, it } from "vitest";
import { resolveDrizzleDatabasePath } from "../../drizzle.config";

describe("Drizzle database path", () => {
  it("honors an explicit DATABASE_PATH", () => {
    expect(resolveDrizzleDatabasePath("./data/custom.db", () => false)).toBe("./data/custom.db");
  });

  it("uses the standalone database by default", () => {
    expect(resolveDrizzleDatabasePath(undefined, () => false)).toBe("./data/standalone-blog-writer.db");
  });

  it("falls back to a legacy database only when no standalone database exists", () => {
    expect(resolveDrizzleDatabasePath(undefined, (path) => path.endsWith("sourceannotator.db"))).toBe("./data/sourceannotator.db");
  });
});
