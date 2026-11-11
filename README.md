# Aaruni Cloud SDK & CLI (`aaruni`, `@aaruni/sdk`, `aaruni-cloud`)

Official CLI, Node.js/TypeScript SDK, and zero-dependency Python 3 SDK for **Aaruni Cloud** (`https://api.aarunicloud.com/v1`).

## Services Covered (Option 1 — Accessible Cloud Portfolio)

| Code | Service Name | Endpoint Prefix |
| :--- | :--- | :--- |
| `ACS` | **Aaruni Storage** | `GET/PUT/DELETE /v1/storage/:space/:key` (with HTTP `206` Byte-Range) |
| `ARC` | **Aaruni Archive** | `POST /v1/archive/seal` |
| `ACC` | **Aaruni Compute** | `GET /v1/compute/nodes`, `POST /v1/compute/launch`, `POST /v1/compute/heartbeat` |
| `ACN` | **Aaruni Containers** | `POST /v1/containers/run` |
| `AVA` | **Aaruni Voice** | `POST /v1/voice/synthesize` (W3C PLS lexicon + `-12.0 dB LUFS` spec) |
| `AAI` | **Aaruni Assistant** | `POST /v1/assistant/ask` |
| `AKB` | **Aaruni Knowledge** | `POST /v1/knowledge/search` |
| `ARN` | **Aaruni Render** | `POST /v1/render/build`, `GET /v1/jobs/:id` |
| `AQA` | **Aaruni Quality** | `POST /v1/qa/audit` |
| `AGD` | **Aaruni Guard** | `GET /v1/guard/whoami`, `GET /v1/guard/audit` |
| `AED` | **Aaruni Edge** | `GET /v1/edge/status`, `GET /v1/status`, `GET /v1/services` |

## 1. Install CLI & Node.js SDK (`@aaruni/sdk`)

```bash
npm install -g https://aarunicloud.com/sdk/aaruni-sdk-1.0.0.tgz
```

### CLI Quickstart

```bash
# Authenticate (stores key in ~/.aaruni/credentials.json chmod 600)
aaruni login --api-key agd_sandbox_public_demo

# Check live edge health & identity
aaruni status
aaruni guard whoami

# Upload & list files in Aaruni Storage (ACS)
aaruni storage upload ./hello.txt --space sandbox --key hello.txt
aaruni storage ls --space sandbox

# Launch compute, synthesize voice, or queue render
aaruni compute launch --profile m4-pro-14c --task "build-demo"
aaruni voice synthesize "Welcome to TypeScript generics on Kubernetes."
aaruni render build --project course-m1 --resolution 1080p
```

### Node.js ESM Usage

```js
import { AaruniCloud } from '@aaruni/sdk';

const cloud = new AaruniCloud({ apiKey: process.env.AARUNI_API_KEY });
await cloud.storage.upload('Hello Aaruni Cloud!', { space: 'sandbox', key: 'demo.txt' });
const partial = await cloud.storage.download('demo.txt', { space: 'sandbox', range: 'bytes=0-4' });
console.log(partial.status, partial.text()); // 206 "Hello"
```

## 2. Install Python SDK (`aaruni-cloud`)

```bash
pip install https://aarunicloud.com/sdk/aaruni_cloud-1.0.0.tar.gz
```

### Python 3 Usage

```python
import aaruni_cloud as ac

cloud = ac.Client()  # Reads AARUNI_API_KEY or ~/.aaruni/credentials.json
cloud.storage.upload("demo.txt", b"Hello from Python!", space="sandbox")
blob = cloud.storage.download("demo.txt", space="sandbox")
print(blob.decode())

ans = cloud.assistant.ask("Which Aaruni service handles hot cloud storage?")
print(ans["answer"])
```
