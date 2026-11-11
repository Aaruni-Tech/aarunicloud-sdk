#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function processOneOutboundJob(cloud, { service = "AVA", avgsUrl = "http://127.0.0.1:8766" } = {}) {
  const pulled = await cloud.compute.pullNext({ service });
  if (!pulled.job) return null;

  const job = pulled.job;
  console.log(`⚡ [Outbound Worker] Claimed ${job.service} job ${job.jobId} (${job.action})`);

  try {
    if (job.service === "AVA" && job.action === "synthesize_mlx") {
      const p = job.payload || {};
      const avgsRes = await fetch(`${avgsUrl.replace(/\/+$/, "")}/api/v1/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: p.normalizedText || p.originalText || "",
          clipId: job.jobId,
          chunkIndex: 1,
          speed: Number(p.speed || 0.94),
          steps: Number(p.steps || 32),
          clarityBoost: true,
          style: p.style || "auto"
        })
      });
      const avgsJson = await avgsRes.json();
      if (!avgsRes.ok || !avgsJson.ok) {
        throw new Error(avgsJson.error || `Local MLX AVGS HTTP ${avgsRes.status}`);
      }
      if (!avgsJson.mp3Path || !fs.existsSync(avgsJson.mp3Path)) {
        throw new Error(`Generated MP3 not found at ${avgsJson.mp3Path}`);
      }

      const audioSpace = "voice-studio";
      const audioKey = `${job.jobId}.mp3`;
      const up = await cloud.storage.upload(avgsJson.mp3Path, {
        space: audioSpace,
        key: audioKey,
        contentType: "audio/mpeg"
      });

      const resultPayload = {
        acsUri: `acs://${audioSpace}/${audioKey}`,
        space: audioSpace,
        key: audioKey,
        sizeBytes: up.sizeBytes,
        sha256: up.sha256,
        durationSec: avgsJson.durationSec,
        rmsDb: avgsJson.rmsDb,
        peakDb: avgsJson.peakDb,
        engine: avgsJson.engine,
        elapsedSec: avgsJson.elapsedSec
      };
      await cloud.jobs.complete(job.jobId, { status: "COMPLETED", result: resultPayload });
      console.log(`✔ [Outbound Worker] Completed ${job.jobId} -> ${resultPayload.acsUri} (${avgsJson.durationSec}s, RMS ${avgsJson.rmsDb} dBFS)`);
      return { jobId: job.jobId, status: "COMPLETED", result: resultPayload };
    }

    throw new Error(`Unsupported worker action: ${job.service}/${job.action}`);
  } catch (err) {
    await cloud.jobs.complete(job.jobId, { status: "FAILED", result: { error: err.message } }).catch(() => {});
    throw err;
  }
}

function printHelp() {
  console.log(`
⚡ Aaruni Cloud CLI v1.1.0 (https://aarunicloud.com)
Usage: aaruni <service> [command] [--flags]

Commands:
  aaruni login --api-key <key>                         Save private Aaruni Guard key (~/.aaruni/credentials.json)
  aaruni status                                        Live control-plane & Zero-Trust posture
  aaruni services                                      List all 11 Aaruni Cloud services
  aaruni storage ls [--space production-media]         List files in an Aaruni Storage (ACS) space
  aaruni storage upload <file> [--space ...]           Upload file to Aaruni Storage ($0 egress)
  aaruni storage download <key> [out] [--space ...]    Download file with SHA-256 verification
  aaruni archive seal --space <s_name> --key <file>    Seal file in read-only Aaruni Archive (ARC)
  aaruni compute nodes                                 List active Aaruni Compute (ACC) nodes
  aaruni compute launch [--type acc.m4.max]            Queue job on Aaruni Compute (ACC)
  aaruni containers run [--image xvfb-1080p-worker]    Queue isolated Aaruni Containers (ACN) job
  aaruni voice synthesize "<text>" [--engine mlx] [--out out.mp3]
                                                       W3C PLS + Apple Silicon MLX voice synthesis (AVA)
  aaruni worker start [--service AVA]                  Start air-gapped outbound worker bridge (0 inbound ports)
  aaruni worker once [--service AVA]                   Claim & execute 1 queued job outbound then exit
  aaruni assistant ask "<prompt>"                      Execute multi-intent Aaruni Assistant (AAI)
  aaruni knowledge search "<keywords>"                 Search Aaruni Knowledge (AKB) RAG index
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

  if (svc === "login") {
    const key = flags["api-key"] || arg1;
    if (!key) throw new Error("Usage: aaruni login --api-key <your_agd_live_key>");
    const dir = path.join(os.homedir(), ".aaruni");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const credFile = path.join(dir, "credentials.json");
    const payload = {
      endpoint: flags.endpoint || "https://api.aarunicloud.com",
      region: flags.region || "ap-south-hyd-1",
      api_key: key,
      saved_at: new Date().toISOString()
    };
    fs.writeFileSync(credFile, JSON.stringify(payload, null, 2), { mode: 0o600 });
    fs.chmodSync(credFile, 0o600);
    console.log(`🔒 Saved private Aaruni Guard credentials to ${credFile} (chmod 600).`);
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

  if (svc === "worker") {
    const service = (flags.service || "AVA").toUpperCase();
    const avgsUrl = flags.avgs || "http://127.0.0.1:8766";
    if (sub === "once") {
      const done = await processOneOutboundJob(cloud, { service, avgsUrl });
      if (!done) console.log(`No queued ${service} jobs waiting.`);
      return;
    }
    console.log(`🛡️ Aaruni Outbound Air-Gapped Worker started (Service: ${service}, Local MLX: ${avgsUrl}, Inbound Ports: 0)`);
    while (true) {
      try {
        const done = await processOneOutboundJob(cloud, { service, avgsUrl });
        if (!done) await sleep(2000);
      } catch (e) {
        console.error(`⚠ Worker cycle error: ${e.message}`);
        await sleep(3000);
      }
    }
  }

  if (svc === "storage") {
    const space = flags.space || "production-media";
    if (!sub || sub === "ls" || sub === "list") {
      const res = await cloud.storage.list(space);
      console.log(`📦 Aaruni Storage (ACS) • Space: acs://${res.space} (${res.count} items, Egress: $0.00)`);
      console.log(JSON.stringify(res.items, null, 2));
      return;
    }
    if (sub === "upload" || sub === "put" || sub === "sync") {
      const target = arg1 || flags.file;
      if (!target) throw new Error("Usage: aaruni storage upload <file> [--space production-media] [--key custom-name]");
      const res = await cloud.storage.upload(target, { space, key: flags.key, contentType: flags["content-type"] });
      console.log(`✔ Uploaded to acs://${res.space}/${res.key} (${res.sizeBytes} bytes, SHA256: ${res.sha256.slice(0, 16)}...)`);
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    if (sub === "download" || sub === "get") {
      const key = arg1 || flags.key;
      if (!key) throw new Error("Usage: aaruni storage download <key> [output-path] [--space production-media]");
      const res = await cloud.storage.download(key, { space });
      const outPath = arg2 || flags.out;
      if (outPath) {
        fs.writeFileSync(outPath, res.bytes);
        console.log(`✔ Downloaded ${res.bytes.length} bytes to ${outPath} (SHA256: ${res.sha256})`);
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
    const res = await cloud.archive.seal({ space: flags.space || "production-media", key: flags.key || arg1 });
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
        type: flags.type || flags.profile || "acc.m4.max",
        storage: flags.storage || "acs://production-media",
        region: flags.region || cloud.region
      });
      console.log(`🚀 Queued Aaruni Compute Job ${res.jobId} (${res.executionMode})`);
      console.log(JSON.stringify(res, null, 2));
      return;
    }
  }

  if (svc === "containers" && sub === "run") {
    const res = await cloud.containers.run({ image: flags.image || arg1 || "xvfb-1080p-worker" });
    console.log(`🐳 Queued Aaruni Containers Job ${res.jobId}`);
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (svc === "voice" && (!sub || sub === "synthesize")) {
    const text = flags.text || positional.slice(sub === "synthesize" ? 2 : 1).join(" ");
    if (!text) throw new Error('Usage: aaruni voice synthesize "Hello world" [--engine mlx] [--out speech.mp3]');
    const engine = flags.engine || (flags.out ? "mlx" : undefined);
    const res = await cloud.voice.synthesize({
      text,
      persona: flags.persona || "aria",
      targetLufs: Number(flags["target-lufs"] || flags.lufs || -12),
      engine,
      speed: flags.speed ? Number(flags.speed) : undefined,
      steps: flags.steps ? Number(flags.steps) : undefined,
      style: flags.style
    });

    if (res.mode === "QUEUED_MLX_NEURAL_WORKER") {
      console.log(`🎙️ Queued Aaruni Voice MLX Job ${res.jobId} (W3C PLS: "${res.normalizedText}")`);
      const avgsUrl = flags.avgs || "http://127.0.0.1:8766";
      // If local MLX server is reachable on loopback, fulfill outbound right away if no daemon claimed it yet
      try {
        const h = await fetch(`${avgsUrl}/api/v1/health`, { signal: AbortSignal.timeout(1500) });
        if (h.ok) {
          await processOneOutboundJob(cloud, { service: "AVA", avgsUrl });
        }
      } catch (_) {}

      // Poll job completion up to 90s
      for (let attempt = 0; attempt < 45; attempt++) {
        const j = await cloud.jobs.get(res.jobId);
        if (j.status === "COMPLETED" && j.result && j.result.key) {
          if (flags.out) {
            const dl = await cloud.storage.download(j.result.key, { space: j.result.space || "voice-studio" });
            fs.writeFileSync(flags.out, dl.bytes);
            console.log(`✔ Saved Studio MP3 to ${flags.out} (${dl.bytes.length} bytes, ${j.result.durationSec}s, RMS ${j.result.rmsDb} dBFS)`);
          }
          console.log(JSON.stringify(j, null, 2));
          return;
        }
        if (j.status === "FAILED") {
          throw new Error(`MLX Voice synthesis failed: ${JSON.stringify(j.result)}`);
        }
        await sleep(2000);
      }
      console.log(JSON.stringify(res, null, 2));
      return;
    }

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
    const q = flags.query || flags.q || positional.slice(sub === "search" ? 2 : 1).join(" ") || "";
    const res = await cloud.knowledge.search(q);
    console.log(`📚 Aaruni Knowledge (AKB) • ${res.count} Grounded Docs:`);
    console.log(JSON.stringify(res.results, null, 2));
    return;
  }

  if (svc === "render") {
    if (!sub || sub === "build") {
      const res = await cloud.render.build({
        timeline: flags.timeline || flags.project || arg1 || "lesson-01.cmproj",
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
