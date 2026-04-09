import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  clearPendingPaidIntelPaymentState,
  loadPendingPaidIntelPaymentState,
  resolvePendingPaymentStatePath,
  savePendingPaidIntelPaymentState,
} from "./paid-intel-state.ts";

describe("paid intel pending payment state", () => {
  it("resolves a deterministic state path per sender and URL", () => {
    const outputDir = path.join(os.tmpdir(), "mx-alpha-state-test");
    const resolvedPath = resolvePendingPaymentStatePath({
      sender: "erd1sender",
      url: "http://localhost:3100/intel/wallet-profile?address=erd1wallet",
      outputDir,
    });

    expect(resolvedPath).toBe(
      path.join(outputDir, "wallet-profile-04d4a2de3323d1b5.json"),
    );
  });

  it("writes, loads, and clears a pending payment state file", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "mx-alpha-state-"));
    const statePath = resolvePendingPaymentStatePath({
      sender: "erd1sender",
      url: "http://localhost:3100/intel/wallet-profile?address=erd1wallet",
      outputDir,
    });

    const savedState = await savePendingPaidIntelPaymentState({
      statePath,
      sender: "erd1sender",
      url: "http://localhost:3100/intel/wallet-profile?address=erd1wallet",
      txHash: "tx-hash-123",
      credential: "Payment credential-value",
      chainId: "D",
      now: new Date("2026-04-07T10:00:00.000Z"),
    });

    expect(savedState).toEqual({
      schemaVersion: 1,
      kind: "paid-intel-pending-payment",
      sender: "erd1sender",
      url: "http://localhost:3100/intel/wallet-profile?address=erd1wallet",
      txHash: "tx-hash-123",
      credential: "Payment credential-value",
      chainId: "D",
      createdAt: "2026-04-07T10:00:00.000Z",
      updatedAt: "2026-04-07T10:00:00.000Z",
    });

    const loadedState = await loadPendingPaidIntelPaymentState(statePath);
    expect(loadedState).toEqual(savedState);

    await clearPendingPaidIntelPaymentState(statePath);

    await expect(stat(statePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      loadPendingPaidIntelPaymentState(statePath),
    ).resolves.toBeUndefined();
  });

  it("preserves the original createdAt value when updating an existing state file", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "mx-alpha-state-"));
    const statePath = path.join(outputDir, "resume.json");

    await savePendingPaidIntelPaymentState({
      statePath,
      sender: "erd1sender",
      url: "http://localhost:3100/intel/token-risk?token=XMEX-abc123",
      txHash: "tx-hash-123",
      credential: "Payment credential-value",
      now: new Date("2026-04-07T10:00:00.000Z"),
    });

    const updatedState = await savePendingPaidIntelPaymentState({
      statePath,
      sender: "erd1sender",
      url: "http://localhost:3100/intel/token-risk?token=XMEX-abc123",
      txHash: "tx-hash-124",
      credential: "Payment credential-next",
      now: new Date("2026-04-07T10:05:00.000Z"),
    });

    expect(updatedState.createdAt).toBe("2026-04-07T10:00:00.000Z");
    expect(updatedState.updatedAt).toBe("2026-04-07T10:05:00.000Z");
    expect(updatedState.txHash).toBe("tx-hash-124");
  });
});
