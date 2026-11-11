# `aarunicloud` — Official Python SDK for Aaruni Cloud

Official Python 3 SDK for **Aaruni Cloud** (`https://aarunicloud.com`) and **Aaruni Cloud Console** (`https://console.aarunicloud.com`).

## Install

```bash
pip install https://aarunicloud.com/sdk/aarunicloud-1.0.0.tar.gz
```

## Quick Start (Cloud Voice Cloning & Synthesis)

```python
from aarunicloud import Client

# Reads ACLOUD_API_KEY or ~/.acloud/credentials.json automatically
cloud = Client()

# List your voices (built-in + personal clones)
voices = cloud.voice.list()

# Synthesize studio narration with W3C PLS technical pronunciation
job = cloud.voice.speak(
    "Welcome to Aaruni Cloud Voice on PostgreSQL and NGINX.",
    voice_id="aria",
    target_lufs=-12.0,
)
print(job)
```
