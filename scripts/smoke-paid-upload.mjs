import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const facilitatorDir = path.join(repoRoot, "mpp-facilitator-mvx");
const sdkDir = path.join(repoRoot, "mppx-multiversx");

async function main() {
  const pemPath = requireEnv("MX_SMOKE_PEM_PATH");
  const resourceAddress = requireEnv("MX_SMOKE_RESOURCE_ADDRESS");
  const recipient = requireEnv("MX_SMOKE_RECIPIENT");
  const port = process.env.MX_SMOKE_PORT || "3310";
  const baseUrl = `http://localhost:${port}`;
  const chainId = process.env.MX_SMOKE_CHAIN_ID || "D";
  const currency = process.env.MX_SMOKE_DEFAULT_CURRENCY || "EGLD";
  const facilitatorTimeoutMs = parseIntegerEnv(
    "MX_SMOKE_FACILITATOR_TIMEOUT_MS",
    90000,
  );
  const smokeTimeoutMs = parseIntegerEnv("MX_SMOKE_TIMEOUT_MS", 300000);
  const retryDelayMs = parseIntegerEnv("MX_SMOKE_RETRY_DELAY_MS", 10000);
  const settlementTimeoutMs = parseIntegerEnv(
    "MX_SMOKE_SETTLEMENT_TIMEOUT_MS",
    45000,
  );
  const keepArtifacts = process.env.MX_SMOKE_KEEP_ARTIFACTS === "true";
  const artifactsDir =
    process.env.MX_SMOKE_ARTIFACTS_DIR ??
    (await mkdtemp(path.join(os.tmpdir(), "mx-alpha-smoke-")));
  const reportDir =
    process.env.MX_SMOKE_REPORT_DIR ?? path.join(artifactsDir, "reports");
  const stateFile =
    process.env.MX_SMOKE_STATE_FILE ??
    path.join(artifactsDir, "paid-intel-state.json");
  const databaseUrl =
    process.env.MX_SMOKE_DATABASE_URL ??
    `file:${path.join(artifactsDir, "facilitator-smoke.db")}`;

  await mkdir(reportDir, { recursive: true });

  const facilitator = spawn("npm", ["run", "start"], {
    cwd: facilitatorDir,
    env: {
      ...process.env,
      PORT: port,
      DATABASE_URL: databaseUrl,
      MPP_SECRET_KEY:
        process.env.MX_SMOKE_SECRET_KEY || "mx-alpha-smoke-secret",
      MPP_RECIPIENT: recipient,
      MPP_DEFAULT_CURRENCY: currency,
      MPP_CHAIN_ID: chainId,
      MPP_TOKEN_DECIMALS: process.env.MX_SMOKE_TOKEN_DECIMALS || "18",
      ...(process.env.MX_SMOKE_WEGLD_SWAP_ADDRESS
        ? { MPP_WEGLD_SWAP_ADDRESS: process.env.MX_SMOKE_WEGLD_SWAP_ADDRESS }
        : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let facilitatorLogs = "";
  facilitator.stdout.on("data", (chunk) => {
    facilitatorLogs += chunk.toString();
  });
  facilitator.stderr.on("data", (chunk) => {
    facilitatorLogs += chunk.toString();
  });

  try {
    await waitForHealth(baseUrl, facilitatorTimeoutMs);

    const startedAt = Date.now();
    let attempts = 0;
    let lastPayload = null;

    while (Date.now() - startedAt < smokeTimeoutMs) {
      attempts += 1;

      const run = await runPaidIntelExample({
        sdkDir,
        pemPath,
        baseUrl,
        resourceAddress,
        reportDir,
        stateFile,
        settlementTimeoutMs,
      });
      lastPayload = run.payload;

      if (
        run.payload?.paymentPendingError ||
        shouldRetryTransientSmokeFailure(run.payload)
      ) {
        await sleep(retryDelayMs);
        continue;
      }

      if (
        run.payload?.paymentError ||
        run.payload?.genericError ||
        run.payload?.uploadError
      ) {
        throw new Error(
          `Smoke run failed: ${JSON.stringify(run.payload, null, 2)}\n` +
            `Facilitator logs:\n${facilitatorLogs || "<no logs captured>"}`,
        );
      }

      if (!run.payload?.txHash) {
        throw new Error(
          `Smoke run completed without a payment tx hash.\n${JSON.stringify(run.payload, null, 2)}`,
        );
      }

      const txHash = String(run.payload.txHash);
      const uploadedReport = await fetchJson(
        `${baseUrl}/audit-reports/by-payment/${txHash}`,
      );
      const summary = await fetchJson(
        `${baseUrl}/audit-reports/summary?paymentTxHash=${txHash}`,
      );

      console.log(
        JSON.stringify(
          {
            status: "success",
            attempts,
            txHash,
            reportId: uploadedReport.id,
            reportStatus: uploadedReport.status,
            reportPath: run.payload.reportPath ?? null,
            summaryTotals: summary.totals,
          },
          null,
          2,
        ),
      );
      return;
    }

    throw new Error(
      `Smoke run timed out after ${smokeTimeoutMs}ms.\n` +
        `Last payload: ${JSON.stringify(lastPayload, null, 2)}\n` +
        `Facilitator logs:\n${facilitatorLogs || "<no logs captured>"}`,
    );
  } finally {
    await stopChildProcess(facilitator);
    if (!keepArtifacts && !process.env.MX_SMOKE_ARTIFACTS_DIR) {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }
}

async function runPaidIntelExample(parameters) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      [
        "tsx",
        "examples/paid-intel.ts",
        "wallet-profile",
        parameters.resourceAddress,
      ],
      {
        cwd: parameters.sdkDir,
        env: {
          ...process.env,
          MX_PEM_PATH: parameters.pemPath,
          MX_INTEL_BASE_URL: parameters.baseUrl,
          MX_SETTLEMENT_TIMEOUT_MS: String(parameters.settlementTimeoutMs),
          MX_REPORT_DIR: parameters.reportDir,
          MX_UPLOAD_AUDIT_REPORT: "true",
          MX_PAYMENT_STATE_FILE: parameters.stateFile,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const payload = tryParseJson(stdout.trim());
      if (!payload) {
        reject(
          new Error(
            `Unable to parse paid-intel example output.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
          ),
        );
        return;
      }

      resolve({
        code: code ?? 1,
        payload,
        stdout,
        stderr,
      });
    });
  });
}

async function waitForHealth(baseUrl, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/openapi.json`);
      if (response.ok) {
        return;
      }
    } catch {}

    await sleep(2000);
  }

  throw new Error(`Facilitator did not become ready within ${timeoutMs}ms`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Request to ${url} failed with ${response.status}: ${body}`,
    );
  }

  return response.json();
}

function tryParseJson(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function shouldRetryTransientSmokeFailure(payload) {
  const message = payload?.genericError?.message;
  if (typeof message !== "string") {
    return false;
  }

  if (payload?.txHash) {
    return false;
  }

  return (
    message.includes("[network/config]") ||
    message.includes("timeout of 5000ms exceeded") ||
    message.includes("fetch failed")
  );
}

async function stopChildProcess(child) {
  if (!child.pid) {
    return;
  }

  const descendantPids = await listDescendantPids(child.pid);
  const allPids = [child.pid, ...descendantPids];

  for (const pid of [...allPids].reverse()) {
    killPid(pid, "SIGTERM");
  }

  const exited = await waitForPidsToExit(allPids, 5000);
  if (!exited) {
    for (const pid of [...allPids].reverse()) {
      killPid(pid, "SIGKILL");
    }
    await waitForPidsToExit(allPids, 5000);
  }
}

async function listDescendantPids(rootPid) {
  const { stdout } = await execFileAsync("ps", ["-Ao", "pid=,ppid="]);
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const childrenByParent = new Map();
  for (const line of lines) {
    const [pidText, ppidText] = line.split(/\s+/);
    const pid = Number.parseInt(pidText, 10);
    const ppid = Number.parseInt(ppidText, 10);
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) {
      continue;
    }

    const existing = childrenByParent.get(ppid) ?? [];
    existing.push(pid);
    childrenByParent.set(ppid, existing);
  }

  const descendants = [];
  const stack = [...(childrenByParent.get(rootPid) ?? [])];
  while (stack.length > 0) {
    const pid = stack.pop();
    if (pid === undefined) {
      continue;
    }

    descendants.push(pid);
    stack.push(...(childrenByParent.get(pid) ?? []));
  }

  return descendants;
}

async function waitForPidsToExit(pids, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (pids.every((pid) => !isProcessAlive(pid))) {
      return true;
    }

    await sleep(200);
  }

  return pids.every((pid) => !isProcessAlive(pid));
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killPid(pid, signal) {
  try {
    process.kill(pid, signal);
  } catch {}
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseIntegerEnv(name, fallback) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be an integer, received "${value}"`);
  }

  return parsed;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
