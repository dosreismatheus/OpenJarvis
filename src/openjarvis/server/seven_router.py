"""Local, private profile and notes for the Seven interface."""

from __future__ import annotations

import json
import os
import asyncio
import threading
import hashlib
import re
import unicodedata
from datetime import datetime
from pathlib import Path
from uuid import uuid4

import httpx

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field


router = APIRouter(prefix="/v1/seven", tags=["seven"])
_DATA_FILE = Path.home() / ".openjarvis" / "seven.json"
_VAULT = Path.home() / "Documents" / "Seven Brain"
_FRONTMATTER = re.compile(r"\A---\n(.*?)\n---\n?", re.DOTALL)
_WIKILINK = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]")
_MANAGED_SECTION = re.compile(r"(?m)^(?:## (?:Conexões|Related Notes)|<!-- rhizome:start -->)\s*$")
_memory_lock = threading.Lock()
_MEMORY_AREAS = {"voce", "metas", "trabalho", "projetos", "financas", "aprendizado", "saude", "relacoes", "interesses", "meta"}


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


class MemoryTurn(BaseModel):
    turn_id: str = Field(pattern=r"^[a-fA-F0-9-]{8,80}$")
    user_text: str = Field(min_length=1, max_length=4000)
    assistant_text: str | None = Field(default=None, max_length=8000)


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


def _topic_key(title: str) -> str:
    return "".join(char for char in unicodedata.normalize("NFD", title.casefold()) if unicodedata.category(char) != "Mn")


def _fallback_topics(user_text: str) -> list[dict]:
    """Keep a recognizable topic if the local extractor is unavailable."""
    match = re.search(r"(?i)\b(?:sobre|a respeito de|comprar|adquirir|gosto\s+(?:muito\s+)?de)\s+(?:(?:um|uma|o|a)\s+)?([\wÀ-ÿ][\wÀ-ÿ-]*(?:\s+[\wÀ-ÿ][\wÀ-ÿ-]*){0,2})", user_text)
    if not match:
        return []
    words = re.split(r"(?i)\s+(?:que|quando|para|porque|pois|mas|e|tal)\b", match.group(1))[0]
    title = words.strip(" .,?!:;\n\t").title()
    purchase = bool(re.search(r"(?i)\b(?:quero|pretendo|planejo|vou)\s+(?:comprar|adquirir)\b", user_text))
    preference = bool(re.search(r"(?i)\bgosto\s+(?:muito\s+)?de\b", user_text))
    return [{"title": title, "area": "interesses" if preference else "metas" if purchase else "aprendizado", "summary": f"Matheus gosta de {title}." if preference else f"Matheus pesquisou sobre {title}.", "intent": f"Matheus quer comprar {title}." if purchase else "", "related": []}] if title else []


async def _extract_topics(turn: MemoryTurn) -> list[dict]:
    existing, _ = await asyncio.to_thread(_vault_snapshot)
    titles = [note.title for note in existing if note.area != "conversas"][-100:]
    instruction = (
        'Extraia assuntos duradouros desta troca para um Segundo Cérebro. Não copie nem guarde mensagens da conversa; escreva apenas fatos e intenções curtos. Responda SOMENTE JSON no formato '
        '{"topics":[{"title":"Lego","area":"aprendizado","summary":"...","intent":"...","related":["..."]}]}. '
        'Crie um tópico para um assunto pesquisado mesmo quando Matheus apenas faz uma pergunta. '
        'Registre interesses e preferências duradouras, como gostar de Lego, na área interesses. '
        'Se ele disser que quer comprar algo, registre a intenção no tópico do produto e relacione modelos específicos ao tema principal. '
        'Use títulos curtos e estáveis; reaproveite títulos existentes quando forem o mesmo assunto. '
        'Não crie tópicos para saudações, perguntas sobre a identidade do assistente ou frases sem assunto novo. '
        'Não invente fatos, decisões nem intenções. Use até três tópicos. Áreas: voce, metas, trabalho, projetos, financas, aprendizado, saude, relacoes, interesses, meta. '
        f'Títulos já existentes: {json.dumps(titles, ensure_ascii=False)}.'
    )
    payload = {
        "model": os.environ.get("SEVEN_MEMORY_MODEL", "qwen3.5:2b"),
        "stream": False,
        "format": "json",
        "options": {"temperature": 0, "num_predict": 450},
        "messages": [
            {"role": "system", "content": instruction},
            {"role": "user", "content": f"Matheus: {turn.user_text}\nSeven: {turn.assistant_text or ''}"},
        ],
    }
    host = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(f"{host}/api/chat", json=payload)
            response.raise_for_status()
        content = response.json().get("message", {}).get("content", "")
        parsed = json.loads(content)
        topics = parsed.get("topics", [])
        if isinstance(topics, list) and topics:
            return topics[:3]
    except (httpx.HTTPError, ValueError, TypeError, KeyError):
        pass
    return _fallback_topics(turn.user_text)


def _append_topic_memories(turn: MemoryTurn, topics: list[dict]) -> list[str]:
    saved: list[str] = []
    with _memory_lock:
        existing, _ = _vault_snapshot()
        by_title = {_topic_key(note.title): note for note in existing}
        candidate_titles = {_topic_key(note.title): note.title for note in existing}
        for item in topics[:3]:
            if isinstance(item, dict):
                candidate = re.sub(r"[\\/:\[\]#\n\r]+", " ", str(item.get("title", ""))).strip(" .")[:100]
                if candidate:
                    candidate_titles[_topic_key(candidate)] = candidate
        for item in topics[:3]:
            if not isinstance(item, dict):
                continue
            title = re.sub(r"[\\/:\[\]#\n\r]+", " ", str(item.get("title", ""))).strip(" .")[:100]
            if not title or _topic_key(title).startswith("conversa "):
                continue
            prior = by_title.get(_topic_key(title))
            if prior:
                title = prior.title
            topic_id = prior.id if prior else str(uuid4())
            area = str(item.get("area", "meta"))
            area = area if area in _MEMORY_AREAS else "meta"
            path = _VAULT / prior.path if prior else _safe_note_path(title)
            if path.exists():
                raw = path.read_text(encoding="utf-8")
                if f"<!-- seven:memory:{turn.turn_id} -->" in raw:
                    saved.append(title)
                    continue
                _, text = _parse_frontmatter(raw)
                section = _MANAGED_SECTION.search(text)
                body = text[:section.start()].rstrip() if section else text.rstrip()
                tail = text[section.start():].lstrip() if section else ""
                frontmatter = raw[:len(raw) - len(text)]
            else:
                frontmatter = f'---\nid: {json.dumps(topic_id)}\narea: {json.dumps(area)}\n---\n\n'
                body, tail = "", ""
            summary = " ".join(str(item.get("summary", "")).split())[:500]
            intent = " ".join(str(item.get("intent", "")).split())[:500]
            related = item.get("related", [])
            related_titles = [candidate_titles[_topic_key(name)] for name in related if isinstance(name, str) and _topic_key(name) in candidate_titles and _topic_key(name) != _topic_key(title)] if isinstance(related, list) else []
            related_titles += [name for key, name in candidate_titles.items() if key != _topic_key(title) and _topic_key(title).startswith(key + " ")]
            if area == "interesses" and "matheus henrique" in candidate_titles:
                related_titles.append(candidate_titles["matheus henrique"])
            entry = f"<!-- seven:memory:{turn.turn_id} -->\n- {datetime.now().astimezone():%Y-%m-%d}: {summary or f'Matheus mencionou {title}.'}"
            if intent:
                entry += f"\n  - Intenção: {intent}"
            if related_titles:
                entry += "\n  - Relacionado: " + ", ".join(f"[[{name}]]" for name in dict.fromkeys(related_titles))
            if "## Registros do Seven" not in body:
                body += "\n\n## Registros do Seven"
            body += "\n" + entry
            raw = frontmatter + body.lstrip() + "\n"
            if tail:
                raw += "\n" + tail.rstrip() + "\n"
            _write_text(path, raw)
            saved.append(title)
            by_title[_topic_key(title)] = SevenNote(id=topic_id, area=area, title=title, body=body, path=str(path.relative_to(_VAULT)))
    return saved


@router.post("/memory/turn")
async def remember_turn(turn: MemoryTurn) -> dict:
    if turn.assistant_text is None:
        return {"topics": []}
    topics = await _extract_topics(turn)
    saved = await asyncio.to_thread(_append_topic_memories, turn, topics)
    return {"topics": saved}


_tts_backend = None
_tts_lock = threading.Lock()


def _synthesize(text: str, voice_id: str, speed: float) -> bytes:
    global _tts_backend
    # Kokoro shares one pipeline instance. Serialize requests so a replay and a
    # new answer cannot run through that instance at the same time.
    with _tts_lock:
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
