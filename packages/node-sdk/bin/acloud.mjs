#!/usr/bin/env node
import { execSync } from "node:child_process";
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

function isVoiceTrainingActiveOnGpu() {
  try {
    const out = execSync("pgrep -fl 'train_rupesh' || true", { encoding: "utf8" }).trim();
    return out.length > 0;
  } catch (_) {
    return false;
  }
}

function saveCredentials(key, endpoint = "https://api.aarunicloud.com", region = "ap-south-hyd-1") {
  const dir = path.join(os.homedir(), ".acloud");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const credFile = path.join(dir, "credentials.json");
  const payload = {
    endpoint,
    region,
    api_key: key,
    saved_at: new Date().toISOString()
  };
  fs.writeFileSync(credFile, JSON.stringify(payload, null, 2), { mode: 0o600 });
  fs.chmodSync(credFile, 0o600);
  return credFile;
}

async function processOneOutboundJob(cloud, { service = "VOICE", avgsUrl = "http://127.0.0.1:8766" } = {}) {
  // GPU-YIELD-GUARD: Never disturb active Apple Silicon MLX training!
  if (isVoiceTrainingActiveOnGpu()) {
    console.log("⏸ [GPU Yield Guard] Active voice model training detected — yielding 100% of Metal GPU (0 interference).");
    return null;
  }

  const pulled = await cloud.compute.pullNext({ service });
  if (!pulled.job) return null;

  const job = pulled.job;
  console.log(`⚡ [Outbound Worker] Claimed ${job.service} job ${job.jobId} (${job.action})`);

  try {
    if ((job.service === "AVA" || job.service === "VOICE") && job.action === "synthesize_mlx") {
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
        throw new Error(avgsJson.error || `Local MLX HTTP ${avgsRes.status}`);
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
        storageUri: `storage://${audioSpace}/${audioKey}`,
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
      console.log(`✔ [Outbound Worker] Completed ${job.jobId} -> ${resultPayload.storageUri}`);
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
☁️  Aaruni Cloud CLI (acloud v1.0.0) — https://console.aarunicloud.com
Usage: acloud <group> [command] [--flags]

Account, Billing & Auth:
  acloud signup [--name "Your Name"] [--email you@co.com]  Create free isolated Cloud Voice subscriber account
  acloud login --api-key <acloud_key>                      Save API key to ~/.acloud/credentials.json (chmod 600)
  acloud account                                           View plan tier, character quota, and cloned voice count
  acloud billing plans                                     List transparent Cloud Voice & org subscription plans
  acloud billing orders                                    List checkout orders & paid invoices
  acloud billing checkout [--plan creator|pro] [--gateway razorpay|stripe]
                                                           Create Razorpay (₹ INR) or Stripe ($ USD) checkout order
  acloud billing activate --order <ord_id>                 Instant Founder/Admin plan & quota activation

Cloud Voice (Apache-2.0 Neural Voice + BYOK Connectors):
  acloud voice challenge [--name "Your Name"]              Generate live 4-digit consent verification phrase
  acloud voice clone <sample.wav> --name "My Voice" --consent-code <4digits>
                                                           Clone your own voice into your isolated account
  acloud voice list                                        List your cloned voices + Apache-2.0 studio voices
  acloud voice connectors                                  List masked BYOK partner connectors (ElevenLabs® / Camtasia®)
  acloud voice connector set elevenlabs --key <key> [--voice <id>]
                                                           Save masked BYOK ElevenLabs® connector in isolated vault
  acloud voice speak "<text>" [--voice <voiceId>] [--engine auto|elevenlabs_byok] [--tscproj] [--out out.mp3]
                                                           Synthesize speech with W3C PLS dictionary & .tscproj export
  acloud voice delete <voiceId>                            Permanently delete a cloned voice profile

Cloud Infrastructure & Tools:
  acloud status                                            Live Aaruni Cloud status & Zero-Trust posture
  acloud services                                          List all 11 Aaruni Cloud services
  acloud storage ls [--space <space>]                      List files in a Cloud Storage space ($0 egress)
  acloud storage upload <file> [--space <space>]           Upload file with SHA-256 verification
  acloud storage download <key> [out] [--space <space>]    Download file from Cloud Storage
  acloud archive seal --space <space> --key <file>         Seal file read-only in Cloud Archive
  acloud compute nodes                                     List active Cloud Compute nodes (Admin)
  acloud compute launch [--type m4.pro.isolated]           Queue Cloud Compute job (Admin)
  acloud worker start [--service VOICE]                    Start GPU-Yield-Protected outbound worker (0 inbound ports)
  acloud assistant ask "<prompt>"                          Query multi-intent Cloud Assistant
  acloud knowledge search "<keywords>"                     Search Cloud Knowledge index
  acloud qa audit [--url https://aarunicloud.com]          Run Cloud Quality WCAG & layout audit
  acloud guard whoami                                      Inspect active Cloud Guard principal
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

  if (svc === "signup") {
    const res = await cloud.auth.guestTrial({
      name: flags.name || arg1 || "CLI Creator",
      email: flags.email
    });
    const credPath = saveCredentials(res.apiKey, cloud.endpoint, cloud.region);
    console.log(`🎉 Created isolated Aaruni Cloud subscriber account (${res.account.email})`);
    console.log(`🔒 Saved scoped API key (${res.keyId}) to ${credPath} (chmod 600)`);
    console.log(JSON.stringify(res.account, null, 2));
    return;
  }

  if (svc === "login") {
    const key = flags["api-key"] || arg1;
    if (!key) throw new Error("Usage: acloud login --api-key <your_acloud_key>");
    const credPath = saveCredentials(key, flags.endpoint || cloud.endpoint, flags.region || cloud.region);
    console.log(`🔒 Saved Aaruni Cloud credentials to ${credPath} (chmod 600).`);
    return;
  }

  if (svc === "account" || (svc === "auth" && sub === "whoami")) {
    const res = await cloud.account.me();
    console.log(`👤 ${res.account.name} (${res.account.email}) • Plan: ${res.account.planTier.toUpperCase()}`);
    console.log(`   Characters: ${res.account.charsUsed}/${res.account.charsLimit} • Cloned Voices: ${res.account.voicesUsed}/${res.account.voicesLimit}`);
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (svc === "status") {
    const res = await cloud.status();
    console.log(`🟢 ${res.platform} (${res.status}) • Console: ${res.consoleUrl} • POP: ${res.edgePop}`);
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (svc === "services") {
    const res = await cloud.services();
    for (const s of res.services) {
      console.log(`  [${s.code.padEnd(10)}] ${s.name.padEnd(18)} -> ${s.endpoint}`);
    }
    return;
  }

  if (svc === "billing") {
    if (!sub || sub === "plans") {
      console.log(JSON.stringify(await cloud.billing.plans(), null, 2));
      return;
    }
    if (sub === "orders" || sub === "ls") {
      console.log(JSON.stringify(await cloud.billing.orders(), null, 2));
      return;
    }
    if (sub === "checkout") {
      const res = await cloud.billing.checkout({
        plan: flags.plan || arg1 || "creator",
        gateway: flags.gateway || "razorpay"
      });
      console.log(`💳 Checkout Order ${res.orderId} (${res.mode})`);
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    if (sub === "activate" || sub === "admin-activate") {
      const res = await cloud.billing.adminActivate({
        orderId: flags.order || flags["order-id"] || arg1,
        email: flags.email,
        plan: flags.plan || "creator",
        paymentRef: flags.ref || flags["payment-ref"] || "acloud_cli_verified"
      });
      const tier = String(res.planTier || res.unlockedPlan || "creator").toUpperCase();
      console.log(`🎉 Activated ${res.email} -> ${tier} (${res.charsLimit} chars, ${res.voicesLimit} voices • Invoice ${res.invoiceNo})`);
      console.log(JSON.stringify(res, null, 2));
      return;
    }
  }

  if (svc === "voice") {
    if (sub === "connectors") {
      console.log(JSON.stringify(await cloud.voice.connectors(), null, 2));
      return;
    }
    if (sub === "connector") {
      if (arg1 === "set") {
        const provRaw = positional[3] || flags.provider || "elevenlabs_byok";
        const provider = provRaw.startsWith("eleven") ? "elevenlabs_byok" : provRaw;
        const apiKey = flags.key || flags["api-key"] || "";
        const defaultVoiceId = flags.voice || flags["voice-id"] || "";
        const res = await cloud.voice.setConnector({ provider, apiKey, defaultVoiceId });
        console.log(`🔒 Saved BYOK connector ${res.provider} (${res.maskedKey})`);
        console.log(JSON.stringify(res, null, 2));
        return;
      }
      if (arg1 === "delete" || arg1 === "rm") {
        const provRaw = positional[3] || flags.provider || "elevenlabs_byok";
        const provider = provRaw.startsWith("eleven") ? "elevenlabs_byok" : provRaw;
        console.log(JSON.stringify(await cloud.voice.deleteConnector(provider), null, 2));
        return;
      }
    }
    if (sub === "challenge") {
      const res = await cloud.voice.consentChallenge({ name: flags.name || arg1 || "Creator" });
      console.log(`🎙️ Live Consent Code: ${res.consentCode}`);
      console.log(`   Read aloud: "${res.consentPhrase}"`);
      return;
    }
    if (sub === "list" || sub === "ls") {
      const res = await cloud.voice.list();
      console.log(`🎙️ Cloud Voice Library (${res.clonedCount} cloned, ${res.stockVoices.length} studio):`);
      console.log(JSON.stringify({ clonedVoices: res.clonedVoices, stockVoices: res.stockVoices }, null, 2));
      return;
    }
    if (sub === "clone") {
      const wavPath = arg1 || flags.file;
      const name = flags.name || "My Cloned Voice";
      const consentCode = flags["consent-code"] || flags.code;
      if (!wavPath || !consentCode) {
        throw new Error('Usage: acloud voice clone <sample.wav> --name "My Voice" --consent-code <4digits>');
      }
      const res = await cloud.voice.clone(wavPath, {
        name,
        consentCode,
        consentPhrase: flags["consent-phrase"],
        language: flags.language || "en"
      });
      console.log(`✔ ${res.message}`);
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    if (sub === "delete" || sub === "rm") {
      const vid = arg1 || flags.voice;
      if (!vid) throw new Error("Usage: acloud voice delete <vox_id>");
      console.log(JSON.stringify(await cloud.voice.delete(vid), null, 2));
      return;
    }
    if (!sub || sub === "speak" || sub === "synthesize") {
      const text = flags.text || positional.slice(sub ? 2 : 1).join(" ");
      if (!text) throw new Error('Usage: acloud voice speak "Hello world" [--voice vox_id] [--lufs -12]');
      const engine = flags.engine;
      const res = await cloud.voice.speak({
        text,
        voiceId: flags.voice || flags.persona || "stock_aria",
        targetLufs: Number(flags["target-lufs"] || flags.lufs || -12),
        engine,
        elevenlabsVoiceId: flags["el-voice"],
        includeCamtasiaTimeline: Boolean(flags.tscproj || flags.camtasia),
        speed: flags.speed ? Number(flags.speed) : undefined,
        steps: flags.steps ? Number(flags.steps) : undefined,
        style: flags.style
      });
      if (flags.out && res.audioBase64) {
        const raw = Buffer.from(res.audioBase64, "base64");
        fs.writeFileSync(flags.out, raw);
        console.log(`✔ Saved BYOK MP3 to ${flags.out} (${raw.length} bytes)`);
      }

      if (res.mode === "QUEUED_MLX_NEURAL_WORKER") {
        console.log(`🎙️ Queued Cloud Voice Neural Job ${res.jobId} ("${res.normalizedText}")`);
        if (isVoiceTrainingActiveOnGpu()) {
          console.log("⏸ [GPU Yield Guard] Active voice training is running on Metal GPU — job stays safely queued without disturbing training.");
          console.log(JSON.stringify(res, null, 2));
          return;
        }
        const avgsUrl = flags.avgs || "http://127.0.0.1:8766";
        try {
          const h = await fetch(`${avgsUrl}/api/v1/health`, { signal: AbortSignal.timeout(1500) });
          if (h.ok) await processOneOutboundJob(cloud, { service: "VOICE", avgsUrl });
        } catch (_) {}

        for (let attempt = 0; attempt < 40; attempt++) {
          const j = await cloud.jobs.get(res.jobId);
          if (j.status === "COMPLETED" && j.result && j.result.key) {
            if (flags.out) {
              const dl = await cloud.storage.download(j.result.key, { space: j.result.space || "voice-studio" });
              fs.writeFileSync(flags.out, dl.bytes);
              console.log(`✔ Saved Studio MP3 to ${flags.out} (${dl.bytes.length} bytes, ${j.result.durationSec}s)`);
            }
            console.log(JSON.stringify(j, null, 2));
            return;
          }
          if (j.status === "FAILED") throw new Error(`Synthesis failed: ${JSON.stringify(j.result)}`);
          await sleep(2000);
        }
      }

      console.log(`🎙️ Cloud Voice • ${res.jobId} • Mode: ${res.mode} • Loudness: ${res.dsp.targetLoudnessLufs} dB LUFS`);
      console.log(JSON.stringify(res, null, 2));
      return;
    }
  }

  if (svc === "worker") {
    const service = (flags.service || "VOICE").toUpperCase();
    const avgsUrl = flags.avgs || "http://127.0.0.1:8766";
    if (sub === "once") {
      const done = await processOneOutboundJob(cloud, { service, avgsUrl });
      if (!done) console.log(`No runnable ${service} jobs (or GPU Yield Guard active).`);
      return;
    }
    console.log(`🛡️ Aaruni Cloud Outbound Worker started (Service: ${service}, GPU Yield Guard: ON, Inbound Ports: 0)`);
    while (true) {
      try {
        const done = await processOneOutboundJob(cloud, { service, avgsUrl });
        if (!done) await sleep(3000);
      } catch (e) {
        console.error(`⚠ Worker error: ${e.message}`);
        await sleep(3000);
      }
    }
  }

  if (svc === "storage") {
    const space = flags.space || "production-media";
    if (!sub || sub === "ls" || sub === "list") {
      const res = await cloud.storage.list(space);
      console.log(`📦 Cloud Storage • Space: storage://${res.space} (${res.count} items, Egress: $0.00)`);
      console.log(JSON.stringify(res.items, null, 2));
      return;
    }
    if (sub === "upload" || sub === "put") {
      const target = arg1 || flags.file;
      if (!target) throw new Error("Usage: acloud storage upload <file> [--space <space>] [--key <name>]");
      const res = await cloud.storage.upload(target, { space, key: flags.key, contentType: flags["content-type"] });
      console.log(`✔ Uploaded to storage://${res.space}/${res.key} (${res.sizeBytes} bytes)`);
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    if (sub === "download" || sub === "get") {
      const key = arg1 || flags.key;
      const res = await cloud.storage.download(key, { space });
      const outPath = arg2 || flags.out;
      if (outPath) {
        fs.writeFileSync(outPath, res.bytes);
        console.log(`✔ Downloaded ${res.bytes.length} bytes to ${outPath}`);
      } else {
        process.stdout.write(res.bytes);
      }
      return;
    }
    if (sub === "rm" || sub === "delete") {
      console.log(JSON.stringify(await cloud.storage.delete(arg1 || flags.key, { space }), null, 2));
      return;
    }
  }

  if (svc === "archive" && sub === "seal") {
    console.log(JSON.stringify(await cloud.archive.seal({ space: flags.space || "production-media", key: flags.key || arg1 }), null, 2));
    return;
  }

  if (svc === "compute") {
    if (!sub || sub === "nodes" || sub === "list") {
      console.log(JSON.stringify(await cloud.compute.nodes(), null, 2));
      return;
    }
    if (sub === "launch") {
      console.log(JSON.stringify(await cloud.compute.launch({ type: flags.type || "m4.pro.isolated" }), null, 2));
      return;
    }
  }

  if (svc === "containers" && sub === "run") {
    console.log(JSON.stringify(await cloud.containers.run({ image: flags.image || arg1 || "xvfb-1080p-worker" }), null, 2));
    return;
  }

  if (svc === "assistant" && (!sub || sub === "ask")) {
    const prompt = flags.prompt || positional.slice(sub === "ask" ? 2 : 1).join(" ");
    console.log(JSON.stringify(await cloud.assistant.ask(prompt), null, 2));
    return;
  }

  if (svc === "knowledge" && (!sub || sub === "search")) {
    const q = flags.query || flags.q || positional.slice(sub === "search" ? 2 : 1).join(" ") || "";
    console.log(JSON.stringify(await cloud.knowledge.search(q), null, 2));
    return;
  }

  if (svc === "render") {
    if (!sub || sub === "build") {
      console.log(JSON.stringify(await cloud.render.build({ timeline: flags.timeline || flags.project || "lesson-01.cmproj", resolution: flags.resolution || "1920x1080" }), null, 2));
      return;
    }
    if (sub === "job" || sub === "status") {
      console.log(JSON.stringify(await cloud.render.job(arg1 || flags.id), null, 2));
      return;
    }
  }

  if (svc === "qa" && (!sub || sub === "audit")) {
    console.log(JSON.stringify(await cloud.qa.audit({ url: flags.url || arg1 || "https://aarunicloud.com" }), null, 2));
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

  if (svc === "orgs" || svc === "org") {
    if (!sub || sub === "list" || sub === "ls") {
      console.log(JSON.stringify(await cloud.orgs.list(), null, 2));
      return;
    }
    if (sub === "create") {
      const displayName = flags.name || positional.slice(2).join(" ");
      console.log(JSON.stringify(await cloud.orgs.create({
        displayName,
        slug: flags.slug,
        monthlyCapInr: Number(flags.cap || 0)
      }), null, 2));
      return;
    }
  }

  if (svc === "projects" || svc === "project") {
    if (!sub || sub === "list" || sub === "ls") {
      console.log(JSON.stringify(await cloud.projects.list(), null, 2));
      return;
    }
    if (sub === "inspect" || sub === "get") {
      const pid = arg1 || flags.project || "prj_syllovo_prod";
      console.log(JSON.stringify(await cloud.projects.get(pid), null, 2));
      return;
    }
    if (sub === "config" || sub === "runtime-config") {
      const pid = arg1 || flags.project || "prj_syllovo_prod";
      console.log(JSON.stringify(await cloud.projects.runtimeConfig(pid), null, 2));
      return;
    }
    if (sub === "create") {
      const displayName = flags.name || positional.slice(2).join(" ");
      console.log(JSON.stringify(await cloud.projects.create({
        displayName,
        orgId: flags.org,
        environment: flags.env || "dev",
        backendDriver: flags.driver || "aaruni-edge",
        spendCapInr: Number(flags.cap || 0)
      }), null, 2));
      return;
    }
  }

  if (svc === "secrets" || svc === "secret") {
    const pid = flags.project || "prj_syllovo_prod";
    if (!sub || sub === "list" || sub === "ls") {
      console.log(JSON.stringify(await cloud.projects.secrets(pid), null, 2));
      return;
    }
    if (sub === "set") {
      const key = arg1 || flags.key;
      const value = positional[3] || flags.value;
      console.log(JSON.stringify(await cloud.projects.setSecret(pid, { key, value }), null, 2));
      return;
    }
  }

  if (svc === "deploy") {
    const filePath = path.resolve(flags.file || flags.config || "acloud.yaml");
    if (!fs.existsSync(filePath)) {
      throw new Error(`Deployment manifest not found at ${filePath}. Pass --file ./acloud.yaml or run 'acloud builder "<prompt>"'.`);
    }
    const rawYaml = fs.readFileSync(filePath, "utf8");
    const manifest = { buckets: [], voicePolicy: {} };
    let section = "";
    for (const rawLine of rawYaml.split(/\r?\n/)) {
      const line = rawLine.replace(/#.*$/, "").trimEnd();
      if (!line.trim()) continue;
      if (!line.startsWith(" ")) {
        const idx = line.indexOf(":");
        if (idx !== -1) {
          const k = line.slice(0, idx).trim();
          const v = line.slice(idx + 1).trim();
          section = k;
          if (v) manifest[k] = v.replace(/^["']|["']$/g, "");
        }
      } else if (section === "buckets" && line.trim().startsWith("- ")) {
        manifest.buckets.push(line.trim().slice(2).trim().replace(/^["']|["']$/g, ""));
      } else if (section === "voicePolicy") {
        const idx = line.indexOf(":");
        if (idx !== -1) {
          const k = line.slice(0, idx).trim();
          const v = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
          manifest.voicePolicy[k] = isNaN(Number(v)) ? v : Number(v);
        }
      } else if (line.trim().startsWith("domain:")) {
        manifest.domain = line.trim().slice(7).trim().replace(/^["']|["']$/g, "");
      }
    }
    const pid = flags.project || manifest.project || "prj_syllovo_prod";
    const driver = flags.driver || manifest.driver || "aaruni-edge";
    const deployed = await cloud.projects.deploy(pid, {
      appName: manifest.app || path.basename(path.dirname(filePath)),
      version: flags.version || manifest.version,
      backendDriver: driver,
      domain: flags.domain || manifest.domain,
      manifest,
      triggeredBy: "acloud-cli"
    });
    console.log(`🚀 Deployed '${deployed.appName}' to project ${deployed.projectId} [driver=${deployed.backendDriver}] -> ${deployed.domainUrl}`);
    console.log(JSON.stringify(deployed, null, 2));
    return;
  }

  if (svc === "builder") {
    const prompt = flags.prompt || positional.slice(sub === "plan" ? 2 : 1).join(" ");
    const res = await cloud.builder.plan({ prompt, projectId: flags.project || "prj_syllovo_prod", appName: flags.app });
    if (flags.out) {
      fs.writeFileSync(path.resolve(flags.out), res.acloudYaml + "\n", "utf8");
      console.log(`✔ Wrote generated manifest to ${path.resolve(flags.out)}`);
    } else {
      console.log(res.acloudYaml);
      console.log(`\n# Next: ${res.deployCommand}`);
    }
    return;
  }

  printHelp();
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(`✖ acloud error: ${err.message}`);
  process.exit(1);
});
