#!/usr/bin/env node
import fs from "node:fs";
import { AaruniCloud } from "../src/index.mjs";

function parseFlags(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function printHelp() {
  console.log(`
⚡ Aaruni Cloud CLI v1.0.0 (https://aarunicloud.com)
Usage: aaruni <service> [command] [--flags]

Commands:
  aaruni status                                        Live control-plane & metrics status
  aaruni services                                      List all 11 Aaruni Cloud services
  aaruni storage ls [--space sandbox]                  List files in an Aaruni Storage (ACS) space
  aaruni storage upload <file> [--space sandbox]       Upload file to Aaruni Storage ($0 egress)
  aaruni storage download <key> [out] [--space ...]    Download file with SHA-256 verification
  aaruni archive seal --space <s_name> --key <file>    Seal file in read-only Aaruni Archive (ARC)
  aaruni compute nodes                                 List active Aaruni Compute (ACC) nodes
  aaruni compute launch [--type acc.m4.max]            Launch job on Aaruni Compute (ACC)
  aaruni containers run [--image xvfb-1080p-worker]    Run isolated Aaruni Containers (ACN) job
  aaruni voice synthesize --text "..." [--lufs -12]    W3C PLS speech normalization & synthesis (AVA)
  aaruni assistant ask "<prompt>"                      Execute multi-intent Aaruni Assistant (AAI)
  aaruni knowledge search --query "<keywords>"         Search Aaruni Knowledge (AKB) RAG index
  aaruni render build [--timeline project.cmproj]      Queue 1080p build on Aaruni Render (ARN)
  aaruni qa audit [--url https://aarunicloud.com]      Run Aaruni Quality (AQA) audit check
  aaruni guard whoami                                  Inspect active Aaruni Guard (AGD) identity
  aaruni edge status                                   Inspect Aaruni Edge (AED) Anycast POP & TLS
`);
}

async function main() {
  const { positional, flags } = parseFlags(process.argv.slice(2));
  const [svc, sub, arg1, arg2] = positional;

  if (!svc || svc === "help" || flags.help) {
    printHelp();
    return;
  }

  const cloud = new AaruniCloud({
    endpoint: flags.endpoint,
    apiKey: flags["api-key"],
    region: flags.region
  });

  if (svc === "status") {
    const res = await cloud.status();
    console.log(`🟢 Aaruni Cloud (${res.status}) • Region: ${res.controlPlaneRegion} • Edge POP: ${res.edgePop}`);
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (svc === "services") {
    const res = await cloud.services();
    for (const s of res.services) {
      console.log(`  [${s.code}] ${s.name.padEnd(20)} -> ${s.endpoint}`);
    }
    return;
  }

  if (svc === "storage") {
    const space = flags.space || "sandbox";
    if (!sub || sub === "ls" || sub === "list") {
      const res = await cloud.storage.list(space);
      console.log(`📦 Aaruni Storage (ACS) • Space: acs://${res.space} (${res.count} items, Egress: $0.00)`);
      console.log(JSON.stringify(res.items, null, 2));
      return;
    }
    if (sub === "upload" || sub === "put" || sub === "sync") {
      const target = arg1 || flags.file;
      if (!target) throw new Error("Usage: aaruni storage upload <file> [--space sandbox] [--key custom-name]");
      const res = await cloud.storage.upload(target, { space, key: flags.key, contentType: flags["content-type"] });
      console.log(`✔ Uploaded to acs://${res.space}/${res.key} (${res.sizeBytes} bytes, SHA256: ${res.sha256.slice(0, 16)}...)`);
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    if (sub === "download" || sub === "get") {
      const key = arg1 || flags.key;
      if (!key) throw new Error("Usage: aaruni storage download <key> [output-path] [--space sandbox]");
      const res = await cloud.storage.download(key, { space });
      if (arg2) {
        fs.writeFileSync(arg2, res.bytes);
        console.log(`✔ Downloaded ${res.bytes.length} bytes to ${arg2} (SHA256: ${res.sha256})`);
      } else {
        process.stdout.write(res.bytes);
      }
      return;
    }
    if (sub === "rm" || sub === "delete") {
      const key = arg1 || flags.key;
      const res = await cloud.storage.delete(key, { space });
      console.log(JSON.stringify(res, null, 2));
      return;
    }
  }

  if (svc === "archive" && sub === "seal") {
    const res = await cloud.archive.seal({ space: flags.space || "sandbox", key: flags.key || arg1 });
    console.log(`🔒 Sealed in Aaruni Archive (ARC): ${res.sealId}`);
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (svc === "compute") {
    if (!sub || sub === "nodes" || sub === "list") {
      const res = await cloud.compute.nodes();
      console.log(`⚡ Aaruni Compute (ACC) • ${res.count} Active Nodes:`);
      console.log(JSON.stringify(res.nodes, null, 2));
      return;
    }
    if (sub === "launch") {
      const res = await cloud.compute.launch({
        type: flags.type || "acc.m4.max",
        storage: flags.storage || "acs://sandbox",
        region: flags.region || cloud.region
      });
      console.log(`🚀 Launched Aaruni Compute Job ${res.jobId} on ${res.assignedNode}`);
      console.log(JSON.stringify(res, null, 2));
      return;
    }
  }

  if (svc === "containers" && sub === "run") {
    const res = await cloud.containers.run({ image: flags.image || arg1 || "xvfb-1080p-worker" });
    console.log(`🐳 Started Aaruni Containers Job ${res.jobId}`);
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (svc === "voice" && (!sub || sub === "synthesize")) {
    const text = flags.text || arg1;
    if (!text) throw new Error('Usage: aaruni voice synthesize --text "Hello world" [--lufs -12]');
    const res = await cloud.voice.synthesize({
      text,
      persona: flags.persona || "aria",
      targetLufs: Number(flags["target-lufs"] || flags.lufs || -12)
    });
    console.log(`🎙️ Aaruni Voice (AVA) • Job ${res.jobId} • Normalized (${res.dsp.targetLoudnessLufs} dB LUFS):`);
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (svc === "assistant" && (!sub || sub === "ask")) {
    const prompt = flags.prompt || positional.slice(sub === "ask" ? 2 : 1).join(" ");
    if (!prompt) throw new Error('Usage: aaruni assistant ask "Check ACS storage and launch compute"');
    const res = await cloud.assistant.ask(prompt);
    console.log(`💬 Aaruni Assistant (AAI) • Verified Receipt ${res.receiptId}:`);
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (svc === "knowledge" && (!sub || sub === "search")) {
    const q = flags.query || flags.q || arg1 || "";
    const res = await cloud.knowledge.search(q);
    console.log(`📚 Aaruni Knowledge (AKB) • ${res.count} Grounded Docs:`);
    console.log(JSON.stringify(res.results, null, 2));
    return;
  }

  if (svc === "render") {
    if (!sub || sub === "build") {
      const res = await cloud.render.build({
        timeline: flags.timeline || arg1 || "lesson-01.cmproj",
        format: flags.format || "mp4",
        resolution: flags.resolution || "1920x1080"
      });
      console.log(`🎬 Queued Aaruni Render (ARN) Build ${res.jobId} -> ${res.outputUri}`);
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    if (sub === "job" || sub === "status") {
      const res = await cloud.render.job(arg1 || flags.id);
      console.log(JSON.stringify(res, null, 2));
      return;
    }
  }

  if (svc === "qa" && (!sub || sub === "audit")) {
    const res = await cloud.qa.audit({ url: flags.url || arg1 || "https://aarunicloud.com" });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (svc === "guard") {
    if (!sub || sub === "whoami") {
      console.log(JSON.stringify(await cloud.guard.whoami(), null, 2));
      return;
    }
    if (sub === "audit") {
      console.log(JSON.stringify(await cloud.guard.auditLogs(), null, 2));
      return;
    }
  }

  if (svc === "edge" && (!sub || sub === "status")) {
    console.log(JSON.stringify(await cloud.edge.status(), null, 2));
    return;
  }

  printHelp();
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(`✖ Aaruni CLI Error: ${err.message}`);
  process.exit(1);
});
