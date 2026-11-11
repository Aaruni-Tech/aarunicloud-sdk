import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function resolveLocalCredentials() {
  try {
    const credPath = path.join(os.homedir(), ".aaruni", "credentials.json");
    if (fs.existsSync(credPath)) {
      return JSON.parse(fs.readFileSync(credPath, "utf8"));
    }
  } catch (_) {}
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
      process.env.AARUNI_ENDPOINT ||
      local.endpoint ||
      "https://api.aarunicloud.com"
    ).replace(/\/+$/, "");

    this.apiKey =
      options.apiKey ||
      process.env.AARUNI_API_KEY ||
      local.api_key ||
      "agd_sandbox_public_demo";

    this.region =
      options.region ||
      process.env.AARUNI_REGION ||
      local.region ||
      "ap-south-hyd-1";

    // Domain Service Sub-Clients
    this.storage = {
      list: (space = "sandbox") => this._json("GET", `/v1/storage/${encodeURIComponent(space)}`),
      upload: async (fileOrBytes, { space = "sandbox", key, contentType } = {}) => {
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
      download: async (key, { space = "sandbox", range } = {}) => {
        const headers = { Authorization: `Bearer ${this.apiKey}` };
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
      delete: (key, { space = "sandbox" } = {}) =>
        this._json("DELETE", `/v1/storage/${encodeURIComponent(space)}/${encodeURIComponent(key)}`)
    };

    this.archive = {
      seal: ({ space = "sandbox", key }) => this._json("POST", "/v1/archive/seal", { space, key })
    };

    this.compute = {
      nodes: () => this._json("GET", "/v1/compute/nodes"),
      launch: ({ type = "acc.m4.max", storage = "acs://sandbox", region = this.region } = {}) =>
        this._json("POST", "/v1/compute/launch", { type, storage, region }),
      heartbeat: (payload) => this._json("POST", "/v1/compute/heartbeat", payload)
    };

    this.containers = {
      run: ({ image = "xvfb-1080p-worker", region = this.region } = {}) =>
        this._json("POST", "/v1/containers/run", { image, region })
    };

    this.voice = {
      synthesize: ({ text, persona = "aria", targetLufs = -12.0 } = {}) =>
        this._json("POST", "/v1/voice/synthesize", { text, persona, targetLufs })
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
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json"
    };
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
    const res = await fetch(`${this.endpoint}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...extraHeaders
      },
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
