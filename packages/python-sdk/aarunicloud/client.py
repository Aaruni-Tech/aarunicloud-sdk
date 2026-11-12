import base64
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
    for folder in (".acloud", ".aaruni"):
        cred_path = Path.home() / folder / "credentials.json"
        if cred_path.exists():
            try:
                return json.loads(cred_path.read_text(encoding="utf-8"))
            except Exception:
                continue
    return {}


class _AuthService:
    def __init__(self, client: "Client"):
        self._c = client

    def guest_trial(self, email: str, name: str = "Cloud Developer") -> Dict[str, Any]:
        res = self._c._json("POST", "/v1/auth/guest-trial", {"email": email, "name": name})
        if res.get("apiKey"):
            self._c.api_key = res["apiKey"]
        return res

    def request_otp(self, email: str, name: str = "") -> Dict[str, Any]:
        return self._c._json("POST", "/v1/auth/request-otp", {"email": email, "name": name})

    def verify_otp(self, email: str, code: str) -> Dict[str, Any]:
        res = self._c._json("POST", "/v1/auth/verify-otp", {"email": email, "code": code})
        if res.get("apiKey"):
            self._c.api_key = res["apiKey"]
        return res


class _AccountService:
    def __init__(self, client: "Client"):
        self._c = client

    def me(self) -> Dict[str, Any]:
        return self._c._json("GET", "/v1/account/me")

    def upgrade(self, target_plan: str = "creator", notes: str = "") -> Dict[str, Any]:
        return self._c._json("POST", "/v1/account/upgrade", {"plan": target_plan, "notes": notes})


class _OrgsService:
    def __init__(self, client: "Client"):
        self._c = client

    def list(self) -> Dict[str, Any]:
        return self._c._json("GET", "/v1/orgs")

    def create(self, display_name: str, slug: Optional[str] = None, monthly_cap_inr: int = 0) -> Dict[str, Any]:
        return self._c._json("POST", "/v1/orgs", {
            "displayName": display_name,
            "slug": slug,
            "monthlyCapInr": monthly_cap_inr,
        })


class _ProjectsService:
    def __init__(self, client: "Client"):
        self._c = client

    def list(self) -> Dict[str, Any]:
        return self._c._json("GET", "/v1/projects")

    def get(self, project_id: str = "prj_syllovo_prod") -> Dict[str, Any]:
        return self._c._json("GET", f"/v1/projects/{urllib.parse.quote(project_id)}")

    def runtime_config(self, project_id: str = "prj_syllovo_prod") -> Dict[str, Any]:
        return self._c._json("GET", f"/v1/projects/{urllib.parse.quote(project_id)}/runtime-config")

    def public_manifest(self, project_id: str = "prj_syllovo_prod") -> Dict[str, Any]:
        return self._c._json("GET", f"/v1/projects/{urllib.parse.quote(project_id)}/public-manifest")

    def secrets(self, project_id: str = "prj_syllovo_prod") -> Dict[str, Any]:
        return self._c._json("GET", f"/v1/projects/{urllib.parse.quote(project_id)}/secrets")

    def set_secret(self, project_id: str, key: str, value: str) -> Dict[str, Any]:
        return self._c._json("POST", f"/v1/projects/{urllib.parse.quote(project_id)}/secrets", {"key": key, "value": value})

    def deploy(self, project_id: str = "prj_syllovo_prod", payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return self._c._json("POST", f"/v1/projects/{urllib.parse.quote(project_id)}/deploy", payload or {})


class _BuilderService:
    def __init__(self, client: "Client"):
        self._c = client

    def plan(self, prompt: str, project_id: str = "prj_syllovo_prod", app_name: str = "ai-saas-app") -> Dict[str, Any]:
        return self._c._json("POST", "/v1/builder/plan", {
            "prompt": prompt,
            "projectId": project_id,
            "appName": app_name,
        })


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
        space_clean = space.replace("acs://", "").replace("cloud://", "").strip("/")
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

    def download(self, key: str, space: str = "sandbox", byte_range: Optional[str] = None) -> bytes:
        space_clean = space.replace("acs://", "").replace("cloud://", "").strip("/")
        route = f"/v1/storage/{urllib.parse.quote(space_clean)}/{urllib.parse.quote(key)}"
        headers = {
            "Authorization": f"Bearer {self._c.api_key}",
            "User-Agent": "aarunicloud-python/1.0.0",
        }
        if byte_range:
            headers["Range"] = byte_range
        req = urllib.request.Request(f"{self._c.endpoint}{route}", headers=headers, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", errors="replace")
            raise AaruniCloudError(raw, e.code)

    def delete(self, key: str, space: str = "sandbox") -> Dict[str, Any]:
        space_clean = space.replace("acs://", "").replace("cloud://", "").strip("/")
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

    def launch(self, node_type: str = "cloud.m4.max", storage: str = "cloud://sandbox", region: Optional[str] = None) -> Dict[str, Any]:
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

    def consent_challenge(self) -> Dict[str, Any]:
        return self._c._json("GET", "/v1/voice/consent-challenge")

    def list(self) -> Dict[str, Any]:
        return self._c._json("GET", "/v1/voice/list")

    def clone(
        self,
        name: str,
        wav_file_or_bytes: Union[str, Path, bytes],
        consent_code: str,
        consent_phrase: str,
        ref_text: str = "",
        language: str = "en-IN",
    ) -> Dict[str, Any]:
        if isinstance(wav_file_or_bytes, (str, Path)):
            audio_bytes = Path(wav_file_or_bytes).read_bytes()
        else:
            audio_bytes = bytes(wav_file_or_bytes)
        audio_b64 = base64.b64encode(audio_bytes).decode("ascii")
        return self._c._json("POST", "/v1/voice/clone", {
            "name": name,
            "audioBase64": audio_b64,
            "consentCode": consent_code,
            "consentPhrase": consent_phrase,
            "refText": ref_text or consent_phrase,
            "language": language,
        })

    def delete(self, voice_id: str) -> Dict[str, Any]:
        return self._c._json("DELETE", f"/v1/voice/{urllib.parse.quote(voice_id)}")

    def speak(
        self,
        text: str,
        voice_id: str = "aria",
        target_lufs: float = -12.0,
        engine: Optional[str] = None,
        speed: Optional[float] = None,
        steps: Optional[int] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "text": text,
            "voiceId": voice_id,
            "persona": voice_id,
            "targetLufs": target_lufs,
        }
        if engine:
            payload["engine"] = engine
        if speed is not None:
            payload["speed"] = speed
        if steps is not None:
            payload["steps"] = steps
        return self._c._json("POST", "/v1/voice/speak", payload)

    def synthesize(
        self,
        text: str,
        persona: str = "aria",
        target_lufs: float = -12.0,
        engine: Optional[str] = None,
        speed: Optional[float] = None,
        steps: Optional[int] = None,
    ) -> Dict[str, Any]:
        return self.speak(text=text, voice_id=persona, target_lufs=target_lufs, engine=engine, speed=speed, steps=steps)


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
            endpoint
            or os.environ.get("ACLOUD_ENDPOINT")
            or os.environ.get("AARUNI_ENDPOINT")
            or local.get("endpoint")
            or "https://api.aarunicloud.com"
        ).rstrip("/")
        self.api_key = (
            api_key
            or os.environ.get("ACLOUD_API_KEY")
            or os.environ.get("AARUNI_API_KEY")
            or local.get("api_key")
            or ""
        )
        self.region = (
            region
            or os.environ.get("ACLOUD_REGION")
            or os.environ.get("AARUNI_REGION")
            or local.get("region")
            or "ap-south-hyd-1"
        )

        self.auth = _AuthService(self)
        self.account = _AccountService(self)
        self.orgs = _OrgsService(self)
        self.projects = _ProjectsService(self)
        self.builder = _BuilderService(self)
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
            "User-Agent": "aarunicloud-python/1.0.0",
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
            "User-Agent": "aarunicloud-python/1.0.0",
            **extra_headers,
        }
        req = urllib.request.Request(f"{self.endpoint}{route}", data=body_bytes, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", errors="replace")
            raise AaruniCloudError(raw, e.code)
