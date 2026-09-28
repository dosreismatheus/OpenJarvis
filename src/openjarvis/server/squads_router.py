"""File-backed squad registry and read-only bridge to squad servers."""

from __future__ import annotations

import asyncio
import json
import os
import re
import threading
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Literal


router = APIRouter(prefix="/v1/seven/squads", tags=["seven-squads"])
_FILE = Path(os.environ.get("SEVEN_SQUADS_FILE", str(Path.home() / ".openjarvis" / "squads.json")))
_LOCK = threading.Lock()
_ID = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}$")


class SquadRegistration(BaseModel):
    id: str = Field(min_length=2, max_length=63)
    name: str = Field(min_length=1, max_length=100)
    url: str = Field(min_length=10, max_length=500)
    token_env: str = Field(default="", max_length=100)
    command_token_env: str = Field(default="", max_length=100)


class SquadRequest(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    details: str = Field(default="", max_length=4000)


class SquadReview(BaseModel):
    approved: bool
    feedback: str = Field(min_length=1, max_length=2000)


class SquadResume(BaseModel):
    feedback: str = Field(min_length=1, max_length=2000)


class SquadBrainEdit(BaseModel):
    path: str = Field(min_length=5, max_length=100)
    content: str = Field(min_length=1, max_length=20000)


class SquadRepositoryAttach(BaseModel):
    repository: str = Field(min_length=20, max_length=200, pattern=r"^https://github\.com/[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$")
    mode: Literal["existing", "new"]


def _valid_registration(value: SquadRegistration) -> SquadRegistration:
    if not _ID.fullmatch(value.id):
        raise HTTPException(422, "ID da squad deve conter letras minúsculas, números ou hífens")
    parts = urlsplit(value.url)
    if parts.username or parts.password or parts.query or parts.fragment or parts.path not in ("", "/"):
        raise HTTPException(422, "Informe apenas a origem do servidor, sem credenciais ou caminho")
    if parts.scheme == "http" and parts.hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise HTTPException(422, "Servidores remotos precisam usar HTTPS")
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        raise HTTPException(422, "URL do servidor inválida")
    for name in (value.token_env, value.command_token_env):
        if name and not re.fullmatch(r"[A-Z][A-Z0-9_]{1,99}", name):
            raise HTTPException(422, "Nome da variável de token inválido")
    return value


def _read() -> list[dict]:
    if not _FILE.exists():
        return []
    try:
        data = json.loads(_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, ValueError) as exc:
        raise HTTPException(500, "Não foi possível ler o cadastro de squads") from exc


def _write(items: list[dict]) -> None:
    _FILE.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    temporary = _FILE.with_name(_FILE.name + ".tmp")
    fd = os.open(temporary, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(items, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.replace(temporary, _FILE)
    finally:
        temporary.unlink(missing_ok=True)


async def _snapshot(item: dict) -> dict:
    base = item["url"].rstrip("/")
    headers = {}
    if item.get("token_env"):
        token = os.environ.get(item["token_env"], "")
        if not token:
            return {"id": item["id"], "name": item["name"], "url": base, "online": False, "error": f"Variável {item['token_env']} não configurada"}
        headers["Authorization"] = f"Bearer {token}"
    try:
        async with httpx.AsyncClient(timeout=5, follow_redirects=False, trust_env=False) as client:
            response = await client.get(f"{base}/v1/squad", headers=headers)
            response.raise_for_status()
            data = response.json()
        if not isinstance(data, dict) or data.get("schema_version") != 1 or data.get("id") != item["id"]:
            raise ValueError("Contrato de dados da squad incompatível")
        return {"id": item["id"], "name": item["name"], "url": base, "online": True, "data": data}
    except (httpx.HTTPError, ValueError) as exc:
        return {"id": item["id"], "name": item["name"], "url": base, "online": False, "error": str(exc)[:200]}


@router.get("")
async def list_squads() -> list[dict]:
    return await asyncio.gather(*(_snapshot(item) for item in _read()))


@router.get("/{squad_id}")
async def get_squad(squad_id: str) -> dict:
    item = next((item for item in _read() if item["id"] == squad_id), None)
    if not item:
        raise HTTPException(404, "Squad não encontrada")
    return await _snapshot(item)


@router.get("/{squad_id}/git/public-key")
async def get_squad_git_public_key(squad_id: str) -> dict:
    item = next((entry for entry in _read() if entry["id"] == squad_id), None)
    if not item:
        raise HTTPException(404, "Squad não encontrada")
    env_name = item.get("token_env", "")
    token = os.environ.get(env_name, "") if env_name else ""
    if env_name and not token:
        raise HTTPException(503, "Token de leitura da squad não configurado")
    try:
        async with httpx.AsyncClient(timeout=8, follow_redirects=False, trust_env=False) as client:
            response = await client.get(f"{item['url'].rstrip('/')}/v1/git/public-key", headers={"Authorization": f"Bearer {token}"} if token else {})
            response.raise_for_status()
            return response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(502, "Não foi possível obter a chave pública Git da squad") from exc


async def _codex_login(squad_id: str, method: str) -> dict:
    item = next((entry for entry in _read() if entry["id"] == squad_id), None)
    if not item:
        raise HTTPException(404, "Squad não encontrada")
    env_name = item.get("command_token_env" if method == "POST" else "token_env", "")
    token = os.environ.get(env_name, "") if env_name else ""
    if not token:
        raise HTTPException(503, "Token da squad não configurado")
    try:
        async with httpx.AsyncClient(timeout=18, follow_redirects=False, trust_env=False) as client:
            response = await client.request(method, f"{item['url'].rstrip('/')}/v1/codex/login", headers={"Authorization": f"Bearer {token}"})
            response.raise_for_status()
            return response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(502, "Não foi possível consultar o login Codex da squad") from exc


@router.get("/{squad_id}/codex/login")
async def get_squad_codex_login(squad_id: str) -> dict:
    return await _codex_login(squad_id, "GET")


@router.post("/{squad_id}/codex/login")
async def start_squad_codex_login(squad_id: str) -> dict:
    return await _codex_login(squad_id, "POST")


@router.post("/{squad_id}/git/repository")
async def attach_squad_repository(squad_id: str, incoming: SquadRepositoryAttach) -> dict:
    item = next((entry for entry in _read() if entry["id"] == squad_id), None)
    if not item:
        raise HTTPException(404, "Squad não encontrada")
    env_name = item.get("command_token_env", "")
    token = os.environ.get(env_name, "") if env_name else ""
    if not token:
        raise HTTPException(503, "Token de demandas da squad não configurado")
    try:
        async with httpx.AsyncClient(timeout=120, follow_redirects=False, trust_env=False) as client:
            response = await client.post(
                f"{item['url'].rstrip('/')}/v1/git/repository",
                headers={"Authorization": f"Bearer {token}"}, json=incoming.model_dump(),
            )
            if response.status_code in (409, 422):
                raise HTTPException(response.status_code, response.json().get("error", "A squad recusou o repositório"))
            response.raise_for_status()
            return response.json()
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(502, "Não foi possível vincular o repositório à squad") from exc


@router.get("/{squad_id}/brain")
async def get_squad_brain(squad_id: str) -> dict:
    item = next((item for item in _read() if item["id"] == squad_id), None)
    if not item:
        raise HTTPException(404, "Squad não encontrada")
    env_name = item.get("token_env", "")
    token = os.environ.get(env_name, "") if env_name else ""
    if env_name and not token:
        raise HTTPException(503, "Token de leitura desta squad não configurado no Seven")
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    try:
        async with httpx.AsyncClient(timeout=8, follow_redirects=False, trust_env=False) as client:
            response = await client.get(f"{item['url'].rstrip('/')}/v1/brain", headers=headers)
            response.raise_for_status()
            return response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(502, "Não foi possível consultar o cérebro da squad") from exc


@router.put("/{squad_id}/brain/note")
async def edit_squad_brain(squad_id: str, incoming: SquadBrainEdit) -> dict:
    item = next((item for item in _read() if item["id"] == squad_id), None)
    if not item:
        raise HTTPException(404, "Squad não encontrada")
    env_name = item.get("command_token_env", "")
    token = os.environ.get(env_name, "") if env_name else ""
    if not token:
        raise HTTPException(503, "Token de demandas desta squad não configurado no Seven")
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=False, trust_env=False) as client:
            response = await client.put(
                f"{item['url'].rstrip('/')}/v1/brain/note",
                headers={"Authorization": f"Bearer {token}"},
                json=incoming.model_dump(),
            )
            if response.status_code == 422:
                raise HTTPException(422, "A squad recusou o conteúdo desta nota")
            response.raise_for_status()
            return response.json()
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(502, "Não foi possível salvar o contexto da squad") from exc


@router.post("", status_code=201)
def register_squad(incoming: SquadRegistration) -> dict:
    item = _valid_registration(incoming).model_dump()
    item["url"] = item["url"].rstrip("/")
    with _LOCK:
        items = _read()
        if any(existing["id"] == item["id"] for existing in items):
            raise HTTPException(409, "Squad já cadastrada")
        if len(items) >= 100:
            raise HTTPException(422, "Limite de 100 squads alcançado")
        _write([*items, item])
    return {key: item[key] for key in ("id", "name", "url", "token_env", "command_token_env")}


@router.post("/{squad_id}/requests", status_code=201)
async def send_request(squad_id: str, incoming: SquadRequest) -> dict:
    item = next((item for item in _read() if item["id"] == squad_id), None)
    if not item:
        raise HTTPException(404, "Squad não encontrada")
    env_name = item.get("command_token_env", "")
    token = os.environ.get(env_name, "") if env_name else ""
    if not token:
        raise HTTPException(503, "Token de demandas desta squad não configurado no Seven")
    try:
        async with httpx.AsyncClient(timeout=8, follow_redirects=False, trust_env=False) as client:
            response = await client.post(
                f"{item['url'].rstrip('/')}/v1/requests",
                headers={"Authorization": f"Bearer {token}"},
                json=incoming.model_dump(),
            )
            response.raise_for_status()
            data = response.json()
        return data
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(502, "Não foi possível enviar a demanda ao gestor da squad") from exc


@router.post("/{squad_id}/requests/{request_id}/review")
async def review_request(squad_id: str, request_id: str, incoming: SquadReview) -> dict:
    if not re.fullmatch(r"[0-9a-f-]{36}", request_id):
        raise HTTPException(422, "ID da demanda inválido")
    item = next((item for item in _read() if item["id"] == squad_id), None)
    if not item:
        raise HTTPException(404, "Squad não encontrada")
    env_name = item.get("command_token_env", "")
    token = os.environ.get(env_name, "") if env_name else ""
    if not token:
        raise HTTPException(503, "Token de demandas desta squad não configurado no Seven")
    try:
        async with httpx.AsyncClient(timeout=8, follow_redirects=False, trust_env=False) as client:
            response = await client.post(
                f"{item['url'].rstrip('/')}/v1/requests/{request_id}/review",
                headers={"Authorization": f"Bearer {token}"},
                json=incoming.model_dump(),
            )
            if response.status_code == 409:
                raise HTTPException(409, "Esta demanda não está aguardando teste humano")
            response.raise_for_status()
            return response.json()
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(502, "Não foi possível registrar o teste humano") from exc


@router.post("/{squad_id}/requests/{request_id}/resume")
async def resume_request(squad_id: str, request_id: str, incoming: SquadResume) -> dict:
    if not re.fullmatch(r"[0-9a-f-]{36}", request_id):
        raise HTTPException(422, "ID da demanda inválido")
    item = next((item for item in _read() if item["id"] == squad_id), None)
    if not item:
        raise HTTPException(404, "Squad não encontrada")
    env_name = item.get("command_token_env", "")
    token = os.environ.get(env_name, "") if env_name else ""
    if not token:
        raise HTTPException(503, "Token de demandas desta squad não configurado no Seven")
    try:
        async with httpx.AsyncClient(timeout=8, follow_redirects=False, trust_env=False) as client:
            response = await client.post(
                f"{item['url'].rstrip('/')}/v1/requests/{request_id}/resume",
                headers={"Authorization": f"Bearer {token}"},
                json=incoming.model_dump(),
            )
            if response.status_code == 409:
                raise HTTPException(409, "Esta demanda não está bloqueada")
            response.raise_for_status()
            return response.json()
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(502, "Não foi possível retomar a demanda") from exc


@router.delete("/{squad_id}", status_code=204)
def remove_squad(squad_id: str) -> None:
    with _LOCK:
        items = _read()
        remaining = [item for item in items if item["id"] != squad_id]
        if len(remaining) == len(items):
            raise HTTPException(404, "Squad não encontrada")
        _write(remaining)
