import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function resolveLocalCredentials() {
  const candidates = [
    path.join(os.homedir(), ".acloud", "credentials.json"),
    path.join(os.homedir(), ".aaruni", "credentials.json")
  ];
  for (const credPath of candidates) {
    try {
      if (fs.existsSync(credPath)) {
        return JSON.parse(fs.readFileSync(credPath, "utf8"));
      }
    } catch (_) {}
  }
  return null;
}

export class AaruniCloudError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = "AaruniCloudError";
    this.status = status;
    this.payload = payload;
  }
}

export class AaruniCloud {
  constructor(options = {}) {
    const local = resolveLocalCredentials() || {};
    this.endpoint = (
      options.endpoint ||
      process.env.ACLOUD_ENDPOINT ||
      process.env.AARUNI_ENDPOINT ||
      local.endpoint ||
      "https://api.aarunicloud.com"
    ).replace(/\/+$/, "");

    this.apiKey =
      options.apiKey ||
      process.env.ACLOUD_API_KEY ||
      process.env.AARUNI_API_KEY ||
      local.api_key ||
      "";

    this.region =
      options.region ||
      process.env.ACLOUD_REGION ||
      process.env.AARUNI_REGION ||
      local.region ||
      "ap-south-hyd-1";

    this.auth = {
      guestTrial: ({ name = "CLI Creator", email } = {}) =>
        this._json("POST", "/v1/auth/guest-trial", { name, email }),
      requestOtp: ({ email }) =>
        this._json("POST", "/v1/auth/request-otp", { email }),
      verifyOtp: ({ email, code, name }) =>
        this._json("POST", "/v1/auth/verify-otp", { email, code, name })
    };

    this.account = {
      me: () => this._json("GET", "/v1/account/me"),
      upgrade: ({ plan = "creator", email } = {}) =>
        this._json("POST", "/v1/account/upgrade", { plan, email })
    };

    this.orgs = {
      list: () => this._json("GET", "/v1/orgs"),
      create: ({ displayName, slug, monthlyCapInr = 0, orgId } = {}) =>
        this._json("POST", "/v1/orgs", { displayName, slug, monthlyCapInr, orgId })
    };

    this.projects = {
      list: () => this._json("GET", "/v1/projects"),
      create: ({ displayName, slug, orgId, environment = "dev", backendDriver = "aaruni-edge", spendCapInr = 0, buckets, voicePolicy } = {}) =>
        this._json("POST", "/v1/projects", { displayName, slug, orgId, environment, backendDriver, spendCapInr, buckets, voicePolicy }),
      get: (projectId) => this._json("GET", `/v1/projects/${encodeURIComponent(projectId)}`),
      runtimeConfig: (projectId) => this._json("GET", `/v1/projects/${encodeURIComponent(projectId)}/runtime-config`),
      publicManifest: (projectId) => this._json("GET", `/v1/projects/${encodeURIComponent(projectId)}/public-manifest`),
      secrets: (projectId) => this._json("GET", `/v1/projects/${encodeURIComponent(projectId)}/secrets`),
      setSecret: (projectId, { key, value }) =>
        this._json("POST", `/v1/projects/${encodeURIComponent(projectId)}/secrets`, { key, value }),
      deploy: (projectId, payload = {}) =>
        this._json("POST", `/v1/projects/${encodeURIComponent(projectId)}/deploy`, payload),
      deployments: (projectId) =>
        this._json("GET", `/v1/projects/${encodeURIComponent(projectId)}/deployments`)
    };

    this.builder = {
      plan: ({ prompt, projectId = "prj_syllovo_prod", appName } = {}) =>
        this._json("POST", "/v1/builder/plan", { prompt, projectId, appName })
    };

    this.voice = {
      consentChallenge: ({ name = "Creator" } = {}) =>
        this._json("GET", `/v1/voice/consent-challenge?name=${encodeURIComponent(name)}`),
      list: () => this._json("GET", "/v1/voice/list"),
      clone: (fileOrBytes, { name, consentCode, consentPhrase, language = "en", refDurationSec = 10.0, contentType = "audio/wav" } = {}) => {
        let buf;
        if (typeof fileOrBytes === "string" && fs.existsSync(fileOrBytes)) {
          buf = fs.readFileSync(fileOrBytes);
        } else if (Buffer.isBuffer(fileOrBytes)) {
          buf = fileOrBytes;
        } else {
          throw new Error("voice.clone requires a valid audio file path or Buffer.");
        }
        return this._json("POST", "/v1/voice/clone", {
          name,
          language,
          consentCode: String(consentCode || ""),
          consentPhrase: consentPhrase || "",
          refDurationSec,
          contentType,
          audioBase64: buf.toString("base64")
        });
      },
      delete: (voiceId) => this._json("DELETE", `/v1/voice/${encodeURIComponent(voiceId)}`),
      speak: ({ text, voiceId = "stock_aria", targetLufs = -12.0, engine, speed, steps, style } = {}) =>
        this._json("POST", "/v1/voice/speak", { text, voiceId, targetLufs, engine, speed, steps, style }),
      synthesize: ({ text, voiceId, persona = "stock_aria", targetLufs = -12.0, engine, speed, steps, style } = {}) =>
        this._json("POST", "/v1/voice/speak", { text, voiceId: voiceId || persona, targetLufs, engine, speed, steps, style })
    };

    this.storage = {
      list: (space = "production-media") => this._json("GET", `/v1/storage/${encodeURIComponent(space)}`),
      upload: async (fileOrBytes, { space = "production-media", key, contentType } = {}) => {
        let bodyBytes;
        let finalKey = key;
        if (typeof fileOrBytes === "string" && fs.existsSync(fileOrBytes)) {
          bodyBytes = fs.readFileSync(fileOrBytes);
          if (!finalKey) finalKey = path.basename(fileOrBytes);
        } else if (typeof fileOrBytes === "string") {
          bodyBytes = Buffer.from(fileOrBytes, "utf8");
        } else {
          bodyBytes = fileOrBytes;
        }
        if (!finalKey) throw new Error("storage.upload requires a 'key' or a valid file path.");
        return this._raw("PUT", `/v1/storage/${encodeURIComponent(space)}/${encodeURIComponent(finalKey)}`, bodyBytes, {
          "Content-Type": contentType || "application/octet-stream"
        });
      },
      download: async (key, { space = "production-media", range } = {}) => {
        const headers = {};
        if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
        if (range) headers.Range = range;
        const res = await fetch(`${this.endpoint}/v1/storage/${encodeURIComponent(space)}/${encodeURIComponent(key)}`, {
          method: "GET",
          headers
        });
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({ error: res.statusText }));
          throw new AaruniCloudError(errJson.error || `HTTP ${res.status}`, res.status, errJson);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        return {
          status: res.status,
          contentType: res.headers.get("content-type"),
          contentRange: res.headers.get("content-range"),
          sha256: res.headers.get("x-aaruni-sha256"),
          bytes: buf,
          text: (encoding = "utf8") => buf.toString(encoding)
        };
      },
      delete: (key, { space = "production-media" } = {}) =>
        this._json("DELETE", `/v1/storage/${encodeURIComponent(space)}/${encodeURIComponent(key)}`)
    };

    this.archive = {
      seal: ({ space = "production-media", key }) => this._json("POST", "/v1/archive/seal", { space, key })
    };

    this.compute = {
      nodes: () => this._json("GET", "/v1/compute/nodes"),
      launch: ({ type = "m4.pro.isolated", storage = "storage://production-media", region = this.region } = {}) =>
        this._json("POST", "/v1/compute/launch", { type, storage, region }),
      heartbeat: (payload) => this._json("POST", "/v1/compute/heartbeat", payload),
      pullNext: ({ service } = {}) => this._json("POST", "/v1/compute/pull-next", service ? { service } : {})
    };

    this.jobs = {
      get: (jobId) => this._json("GET", `/v1/jobs/${encodeURIComponent(jobId)}`),
      complete: (jobId, { status = "COMPLETED", result = {} } = {}) =>
        this._json("POST", `/v1/jobs/${encodeURIComponent(jobId)}/complete`, { status, result })
    };

    this.containers = {
      run: ({ image = "xvfb-1080p-worker", region = this.region } = {}) =>
        this._json("POST", "/v1/containers/run", { image, region })
    };

    this.assistant = {
      ask: (promptOrOpts) => {
        const prompt = typeof promptOrOpts === "string" ? promptOrOpts : promptOrOpts.prompt;
        return this._json("POST", "/v1/assistant/ask", { prompt });
      }
    };

    this.knowledge = {
      search: (queryOrOpts) => {
        const query = typeof queryOrOpts === "string" ? queryOrOpts : queryOrOpts.query;
        return this._json("GET", `/v1/knowledge/search?q=${encodeURIComponent(query || "")}`);
      }
    };

    this.render = {
      build: ({ timeline = "lesson-01.cmproj", format = "mp4", resolution = "1920x1080" } = {}) =>
        this._json("POST", "/v1/render/build", { timeline, format, resolution }),
      job: (jobId) => this._json("GET", `/v1/jobs/${encodeURIComponent(jobId)}`)
    };

    this.qa = {
      audit: (urlOrOpts = {}) => {
        const url = typeof urlOrOpts === "string" ? urlOrOpts : (urlOrOpts.url || "https://aarunicloud.com");
        return this._json("GET", `/v1/qa/audit?url=${encodeURIComponent(url)}`);
      }
    };
    this.quality = this.qa;

    this.guard = {
      whoami: () => this._json("GET", "/v1/guard/whoami"),
      auditLogs: () => this._json("GET", "/v1/guard/audit")
    };

    this.edge = {
      status: () => this._json("GET", "/v1/edge/status")
    };
  }

  status() {
    return this._json("GET", "/v1/status");
  }

  services() {
    return this._json("GET", "/v1/services");
  }

  async _json(method, route, bodyObj) {
    const headers = { Accept: "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    let body;
    if (bodyObj !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(bodyObj);
    }
    const res = await fetch(`${this.endpoint}${route}`, { method, headers, body });
    const data = await res.json().catch(() => ({ ok: false, error: `Invalid JSON response (HTTP ${res.status})` }));
    if (!res.ok || data.ok === false) {
      throw new AaruniCloudError(data.error || `HTTP ${res.status}`, res.status, data);
    }
    return data;
  }

  async _raw(method, route, bodyBytes, extraHeaders = {}) {
    const headers = { ...extraHeaders };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const res = await fetch(`${this.endpoint}${route}`, {
      method,
      headers,
      body: bodyBytes
    });
    const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    if (!res.ok || data.ok === false) {
      throw new AaruniCloudError(data.error || `HTTP ${res.status}`, res.status, data);
    }
    return data;
  }
}

export default AaruniCloud;
