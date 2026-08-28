import { describe, it, expect } from "vitest";
import { fmtXlm, short, statusOf, friendlyError, expiryText } from "./lib.js";

describe("fmtXlm", () => {
  it("converts stroops to XLM", () => {
    expect(fmtXlm(100000000n)).toBe("10");
    expect(fmtXlm("30000000")).toBe("3");
    expect(fmtXlm(12345678)).toBe("1.23");
  });
});

describe("short", () => {
  it("abbreviates a public key", () => {
    expect(short("GAJG2CTQGG5WAOQNEEYJNRMXFZ3BHLAGACFCTOGXQQ44UZDUCBX4WJHV")).toBe("GAJG…WJHV");
  });
});

describe("statusOf", () => {
  it("maps numeric contract status to a label", () => {
    expect(statusOf({ status: 0 })).toBe("Pending");
    expect(statusOf({ status: 1 })).toBe("Claimed");
    expect(statusOf({ status: 2 })).toBe("Refunded");
  });
  it("passes through symbolic statuses", () => {
    expect(statusOf({ status: "Claimed" })).toBe("Claimed");
  });
});

describe("friendlyError", () => {
  it("maps every contract error code to a readable message", () => {
    for (const code of [1, 2, 3, 4, 5, 6]) {
      const msg = friendlyError(new Error(`host: Error(Contract, #${code})`));
      expect(msg).not.toContain("Error(Contract");
      expect(msg.length).toBeGreaterThan(10);
    }
  });
  it("detects underfunded balances", () => {
    expect(friendlyError(new Error("tx failed: account underfunded"))).toContain("Not enough XLM");
  });
  it("falls back to the raw message", () => {
    expect(friendlyError(new Error("boom"))).toBe("boom");
  });
});

describe("expiryText", () => {
  const t = { expiry_ledger: 1000 };
  it("says expired once the ledger passed", () => {
    expect(expiryText(t, 1001)).toBe("expired");
  });
  it("estimates minutes and hours from ledger distance", () => {
    expect(expiryText(t, 988)).toBe("≈1m left"); // 12 ledger × 5s
    expect(expiryText({ expiry_ledger: 17280 }, 0)).toBe(""); // belum tahu ledger terkini
    expect(expiryText({ expiry_ledger: 1720 }, 1000)).toBe("≈1h 0m left");
  });
  it("switches to days for long windows", () => {
    expect(expiryText({ expiry_ledger: 120960 + 1000 }, 1000)).toBe("≈7 days left");
  });
});
