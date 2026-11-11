export interface AaruniCloudOptions {
  endpoint?: string;
  apiKey?: string;
  region?: string;
}

export declare class AaruniCloud {
  endpoint: string;
  apiKey: string;
  region: string;
  constructor(options?: AaruniCloudOptions);
  status(): Promise<any>;
  services(): Promise<any>;
  storage: {
    list(space?: string): Promise<any>;
    upload(fileOrBytes: string | Uint8Array, opts?: { space?: string; key?: string; contentType?: string }): Promise<any>;
    download(key: string, opts?: { space?: string; range?: string }): Promise<{ status: number; contentType: string | null; sha256: string | null; bytes: Buffer }>;
    delete(key: string, opts?: { space?: string }): Promise<any>;
  };
  archive: {
    seal(opts: { space?: string; key: string }): Promise<any>;
  };
  compute: {
    nodes(): Promise<any>;
    launch(opts?: { type?: string; storage?: string; region?: string }): Promise<any>;
    heartbeat(payload: Record<string, any>): Promise<any>;
  };
  containers: {
    run(opts?: { image?: string; region?: string }): Promise<any>;
  };
  voice: {
    synthesize(opts: { text: string; persona?: string; targetLufs?: number }): Promise<any>;
  };
  assistant: {
    ask(promptOrOpts: string | { prompt: string }): Promise<any>;
  };
  knowledge: {
    search(queryOrOpts: string | { query: string }): Promise<any>;
  };
  render: {
    build(opts?: { timeline?: string; format?: string; resolution?: string }): Promise<any>;
    job(jobId: string): Promise<any>;
  };
  qa: {
    audit(opts?: { url?: string }): Promise<any>;
  };
  guard: {
    whoami(): Promise<any>;
    auditLogs(): Promise<any>;
  };
  edge: {
    status(): Promise<any>;
  };
}

export default AaruniCloud;
