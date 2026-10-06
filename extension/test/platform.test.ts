import { describe, expect, test } from "bun:test";

import { classifyPlatform, detectPlatform, platformQuestionContext } from "../src/lib/platform";

describe("classifyPlatform", () => {
  test("windows UA", () => {
    expect(
      classifyPlatform(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      ),
    ).toBe("windows");
  });

  test("macOS UA", () => {
    expect(
      classifyPlatform(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
      ),
    ).toBe("macos");
  });

  test("linux UA", () => {
    expect(
      classifyPlatform("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120"),
    ).toBe("linux");
  });

  test("android wins over linux", () => {
    expect(
      classifyPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36"),
    ).toBe("android");
  });

  test("iPad wins over macOS", () => {
    expect(
      classifyPlatform(
        "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      ),
    ).toBe("ios");
  });

  test("chromeos", () => {
    expect(classifyPlatform("Mozilla/5.0 (X11; CrOS x86_64 14541) Chrome/120")).toBe(
      "chromeos",
    );
  });

  test("unknown", () => {
    expect(classifyPlatform("SomethingElse/1.0")).toBe("other");
  });
});

describe("detectPlatform", () => {
  test("uses userAgentData platform first", () => {
    const nav = {
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
      userAgentData: { platform: "Windows" },
    } as unknown as Navigator;
    const product = detectPlatform(nav);
    expect(product.id).toBe("windows");
    expect(product.shell).toBe("powershell");
  });

  test("phrases the platform context for Android", () => {
    const product = detectPlatform({
      platform: "Linux armv8l",
      userAgent: "Mozilla/5.0 (Linux; Android 14)",
    } as unknown as Navigator);
    expect(product.id).toBe("android");
    expect(platformQuestionContext(product)).toContain("Android");
  });
});
