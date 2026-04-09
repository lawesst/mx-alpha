import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type PendingPaidIntelPaymentState = {
  schemaVersion: 1;
  kind: "paid-intel-pending-payment";
  sender: string;
  url: string;
  txHash: string;
  credential: string;
  chainId?: string;
  createdAt: string;
  updatedAt: string;
};

export function resolvePendingPaymentStatePath(parameters: {
  sender: string;
  url: string;
  outputDir?: string;
  outputFile?: string;
}): string {
  if (parameters.outputFile) {
    return parameters.outputFile;
  }

  const outputDir =
    parameters.outputDir ?? path.join(process.cwd(), ".paid-intel-state");
  const urlObject = new URL(parameters.url);
  const endpoint =
    urlObject.pathname.split("/").filter(Boolean).at(-1)?.toLowerCase() ||
    "request";
  const requestHash = createHash("sha256")
    .update(`${parameters.sender}:${parameters.url}`)
    .digest("hex")
    .slice(0, 16);

  return path.join(outputDir, `${endpoint}-${requestHash}.json`);
}

export async function loadPendingPaidIntelPaymentState(
  statePath: string,
): Promise<PendingPaidIntelPaymentState | undefined> {
  try {
    const raw = await readFile(statePath, "utf8");
    return parsePendingPaidIntelPaymentState(JSON.parse(raw) as unknown);
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw error;
  }
}

export async function savePendingPaidIntelPaymentState(parameters: {
  statePath: string;
  sender: string;
  url: string;
  txHash: string;
  credential: string;
  chainId?: string;
  now?: Date;
}): Promise<PendingPaidIntelPaymentState> {
  const existing = await loadPendingPaidIntelPaymentState(parameters.statePath);
  const timestamp = (parameters.now ?? new Date()).toISOString();
  const state: PendingPaidIntelPaymentState = {
    schemaVersion: 1,
    kind: "paid-intel-pending-payment",
    sender: parameters.sender,
    url: parameters.url,
    txHash: parameters.txHash,
    credential: parameters.credential,
    ...(parameters.chainId ? { chainId: parameters.chainId } : {}),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };

  await mkdir(path.dirname(parameters.statePath), { recursive: true });
  await writeFile(
    parameters.statePath,
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8",
  );

  return state;
}

export async function clearPendingPaidIntelPaymentState(
  statePath: string,
): Promise<void> {
  try {
    await rm(statePath);
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }
}

function parsePendingPaidIntelPaymentState(
  value: unknown,
): PendingPaidIntelPaymentState {
  if (!value || typeof value !== "object") {
    throw new Error("Pending payment state must be an object.");
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1) {
    throw new Error("Pending payment state has an unsupported schemaVersion.");
  }
  if (candidate.kind !== "paid-intel-pending-payment") {
    throw new Error("Pending payment state has an unsupported kind.");
  }
  if (typeof candidate.sender !== "string" || candidate.sender.length === 0) {
    throw new Error("Pending payment state is missing a valid sender.");
  }
  if (typeof candidate.url !== "string" || candidate.url.length === 0) {
    throw new Error("Pending payment state is missing a valid url.");
  }
  if (typeof candidate.txHash !== "string" || candidate.txHash.length === 0) {
    throw new Error("Pending payment state is missing a valid txHash.");
  }
  if (
    typeof candidate.credential !== "string" ||
    candidate.credential.length === 0
  ) {
    throw new Error("Pending payment state is missing a valid credential.");
  }
  if (
    candidate.chainId !== undefined &&
    (typeof candidate.chainId !== "string" || candidate.chainId.length === 0)
  ) {
    throw new Error("Pending payment state has an invalid chainId.");
  }
  if (
    typeof candidate.createdAt !== "string" ||
    typeof candidate.updatedAt !== "string"
  ) {
    throw new Error("Pending payment state is missing timestamps.");
  }

  return candidate as PendingPaidIntelPaymentState;
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
