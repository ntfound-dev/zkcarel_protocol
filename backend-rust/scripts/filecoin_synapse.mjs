#!/usr/bin/env node
import { Synapse, RPC_URLS } from "@filoz/synapse-sdk";
import { privateKeyToAccount } from "viem/accounts";
import { TextDecoder, TextEncoder } from "node:util";

const mode = process.argv[2];
if (!mode || (mode !== "upload" && mode !== "download")) {
  console.error("Usage: node filecoin_synapse.mjs upload|download [cid]");
  process.exit(1);
}

const privateKey = process.env.SYNAPSE_PRIVATE_KEY;
if (!privateKey || privateKey.trim() === "") {
  console.error("SYNAPSE_PRIVATE_KEY is required");
  process.exit(1);
}

const rpcUrl =
  process.env.SYNAPSE_RPC_URL || RPC_URLS?.calibration?.websocket || "";
const withCDN =
  (process.env.SYNAPSE_WITH_CDN || "")
    .trim()
    .toLowerCase() === "true" ||
  (process.env.SYNAPSE_WITH_CDN || "").trim() === "1";
const source = (process.env.SYNAPSE_SOURCE || "").trim();
const MAX_STDIN_BYTES = Number(process.env.SYNAPSE_MAX_STDIN_BYTES || "10485760");

function normalizeCid(value) {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (typeof value.toString === "function") return value.toString();
  return String(value);
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      size += Buffer.byteLength(chunk, "utf8");
      if (Number.isFinite(MAX_STDIN_BYTES) && size > MAX_STDIN_BYTES) {
        reject(new Error("stdin payload exceeds size limit"));
        process.stdin.destroy();
        return;
      }
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function main() {
  const synapse = await Synapse.create({
    account: privateKeyToAccount(privateKey),
    ...(rpcUrl ? { rpcURL: rpcUrl } : {}),
    ...(withCDN ? { withCDN: true } : {}),
  });

  if (mode === "upload") {
    const input = await readStdin();
    if (!input || input.trim() === "") {
      throw new Error("Missing payload on stdin");
    }
    const bytes = new TextEncoder().encode(input);
    const result = await synapse.storage.upload(
      bytes,
      source ? { source } : undefined
    );
    const output = {
      pieceCid: normalizeCid(result?.pieceCid),
      dataCid: normalizeCid(result?.dataCid),
      payloadCid: normalizeCid(result?.payloadCid),
      cid: normalizeCid(result?.cid),
    };
    console.log(JSON.stringify(output));
    return;
  }

  const cid = process.argv[3];
  if (!cid || cid.trim() === "") {
    throw new Error("Missing CID argument for download");
  }
  const bytes = await synapse.storage.download(cid.trim());
  const text = new TextDecoder().decode(bytes);
  process.stdout.write(text);
}

main().catch((error) => {
  const message = error && error.message ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
