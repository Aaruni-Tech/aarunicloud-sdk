# Aaruni Cloud SDK & `acloud` CLI (`@aarunicloud/sdk` · `aarunicloud`)

Official CLI, Node.js/TypeScript SDK, and Python 3 SDK for **Aaruni Cloud** (`https://aarunicloud.com`) and **Aaruni Cloud Console** (`https://console.aarunicloud.com`).

## Unified Brand Architecture (Option A)

| Layer | Official Name | Identifier / URL |
| :--- | :--- | :--- |
| **Parent Brand** | **Aaruni Tech** | `https://aarunitech.com` · `https://my.aarunitech.com` |
| **Cloud Platform** | **Aaruni Cloud** | `https://aarunicloud.com` · `https://api.aarunicloud.com` |
| **Cloud Console** | **Aaruni Cloud Console** | `https://console.aarunicloud.com` |
| **Cloud CLI** | **`acloud`** | `acloud <service> <action>` |
| **Node.js / TS SDK** | **`@aarunicloud/sdk`** | `import { AaruniCloud } from '@aarunicloud/sdk'` |
| **Python 3 SDK** | **`aarunicloud`** | `from aarunicloud import Client` |

## Services (`Cloud <Service>`)

- **Cloud Voice**: Self-serve zero-shot personal voice cloning (`24 kHz` WAV + mandatory 4-digit anti-deepfake consent gate), W3C PLS technical pronunciation (`PostgreSQL`, `kubectl`, `NGINX`, `OAuth2`), and `-12.0 dB LUFS` target mastering.
- **Cloud Storage**: Zero-egress edge object storage with HTTP `206` Byte-Range video/audio streaming.
- **Cloud Archive**: Long-term cold storage seal (`SHA-256` receipt).
- **Cloud Compute** & **Cloud Containers**: Private outbound-pull Apple Silicon Metal worker orchestration (admin-only; `0` inbound ports).
- **Cloud Assistant** & **Cloud Knowledge**: Edge developer assistant and guideline/pronunciation RAG search.
- **Cloud Render**, **Cloud Quality**, **Cloud Guard**, **Cloud Edge**.

## Install

### `acloud` CLI & Node.js SDK (`@aarunicloud/sdk`)

```bash
npm install -g https://aarunicloud.com/sdk/aarunicloud-sdk-1.0.0.tgz
```

### Python 3 SDK (`aarunicloud`)

```bash
pip install https://aarunicloud.com/sdk/aarunicloud-1.0.0.tar.gz
```

## `acloud` CLI Quick Reference

```bash
# 1. Start a free Cloud Voice subscriber account (2,000 free chars + 1 personal voice clone)
acloud signup you@domain.com "Your Name"

# 2. Check account plan, quota, and voice slots
acloud account

# 3. Clone your own voice (requires live 4-digit consent phrase)
acloud voice challenge
acloud voice clone --name "My Studio Voice" --wav ./sample-24k.wav --code 4829 --phrase "I authorize Aaruni Cloud Voice to clone my voice, verification code 4829."

# 4. Synthesize speech with automatic W3C PLS technical pronunciation
acloud voice speak "Deploying PostgreSQL and NGINX with kubectl on OAuth2." --voice vox_abc123 --out intro.wav
```
