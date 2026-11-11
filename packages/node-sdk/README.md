# `@aarunicloud/sdk` & `acloud` CLI

Official Node.js / TypeScript SDK and `acloud` CLI for **Aaruni Cloud** (`https://aarunicloud.com`) and **Aaruni Cloud Console** (`https://console.aarunicloud.com`).

## Install

```bash
npm install -g https://aarunicloud.com/sdk/aarunicloud-sdk-1.0.0.tgz
```

## Quick Start

```javascript
import { AaruniCloud } from "@aarunicloud/sdk";

const cloud = new AaruniCloud({ region: "ap-south-hyd-1" });
console.log(await cloud.status());
```
