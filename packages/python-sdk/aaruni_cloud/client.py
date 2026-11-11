import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional, Union


class AaruniCloudError(Exception):
    def __init__(self, message: str, status: int = 500, payload: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.status = status
        self.payload = payload or {}


def _load_local_credentials() -> Dict[str, str]:
    cred_path = Path.home() / ".aaruni" / "credentials.json"
    if cred_path.exists():
        try:
            return json.loads(cred_path.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


class _StorageService:
    def __init__(self, client: "Client"):
        self._c = client

    def list(self, space: str = "sandbox") -> Dict[str, Any]:
        return self._c._json("GET", f"/v1/storage/{urllib.parse.quote(space)}")

    def upload(
        self,
        file_or_bytes: Union[str, Path, bytes],
        space: str = "sandbox",
        key: Optional[str] = None,
        content_type: str = "application/octet-stream",
    ) -> Dict[str, Any]:
        space_clean = space.replace("acs://", "").strip("/")
        if isinstance(file_or_bytes, (str, Path)) and Path(file_or_bytes).exists():
            p = Path(file_or_bytes)
            data = p.read_bytes()
            final_key = key or p.name
        elif isinstance(file_or_bytes, str):
            data = file_or_bytes.encode("utf-8")
            final_key = key
        else:
            data = bytes(file_or_bytes)
            final_key = key

        if not final_key:
            raise ValueError("storage.upload requires a 'key' or an existing local file path.")

        route = f"/v1/storage/{urllib.parse.quote(space_clean)}/{urllib.parse.quote(final_key)}"
        return self._c._raw("PUT", route, data, {"Content-Type": content_type})

    def download(self, key: str, space: str = "sandbox") -> bytes:
        space_clean = space.replace("acs://", "").strip("/")
        route = f"/v1/storage/{urllib.parse.quote(space_clean)}/{urllib.parse.quote(key)}"
        req = urllib.request.Request(
            f"{self._c.endpoint}{route}",
            headers={"Authorization": f"Bearer {self._c.api_key}", "User-Agent": "aaruni-cloud-python/1.0.0"},
            method="GET",
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", errors="replace")
            raise AaruniCloudError(raw, e.code)

    def delete(self, key: str, space: str = "sandbox") -> Dict[str, Any]:
        space_clean = space.replace("acs://", "").strip("/")
        return self._c._json("DELETE", f"/v1/storage/{urllib.parse.quote(space_clean)}/{urllib.parse.quote(key)}")


class _ArchiveService:
    def __init__(self, client: "Client"):
        self._c = client

    def seal(self, key: str, space: str = "sandbox") -> Dict[str, Any]:
        return self._c._json("POST", "/v1/archive/seal", {"space": space, "key": key})


class _ComputeService:
    def __init__(self, client: "Client"):
        self._c = client

    def nodes(self) -> Dict[str, Any]:
        return self._c._json("GET", "/v1/compute/nodes")

    def launch(self, node_type: str = "acc.m4.max", storage: str = "acs://sandbox", region: Optional[str] = None) -> Dict[str, Any]:
        return self._c._json("POST", "/v1/compute/launch", {
            "type": node_type,
            "storage": storage,
            "region": region or self._c.region,
        })


class _ContainersService:
    def __init__(self, client: "Client"):
        self._c = client

    def run(self, image: str = "xvfb-1080p-worker", region: Optional[str] = None) -> Dict[str, Any]:
        return self._c._json("POST", "/v1/containers/run", {"image": image, "region": region or self._c.region})


class _VoiceService:
    def __init__(self, client: "Client"):
        self._c = client

    def synthesize(self, text: str, persona: str = "aria", target_lufs: float = -12.0) -> Dict[str, Any]:
        return self._c._json("POST", "/v1/voice/synthesize", {
            "text": text,
            "persona": persona,
            "targetLufs": target_lufs,
        })


class _AssistantService:
    def __init__(self, client: "Client"):
        self._c = client

    def ask(self, prompt: str) -> Dict[str, Any]:
        return self._c._json("POST", "/v1/assistant/ask", {"prompt": prompt})


class _KnowledgeService:
    def __init__(self, client: "Client"):
        self._c = client

    def search(self, query: str) -> Dict[str, Any]:
        return self._c._json("GET", f"/v1/knowledge/search?q={urllib.parse.quote(query)}")


class _RenderService:
    def __init__(self, client: "Client"):
        self._c = client

    def build(self, timeline: str = "lesson-01.cmproj", fmt: str = "mp4", resolution: str = "1920x1080") -> Dict[str, Any]:
        return self._c._json("POST", "/v1/render/build", {
            "timeline": timeline,
            "format": fmt,
            "resolution": resolution,
        })

    def job(self, job_id: str) -> Dict[str, Any]:
        return self._c._json("GET", f"/v1/jobs/{urllib.parse.quote(job_id)}")


class _GuardService:
    def __init__(self, client: "Client"):
        self._c = client

    def whoami(self) -> Dict[str, Any]:
        return self._c._json("GET", "/v1/guard/whoami")


class Client:
    def __init__(
        self,
        api_key: Optional[str] = None,
        endpoint: Optional[str] = None,
        region: Optional[str] = None,
    ):
        local = _load_local_credentials()
        self.endpoint = (
            endpoint or os.environ.get("AARUNI_ENDPOINT") or local.get("endpoint") or "https://api.aarunicloud.com"
        ).rstrip("/")
        self.api_key = (
            api_key or os.environ.get("AARUNI_API_KEY") or local.get("api_key") or ""
        )
        self.region = region or os.environ.get("AARUNI_REGION") or local.get("region") or "ap-south-hyd-1"

        self.storage = _StorageService(self)
        self.archive = _ArchiveService(self)
        self.compute = _ComputeService(self)
        self.containers = _ContainersService(self)
        self.voice = _VoiceService(self)
        self.assistant = _AssistantService(self)
        self.knowledge = _KnowledgeService(self)
        self.render = _RenderService(self)
        self.guard = _GuardService(self)

    def status(self) -> Dict[str, Any]:
        return self._json("GET", "/v1/status")

    def services(self) -> Dict[str, Any]:
        return self._json("GET", "/v1/services")

    def _json(self, method: str, route: str, body_obj: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        headers = {
            "Accept": "application/json",
            "User-Agent": "aaruni-cloud-python/1.0.0",
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        data = None
        if body_obj is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body_obj).encode("utf-8")

        req = urllib.request.Request(f"{self.endpoint}{route}", data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(raw)
                raise AaruniCloudError(parsed.get("error", raw), e.code, parsed)
            except AaruniCloudError:
                raise
            except Exception:
                raise AaruniCloudError(raw, e.code)

    def _raw(self, method: str, route: str, body_bytes: bytes, extra_headers: Dict[str, str]) -> Dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "User-Agent": "aaruni-cloud-python/1.0.0",
            **extra_headers,
        }
        req = urllib.request.Request(f"{self.endpoint}{route}", data=body_bytes, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", errors="replace")
            raise AaruniCloudError(raw, e.code)
