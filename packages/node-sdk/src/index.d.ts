export interface AaruniCloudOptions {
  endpoint?: string;
  apiKey?: string;
  region?: string;
}

export declare class AaruniCloudError extends Error {
  status: number;
  payload: any;
  constructor(message: string, status: number, payload?: any);
}

export declare class AaruniCloud {
  endpoint: string;
  apiKey: string;
  region: string;
  constructor(options?: AaruniCloudOptions);
  status(): Promise<any>;
  services(): Promise<any>;
  auth: {
    guestTrial(opts?: { name?: string; email?: string }): Promise<any>;
    requestOtp(opts: { email: string }): Promise<any>;
    verifyOtp(opts: { email: string; code: string; name?: string }): Promise<any>;
  };
  account: {
    me(): Promise<any>;
    upgrade(opts?: { plan?: "creator" | "pro"; email?: string }): Promise<any>;
  };
  voice: {
    consentChallenge(opts?: { name?: string }): Promise<any>;
    list(): Promise<any>;
    clone(fileOrBytes: string | Buffer, opts: { name: string; consentCode: string; consentPhrase?: string; language?: string; refDurationSec?: number }): Promise<any>;
    delete(voiceId: string): Promise<any>;
    speak(opts: { text: string; voiceId?: string; targetLufs?: number; engine?: string }): Promise<any>;
    synthesize(opts: { text: string; voiceId?: string; persona?: string; targetLufs?: number; engine?: string }): Promise<any>;
  };
  storage: {
    list(space?: string): Promise<any>;
    upload(fileOrBytes: string | Buffer, opts?: { space?: string; key?: string; contentType?: string }): Promise<any>;
    download(key: string, opts?: { space?: string; range?: string }): Promise<{ status: number; contentType: string | null; contentRange: string | null; sha256: string | null; bytes: Buffer; text(encoding?: BufferEncoding): string }>;
    delete(key: string, opts?: { space?: string }): Promise<any>;
  };
  archive: { seal(opts: { space?: string; key: string }): Promise<any> };
  compute: {
    nodes(): Promise<any>;
    launch(opts?: { type?: string; storage?: string; region?: string }): Promise<any>;
    heartbeat(payload: any): Promise<any>;
    pullNext(opts?: { service?: string }): Promise<any>;
  };
  jobs: {
    get(jobId: string): Promise<any>;
    complete(jobId: string, opts?: { status?: string; result?: any }): Promise<any>;
  };
  containers: { run(opts?: { image?: string; region?: string }): Promise<any> };
  assistant: { ask(prompt: string | { prompt: string }): Promise<any> };
  knowledge: { search(query: string | { query: string }): Promise<any> };
  render: { build(opts?: { timeline?: string; format?: string; resolution?: string }): Promise<any>; job(jobId: string): Promise<any> };
  qa: { audit(urlOrOpts?: string | { url?: string }): Promise<any> };
  quality: { audit(urlOrOpts?: string | { url?: string }): Promise<any> };
  guard: { whoami(): Promise<any>; auditLogs(): Promise<any> };
  edge: { status(): Promise<any> };
}

export default AaruniCloud;
