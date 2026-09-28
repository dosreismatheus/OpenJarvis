"""Local, private profile and notes for the Seven interface."""

from __future__ import annotations

import json
import os
import asyncio
import threading
import hashlib
import re
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4

import httpx

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field


router = APIRouter(prefix="/v1/seven", tags=["seven"])
_DATA_FILE = Path.home() / ".openjarvis" / "seven.json"
_VAULT = Path(os.environ.get("SEVEN_BRAIN_VAULT", str(Path.home() / "Documents" / "Seven Brain"))).expanduser()
_FRONTMATTER = re.compile(r"\A---\n(.*?)\n---\n?", re.DOTALL)
_WIKILINK = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]")
_MANAGED_SECTION = re.compile(r"(?m)^(?:## (?:Conexões|Related Notes)|<!-- rhizome:start -->)\s*$")
_memory_lock = threading.Lock()
_inbox_lock = threading.Lock()
_INBOX_DIR = Path(os.environ.get("SEVEN_MEMORY_INBOX", str(Path.home() / ".openclaw" / "seven-memory-inbox"))).expanduser()


class SevenNote(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    area: str = Field(min_length=1, max_length=32)
    title: str = Field(min_length=1, max_length=100)
    body: str = Field(min_length=1, max_length=1000000)
    links: list[str] = Field(default_factory=list)
    path: str = ""


class SevenProfile(BaseModel):
    name: str = Field(default="Seven", max_length=60)
    address: str = Field(default="senhor", max_length=60)
    persona: str = Field(default="formal", max_length=120)
    voice_enabled: bool = True
    voice_id: str = Field(default="pf_dora", min_length=1, max_length=80)
    voice_speed: float = Field(default=1.0, ge=0.5, le=2.0)
    notes: list[SevenNote] = Field(default_factory=list, max_length=10000)
    revision: str = ""


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class SevenChatTurn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    text: str = Field(min_length=1, max_length=4000)


class SevenChatRequest(BaseModel):
    conversation_id: UUID
    text: str = Field(min_length=1, max_length=16000)
    model: str | None = Field(default=None, max_length=200)
    history: list[SevenChatTurn] = Field(default_factory=list, max_length=8)


class SevenProviderKeyRequest(BaseModel):
    api_key: str = Field(min_length=1, max_length=4096)


class SevenAgentModelsRequest(BaseModel):
    primary: str = Field(min_length=3, max_length=200)
    fallbacks: list[str] = Field(default_factory=list, max_length=3)


def _capture_chat_message(request: SevenChatRequest) -> None:
    """Durably capture ingress before inference, including turns later cancelled."""
    now = datetime.now(timezone.utc)
    record = {
        "id": str(uuid4()),
        "at": now.isoformat(),
        "conversation_id": str(request.conversation_id),
        "text": request.text,
    }
    data = (json.dumps(record, ensure_ascii=False) + "\n").encode("utf-8")
    with _inbox_lock:
        _INBOX_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
        target = _INBOX_DIR / f"{now.date().isoformat()}.jsonl"
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        try:
            written = 0
            while written < len(data):
                count = os.write(fd, data[written:])
                if count <= 0:
                    raise OSError("incomplete Seven memory inbox write")
                written += count
            os.fsync(fd)
        finally:
            os.close(fd)


_model_cache: tuple[float, list[dict]] = (0, [])
_agent_settings_lock = asyncio.Lock()
_API_PROVIDERS = {
    "openai": "OpenAI · GPT",
    "anthropic": "Anthropic · Claude",
    "google": "Google · Gemini",
    "openrouter": "OpenRouter",
}


def _gateway_token() -> str:
    token_file = os.environ.get("OPENCLAW_GATEWAY_TOKEN_FILE")
    try:
        token = Path(token_file).read_text(encoding="utf-8").strip() if token_file else os.environ.get("OPENCLAW_GATEWAY_TOKEN", "").strip()
    except OSError as exc:
        raise HTTPException(status_code=503, detail="Token do OpenClaw indisponível") from exc
    if not token:
        raise HTTPException(status_code=503, detail="Token do OpenClaw não configurado")
    return token


def _require_agent_admin(request: Request, *, write: bool = False) -> None:
    """Only Caddy-authenticated Seven settings may manage OpenClaw credentials."""
    admin_user = os.environ.get("SEVEN_ADMIN_USER", "")
    admin_origin = os.environ.get("SEVEN_ADMIN_ORIGIN", "")
    if not admin_user or not admin_origin:
        raise HTTPException(status_code=503, detail="Administração do OpenClaw não configurada")
    if request.headers.get("x-seven-auth-user") != admin_user:
        raise HTTPException(status_code=403, detail="Acesso de administrador necessário")
    if write and request.headers.get("origin") != admin_origin:
        raise HTTPException(status_code=403, detail="Origem da requisição não autorizada")


async def _openclaw_cli(*arguments: str, input_text: str | None = None, timeout: int = 45) -> str:
    """Run the supported OpenClaw CLI as the Seven service user; never log input."""
    try:
        process = await asyncio.create_subprocess_exec(
            os.environ.get("OPENCLAW_BIN", "openclaw"), *arguments,
            stdin=asyncio.subprocess.PIPE if input_text is not None else asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(Path.home()),
            env={**os.environ, "OPENCLAW_GATEWAY_TOKEN": _gateway_token()},
        )
        try:
            stdout, _ = await asyncio.wait_for(
                process.communicate(input_text.encode() if input_text is not None else None), timeout=timeout
            )
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            raise
        if process.returncode != 0:
            raise ValueError("OpenClaw CLI failed")
        return stdout.decode("utf-8")
    except (OSError, ValueError, asyncio.TimeoutError) as exc:
        raise HTTPException(status_code=503, detail="Não foi possível atualizar o OpenClaw") from exc


async def _agent_settings() -> dict:
    try:
        status = json.loads(await _openclaw_cli("models", "status", "--json"))
        default = status.get("defaultModel") or ""
        fallbacks = status.get("fallbacks") or []
        profiles = status.get("auth", {}).get("oauth", {}).get("profiles", [])
        providers = status.get("auth", {}).get("providers", [])
        connected = {item.get("provider") for item in providers if isinstance(item, dict)}
        result = []
        for provider, label in _API_PROVIDERS.items():
            manual = any(
                isinstance(item, dict) and item.get("profileId") == f"{provider}:manual"
                and item.get("type") == "api_key"
                for item in profiles
            )
            configured = provider in connected or manual
            in_use = any(ref.startswith(f"{provider}/") for ref in [default, *fallbacks])
            result.append({
                "id": provider, "label": label, "configured": configured,
                "source": "panel" if manual else "external" if configured else "",
                "can_remove": manual and not in_use,
            })
        return {"default_model": default, "fallbacks": fallbacks, "providers": result}
    except (ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=503, detail="Estado dos modelos do OpenClaw indisponível") from exc


async def _model_catalog() -> list[dict]:
    """Read the agent's published model catalog, never a Seven-side provider list."""
    global _model_cache
    if time.monotonic() - _model_cache[0] < 300:
        return _model_cache[1]
    try:
        process = await asyncio.create_subprocess_exec(
            os.environ.get("OPENCLAW_BIN", "openclaw"), "models", "list", "--json",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            env={**os.environ, "OPENCLAW_GATEWAY_TOKEN": _gateway_token()},
        )
        try:
            stdout, _ = await asyncio.wait_for(process.communicate(), timeout=15)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            raise
        if process.returncode != 0:
            raise ValueError("model catalog unavailable")
        payload = json.loads(stdout)
        rows = payload if isinstance(payload, list) else payload.get("models", [])
        if not isinstance(rows, list):
            raise ValueError("invalid model catalog")
        models = []
        for row in rows:
            if isinstance(row, str):
                model = row
                name = row.split("/", 1)[-1]
                local = False
                available = True
            elif isinstance(row, dict):
                model = row.get("key") or row.get("ref") or row.get("id") or row.get("model")
                if isinstance(model, str) and "/" not in model and isinstance(row.get("provider"), str):
                    model = f'{row["provider"]}/{model}'
                name = row.get("name")
                local = row.get("local") is True
                available = row.get("available") is not False
            else:
                continue
            if isinstance(model, str) and "/" in model and available and not any(item["key"] == model for item in models):
                local = local or model.startswith("ollama/")
                models.append({
                    "key": model,
                    "name": name if isinstance(name, str) and name.strip() else model.split("/", 1)[1],
                    "provider": model.split("/", 1)[0],
                    "local": local,
                })
        _model_cache = (time.monotonic(), models)
        return models
    except (OSError, ValueError, asyncio.TimeoutError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=503, detail="Catálogo de modelos do OpenClaw indisponível") from exc


@router.get("/models")
async def seven_models() -> dict:
    catalog = await _model_catalog()
    return {"models": [item["key"] for item in catalog], "catalog": catalog}


@router.get("/agent-settings")
async def seven_agent_settings(request: Request) -> JSONResponse:
    _require_agent_admin(request)
    return JSONResponse(await _agent_settings(), headers={"Cache-Control": "no-store"})


@router.put("/agent-settings/keys/{provider}")
async def seven_save_provider_key(provider: str, payload: SevenProviderKeyRequest, request: Request) -> JSONResponse:
    _require_agent_admin(request, write=True)
    if provider not in _API_PROVIDERS:
        raise HTTPException(status_code=422, detail="Provedor não suportado")
    key = payload.api_key.strip()
    if not key or any(char.isspace() or ord(char) < 32 for char in key):
        raise HTTPException(status_code=422, detail="Chave de API inválida")
    async with _agent_settings_lock:
        # An explicit scope makes newly connected provider models visible to the picker.
        scope = json.dumps({f"{provider}/*": {"agentRuntime": {"id": "openclaw"}}})
        await _openclaw_cli("config", "set", "agents.defaults.models", scope, "--strict-json", "--merge")
        await _openclaw_cli("models", "auth", "paste-api-key", "--provider", provider,
                            input_text=key + "\n", timeout=75)
        global _model_cache
        _model_cache = (0, [])
    return JSONResponse({"saved": True}, headers={"Cache-Control": "no-store"})


@router.delete("/agent-settings/keys/{provider}")
async def seven_remove_provider_key(provider: str, request: Request) -> JSONResponse:
    _require_agent_admin(request, write=True)
    if provider not in _API_PROVIDERS:
        raise HTTPException(status_code=422, detail="Provedor não suportado")
    async with _agent_settings_lock:
        settings = await _agent_settings()
        current = next(item for item in settings["providers"] if item["id"] == provider)
        if not current["can_remove"]:
            raise HTTPException(status_code=409, detail="Escolha outro modelo padrão e remova os fallbacks deste provedor antes de apagar a chave")
        await _openclaw_cli("models", "auth", "logout", f"{provider}:manual", "--yes", timeout=75)
        global _model_cache
        _model_cache = (0, [])
    return JSONResponse({"removed": True}, headers={"Cache-Control": "no-store"})


@router.put("/agent-settings/models")
async def seven_save_agent_models(payload: SevenAgentModelsRequest, request: Request) -> JSONResponse:
    _require_agent_admin(request, write=True)
    primary = payload.primary.strip()
    fallbacks = [model.strip() for model in payload.fallbacks]
    if not primary or any(not model for model in fallbacks) or len({primary, *fallbacks}) != 1 + len(fallbacks):
        raise HTTPException(status_code=422, detail="Escolha modelos diferentes para padrão e fallbacks")
    async with _agent_settings_lock:
        available = {item["key"] for item in await _model_catalog()}
        if any(model not in available for model in [primary, *fallbacks]):
            raise HTTPException(status_code=422, detail="Selecione apenas modelos disponíveis no OpenClaw")
        await _openclaw_cli("config", "set", "agents.defaults.model",
                            json.dumps({"primary": primary, "fallbacks": fallbacks}), "--strict-json")
        global _model_cache
        _model_cache = (0, [])
    return JSONResponse({"saved": True}, headers={"Cache-Control": "no-store"})


@router.post("/chat")
async def seven_chat(request: SevenChatRequest) -> StreamingResponse:
    """Capture every turn, then send every chat model through OpenClaw."""
    model = request.model.strip() if request.model else ""
    catalog = await _model_catalog() if model else []
    selected = next((item for item in catalog if item["key"] == model), None) if model else None
    if model and selected is None:
        raise HTTPException(status_code=422, detail="Modelo não publicado pelo OpenClaw")
    try:
        await asyncio.to_thread(_capture_chat_message, request)
    except OSError as exc:
        raise HTTPException(status_code=503, detail="Não foi possível registrar a mensagem para o Segundo Cérebro") from exc
    headers = {"Authorization": f"Bearer {_gateway_token()}", "Content-Type": "application/json"}
    if model:
        headers["x-openclaw-model"] = model
    gateway = os.environ.get("OPENCLAW_GATEWAY_URL", "http://127.0.0.1:18789").rstrip("/")
    client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=None))
    try:
        upstream = await client.send(
            client.build_request(
                "POST", f"{gateway}/v1/chat/completions", headers=headers,
                json={
                    "model": "openclaw/main",
                    "user": f"seven:{request.conversation_id}",
                    "messages": [{"role": "user", "content": request.text}],
                    "stream": True,
                },
            ),
            stream=True,
        )
        if upstream.status_code != 200:
            await upstream.aclose()
            raise HTTPException(status_code=502, detail=f"OpenClaw recusou a conversa ({upstream.status_code})")
    except httpx.HTTPError as exc:
        await client.aclose()
        raise HTTPException(status_code=503, detail="Gateway do OpenClaw indisponível") from exc
    except HTTPException:
        await client.aclose()
        raise

    async def events():
        try:
            async for chunk in upstream.aiter_bytes():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def _speech_text(text: str) -> str:
    """Turn displayed chat text into natural speech without reading markup."""
    text = re.sub(r"(?i)\b(?:7\s*build|seven\s*build)\b", "seven bilde", text)
    text = re.sub(r"R\$\s*([\d.,]+)", r"\1 reais", text)
    text = re.sub(r"(?<=\d)\.(?=\d{3}\b)", "", text)
    text = text.replace("%", " por cento ")
    text = "".join(" " if unicodedata.category(char)[0] in {"P", "S"} else char for char in text)
    return re.sub(r"\s+", " ", text).strip()


def _read_config() -> dict:
    if not _DATA_FILE.exists():
        return {}
    try:
        return json.loads(_DATA_FILE.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Não foi possível ler o perfil do Seven") from exc


def _parse_frontmatter(content: str) -> tuple[dict[str, str], str]:
    match = _FRONTMATTER.match(content)
    if not match:
        return {}, content
    values = {}
    for line in match.group(1).splitlines():
        key, separator, value = line.partition(":")
        if separator:
            value = value.strip()
            try:
                values[key.strip()] = json.loads(value)
            except json.JSONDecodeError:
                values[key.strip()] = value.strip('"\'')
    return values, content[match.end():]


def _vault_snapshot() -> tuple[list[SevenNote], str]:
    _VAULT.mkdir(mode=0o700, parents=True, exist_ok=True)
    digest = hashlib.sha256()
    records = []
    for path in sorted(_VAULT.rglob("*.md")):
        if ".obsidian" in path.parts:
            continue
        raw = path.read_text(encoding="utf-8")
        digest.update(str(path.relative_to(_VAULT)).encode())
        digest.update(raw.encode())
        metadata, text = _parse_frontmatter(raw)
        section = _MANAGED_SECTION.search(text)
        body = (text[:section.start()] if section else text).strip()
        if not body:
            continue
        note_id = str(metadata.get("id") or "obsidian-" + hashlib.sha1(str(path.relative_to(_VAULT)).encode()).hexdigest()[:16])
        area = str(metadata.get("area") or "meta")
        records.append((SevenNote(id=note_id, area=area, title=path.stem, body=body, path=str(path.relative_to(_VAULT))), path, raw))
    titles = {note.title.casefold(): note.id for note, _, _ in records}
    notes = []
    for note, _, raw in records:
        linked = []
        for target in _WIKILINK.findall(raw):
            target_id = titles.get(Path(target).stem.casefold())
            if target_id and target_id != note.id and target_id not in linked:
                linked.append(target_id)
        notes.append(note.model_copy(update={"links": linked}))
    return notes, digest.hexdigest()


def _read_profile() -> SevenProfile:
    try:
        config = _read_config()
        notes, revision = _vault_snapshot()
        return SevenProfile.model_validate({**config, "notes": notes, "revision": revision})
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Não foi possível ler o cofre do Seven") from exc


def _safe_note_path(title: str, parent: Path = _VAULT) -> Path:
    if title in {".", ".."} or any(char in title for char in "/\\:"):
        raise HTTPException(status_code=422, detail="Título de nota inválido para nome de arquivo")
    if not parent.resolve().is_relative_to(_VAULT.resolve()):
        raise HTTPException(status_code=422, detail="Pasta de notas inválida")
    return parent / f"{title}.md"


def _write_text(path: Path, content: str) -> None:
    temporary = path.with_name(path.name + ".tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            file.write(content)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _write_notes(incoming: list[SevenNote], current: list[SevenNote]) -> None:
    current_by_id = {note.id: note for note in current}
    incoming_ids = {note.id for note in incoming}
    destinations = [_safe_note_path(note.title, (_VAULT / current_by_id[note.id].path).parent if note.id in current_by_id else _VAULT) for note in incoming]
    if len(set(destinations)) != len(destinations):
        raise HTTPException(status_code=422, detail="Os títulos das notas devem ser únicos")
    for note in incoming:
        prior = current_by_id.get(note.id)
        old_path = _VAULT / prior.path if prior else None
        destination = _safe_note_path(note.title, old_path.parent if old_path else _VAULT)
        if destination.exists() and destination != old_path:
            raise HTTPException(status_code=409, detail=f"O arquivo da nota já existe: {note.title}")
        if prior and (note.title, note.area, note.body) == (prior.title, prior.area, prior.body):
            continue
        tail = ""
        if old_path and old_path.exists():
            _, old_text = _parse_frontmatter(old_path.read_text(encoding="utf-8"))
            section = _MANAGED_SECTION.search(old_text)
            tail = old_text[section.start():].strip() if section else ""
        content = f'---\nid: {json.dumps(note.id, ensure_ascii=False)}\narea: {json.dumps(note.area, ensure_ascii=False)}\n---\n\n{note.body.strip()}\n'
        if tail:
            content += f"\n{tail}\n"
        _write_text(destination, content)
        if old_path and old_path != destination:
            old_path.unlink()
            for other in _VAULT.rglob("*.md"):
                raw = other.read_text(encoding="utf-8")
                revised = raw.replace(f"[[{prior.title}]]", f"[[{note.title}]]")
                if revised != raw:
                    _write_text(other, revised)
    for prior in current:
        if prior.id not in incoming_ids:
            (_VAULT / prior.path).unlink(missing_ok=True)


@router.get("/profile", response_model=SevenProfile)
def get_profile() -> SevenProfile:
    return _read_profile()


@router.put("/profile", response_model=SevenProfile)
def put_profile(profile: SevenProfile) -> SevenProfile:
    ids = [note.id for note in profile.notes]
    if len(ids) != len(set(ids)):
        raise HTTPException(status_code=422, detail="Os identificadores das notas devem ser únicos")
    with _memory_lock:
        current, revision = _vault_snapshot()
        if profile.revision != revision:
            raise HTTPException(status_code=409, detail="Notas alteradas no Obsidian. Recarregue a página antes de salvar.")
        _write_notes(profile.notes, current)
        _DATA_FILE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        config = profile.model_dump(exclude={"notes", "revision"})
        _write_text(_DATA_FILE, json.dumps(config, ensure_ascii=False, indent=2) + "\n")
        return _read_profile()


_tts_backend = None
_piper_backend = None
_tts_lock = threading.Lock()


def _synthesize(text: str, voice_id: str, speed: float) -> bytes:
    global _tts_backend, _piper_backend
    # Both local synthesizers keep a reusable model instance. Serialize requests
    # so a replay and a new answer do not run through one instance together.
    with _tts_lock:
        if voice_id == "pm_faber":
            if _piper_backend is None:
                from openjarvis.speech.piper_tts import SevenPiperTTS

                _piper_backend = SevenPiperTTS()
            return _piper_backend.synthesize(text, speed)
        if _tts_backend is None:
            from openjarvis.speech.kokoro_tts import KokoroTTSBackend

            _tts_backend = KokoroTTSBackend()
        return _tts_backend.synthesize(
            text, voice_id=voice_id, speed=speed, output_format="wav"
        ).audio


@router.post("/speak")
async def speak(request: SpeakRequest) -> Response:
    """Generate Portuguese speech locally from the configured Kokoro voice."""
    profile = _read_profile()
    if not profile.voice_enabled:
        raise HTTPException(status_code=409, detail="A voz do Seven está desativada")
    spoken = _speech_text(request.text)
    if not spoken:
        raise HTTPException(status_code=422, detail="Não há texto para falar")
    try:
        audio = await asyncio.to_thread(
            _synthesize, spoken, profile.voice_id, profile.voice_speed
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Falha ao sintetizar a voz: {exc}") from exc
    if not audio:
        raise HTTPException(status_code=503, detail="A síntese de voz não produziu áudio")
    return Response(audio, media_type="audio/wav")
