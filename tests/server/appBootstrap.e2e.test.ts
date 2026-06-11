import { spawn, type ChildProcess } from "child_process";
import { mkdtemp, rm } from "fs/promises";
import { createServer } from "http";
import path from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it } from "vitest";
import { requestJson } from "./helpers/http";

async function getAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate a port"));
        return;
      }

      const { port } = address;
      probe.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    probe.on("error", reject);
  });
}

async function waitForUrl(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the app is ready or the timeout expires.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for ${url}`);
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGTERM");

  await Promise.race([
    new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
    }),
    new Promise<void>((resolve) => {
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
        resolve();
      }, 2_000);
    }),
  ]);
}

function buildTestPublishableKey(frontendApi: string): string {
  return `pk_test_${Buffer.from(`${frontendApi}$`).toString("base64")}`;
}

describe("full app bootstrap smoke", () => {
  const tempDirs: string[] = [];
  const children: ChildProcess[] = [];

  afterEach(async () => {
    while (children.length > 0) {
      const child = children.pop();
      if (child) {
        await stopProcess(child);
      }
    }

    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it("boots the real app against an isolated data directory and serves core routes", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "scholarmark-e2e-"));
    const port = await getAvailablePort();
    tempDirs.push(tempDir);

    const repoRoot = process.cwd();
    const wrapper = `(async () => {
      process.chdir(${JSON.stringify(tempDir)});
      await import('./server/index.ts');
    })().catch((error) => {
      console.error(error);
      process.exit(1);
    });`;

    const child = spawn(
      process.execPath,
      [path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"), "-e", wrapper],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          NODE_ENV: "development",
          PORT: String(port),
          CLERK_PUBLISHABLE_KEY: buildTestPublishableKey("clerk.testing.dev"),
          CLERK_SECRET_KEY: "sk_test_dummy",
          IBOLT_INTERNAL_AUTH_BYPASS: "true",
          ENABLE_LEGACY_SCHOLARMARK: "false",
          VITE_ENABLE_LEGACY_SCHOLARMARK: "false",
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    children.push(child);

    let startupLog = "";
    let earlyExitMessage: string | null = null;
    child.stdout?.on("data", (chunk) => {
      startupLog += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      startupLog += String(chunk);
    });

    child.once("exit", (code) => {
      if (code && code !== 0) {
        earlyExitMessage = `App exited before readiness check.\n${startupLog}`;
      }
    });

    await waitForUrl(`http://127.0.0.1:${port}/api/blog/company`);
    expect(earlyExitMessage).toBeNull();

    const companies = await requestJson<unknown[]>(
      `http://127.0.0.1:${port}`,
      "/api/blog/company"
    );
    const legacyStatus = await requestJson<Record<string, unknown>>(
      `http://127.0.0.1:${port}`,
      "/api/system/status"
    );
    const blogHealth = await requestJson<Record<string, unknown>>(
      `http://127.0.0.1:${port}`,
      "/api/blog/health"
    );
    const malformed = await requestJson<Record<string, unknown>>(
      `http://127.0.0.1:${port}`,
      "/%E0%A4%A"
    );
    const pricingResponse = await fetch(`http://127.0.0.1:${port}/pricing`);
    const pricingHtml = await pricingResponse.text();

    expect(companies.status).toBe(200);
    expect(Array.isArray(companies.body)).toBe(true);
    expect(legacyStatus.status).toBe(404);
    expect(legacyStatus.body).toMatchObject({
      message: "Legacy ScholarMark API disabled in standalone blog deployment",
      path: "/api/system/status",
    });
    expect(blogHealth.status).toBe(200);
    expect(blogHealth.body).toMatchObject({
      ok: true,
      product: "standalone-blog-writer",
      legacyScholarMarkEnabled: false,
    });

    expect(malformed.status).toBe(400);
    expect(malformed.body).toEqual({ message: "Malformed URI sequence" });

    expect(pricingResponse.status).toBe(200);
    expect(pricingResponse.headers.get("content-type")).toContain("text/html");
    expect(pricingHtml).toContain('<div id="root"></div>');
    expect(pricingHtml).toContain('/src/main.tsx');
  }, 45_000);
});
