"""Private MCP tools for the Seven CTO. Run over stdio as sevenjarvis."""

from __future__ import annotations

import json
import os
import re
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4

from mcp.server import MCPServer


BASE = os.environ.get("SEVEN_LOCAL_API", "http://127.0.0.1:8737").rstrip("/")
SQUAD_ID = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}$")
server = MCPServer("seven-operations")


def api(path: str, payload: dict | None = None, method: str | None = None) -> dict | list:
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(
        BASE + path,
        data=body,
        method=method or ("PUT" if path == "/v1/seven/profile" and body else "POST" if body else "GET"),
        headers={"Content-Type": "application/json"} if body else {},
    )
    try:
        with urlopen(request, timeout=20) as response:
            return json.load(response)
    except HTTPError as exc:
        raise RuntimeError(f"Seven API HTTP {exc.code}: {exc.read(300).decode('utf-8', 'replace')}") from exc
    except (URLError, TimeoutError) as exc:
        raise RuntimeError(f"Seven API indisponível: {exc}") from exc


def compact_squad(item: dict) -> dict:
    data = item.get("data") or {}
    return {
        "id": item.get("id"), "name": item.get("name"), "online": item.get("online"),
        "error": item.get("error"), "updated_at": data.get("updated_at"),
        "agents": data.get("agents", []),
        "cards": (data.get("board") or {}).get("cards", [])[-50:],
    }


@server.tool()
def squad_list() -> list[dict]:
    """Liste squads registradas, disponibilidade, agentes e cartões atuais."""
    return [compact_squad(item) for item in api("/v1/seven/squads")]


@server.tool()
def squad_status(squad_id: str) -> dict:
    """Consulte o status real de uma squad pelo ID antes de responder sobre progresso."""
    if not SQUAD_ID.fullmatch(squad_id):
        raise ValueError("ID de squad inválido")
    return compact_squad(api(f"/v1/seven/squads/{squad_id}"))


@server.tool()
def squad_delegate(squad_id: str, title: str, details: str) -> dict:
    """Envie demanda explicitamente solicitada pelo usuário a uma squad online. Não use para conversa exploratória."""
    if not SQUAD_ID.fullmatch(squad_id) or not 1 <= len(title.strip()) <= 160 or len(details) > 4000:
        raise ValueError("ID, título ou detalhes inválidos")
    status = squad_status(squad_id)
    if not status["online"]:
        raise RuntimeError(f"Squad {squad_id} offline; nenhuma demanda foi enviada")
    return api(f"/v1/seven/squads/{squad_id}/requests", {"title": title.strip(), "details": details.strip()})


@server.tool()
def brain_search(query: str, limit: int = 10) -> list[dict]:
    """Busque notas do Segundo Cérebro por título ou conteúdo, antes de responder sobre histórico ou salvar duplicatas."""
    if not 1 <= len(query.strip()) <= 200 or not 1 <= limit <= 30:
        raise ValueError("Busca ou limite inválido")
    terms = query.casefold().split()
    notes = api("/v1/seven/profile")["notes"]
    matches = []
    for note in notes:
        title = note["title"].casefold()
        body = note["body"].casefold()
        score = sum(3 if term in title else 1 if term in body else 0 for term in terms)
        if score:
            matches.append((score, {"id": note["id"], "title": note["title"], "area": note["area"], "excerpt": note["body"][:500]}))
    matches.sort(key=lambda item: (-item[0], item[1]["title"]))
    return [note for _, note in matches[:limit]]


@server.tool()
def brain_read(note_id: str) -> dict:
    """Leia uma nota completa do Segundo Cérebro pelo ID retornado em brain_search."""
    notes = api("/v1/seven/profile")["notes"]
    return next((note for note in notes if note["id"] == note_id), {"error": "Nota não encontrada"})


@server.tool()
def brain_save(title: str, area: str, body: str, note_id: str = "") -> dict:
    """Crie ou atualize uma nota quando a IA decidir que o usuário afirmou fato duradouro ou pediu registro. Para atualizar, informe o ID lido; nunca invente fatos."""
    title, area, body = title.strip(), area.strip(), body.strip()
    if not 2 <= len(title) <= 100 or not 1 <= len(area) <= 32 or not 1 <= len(body) <= 20000:
        raise ValueError("Título, área ou conteúdo fora dos limites")
    if any(char in title for char in "/\\:") or title in {".", ".."}:
        raise ValueError("Título inválido")
    for _ in range(2):
        profile = api("/v1/seven/profile")
        notes = profile["notes"]
        existing = next((note for note in notes if note["id"] == note_id), None) if note_id else None
        if note_id and not existing:
            raise ValueError("ID da nota não encontrado; busque novamente")
        if any(note["title"].casefold() == title.casefold() and note["id"] != note_id for note in notes):
            raise ValueError("Já existe nota com esse título; leia-a e use o ID para atualizar")
        record = {"id": note_id or str(uuid4()), "title": title, "area": area, "body": body, "links": existing.get("links", []) if existing else [], "path": existing.get("path", "") if existing else ""}
        profile["notes"] = [record if note["id"] == note_id else note for note in notes] if note_id else [*notes, record]
        try:
            saved = api("/v1/seven/profile", profile)
            return {"saved": True, "id": record["id"], "title": title, "revision": saved["revision"]}
        except RuntimeError as exc:
            if "HTTP 409" not in str(exc):
                raise
    raise RuntimeError("O cofre mudou durante a gravação; tente novamente")


if __name__ == "__main__":
    server.run()
