"""Review Seven's durable inbox, then file notes with a separate local model.

Run as the sevenjarvis user from an OpenClaw command automation. The chat agent
is never invoked by this process. The reviewer uses a lightweight remote model;
the local Ollama writer chooses the destination and this process persists it.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4


HOME = Path.home()
INBOX = Path(os.environ.get("SEVEN_MEMORY_INBOX", HOME / ".openclaw/seven-memory-inbox"))
VAULT = Path(os.environ.get("SEVEN_BRAIN_VAULT", HOME / "Documents/Seven Brain"))
STATE = Path(os.environ.get("SEVEN_MEMORY_STATE", HOME / ".openclaw/seven-memory-review.sqlite"))
TOKEN_FILE = Path(os.environ.get("OPENCLAW_GATEWAY_TOKEN_FILE", HOME / ".openclaw/gateway.token"))
GATEWAY = os.environ.get("OPENCLAW_GATEWAY_URL", "http://127.0.0.1:18789").rstrip("/")
OLLAMA = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
WRITER_MODEL = os.environ.get("SEVEN_MEMORY_WRITER_MODEL", "qwen3.5:2b")
AREAS = {"voce", "metas", "trabalho", "projetos", "financas", "aprendizado", "saude", "relacoes", "interesses", "meta"}


def chat(agent: str, prompt: str, *, timeout: int) -> str:
    token = TOKEN_FILE.read_text(encoding="utf-8").strip()
    body = json.dumps({
        "model": f"openclaw/{agent}",
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
    }, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{GATEWAY}/v1/chat/completions",
        data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.load(response)
    text = payload.get("choices", [{}])[0].get("message", {}).get("content", "")
    if not isinstance(text, str) or not text.strip():
        raise RuntimeError(f"{agent} returned no text")
    return text.strip()


def json_object(text: str) -> dict:
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        first, last = text.find("{"), text.rfind("}")
        if first < 0 or last <= first:
            raise ValueError("reviewer did not return JSON") from None
        value = json.loads(text[first:last + 1])
    if not isinstance(value, dict):
        raise ValueError("reviewer returned a non-object")
    return value


def vault_outline() -> list[dict]:
    notes = []
    for path in sorted(VAULT.rglob("*.md")):
        if len(notes) >= 500:
            break
        try:
            body = path.read_text(encoding="utf-8")
        except OSError:
            continue
        notes.append({"title": path.stem, "summary": re.sub(r"\s+", " ", body)[:500]})
    return notes


def marker_exists(marker: str) -> bool:
    for path in VAULT.rglob("*.md"):
        try:
            if marker in path.read_text(encoding="utf-8"):
                return True
        except OSError:
            continue
    return False


def pending_messages(db: sqlite3.Connection, limit: int = 30) -> list[dict]:
    pending = []
    total_chars = 0
    for path in sorted(INBOX.glob("*.jsonl")):
        with path.open(encoding="utf-8") as stream:
            for raw in stream:
                try:
                    item = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not isinstance(item.get("text"), str):
                    continue
                if db.execute("SELECT 1 FROM processed WHERE id=?", (item["id"],)).fetchone():
                    continue
                # Bound the review context. An oversized turn is handled alone.
                size = min(len(item["text"]), 4000)
                if pending and (len(pending) >= limit or total_chars + size > 12000):
                    return pending
                pending.append({"id": item["id"], "at": item.get("at", ""), "text": item["text"][:4000]})
                total_chars += size
    return pending


def review(items: list[dict]) -> list[dict]:
    prompt = (
        "Revise estas mensagens de Matheus para o Segundo Cérebro. Retorne SOMENTE JSON no formato "
        '{"items":[{"source_ids":["uuid"],"area":"metas","title":"Título curto",'
        '"fact":"Fato objetivo sobre Matheus"}]}. '
        "Extraia apenas preferências estáveis, metas, decisões, compromissos e fatos pessoais claramente afirmados. "
        "Uma frase pode misturar meta e pergunta; extraia só a meta. Ignore perguntas avulsas, saudações, "
        "hipóteses, sugestões do assistente, senhas e tokens. Não deduza times, datas, pessoas ou intenções. "
        "Evite fatos já cobertos nas notas existentes, salvo se houver atualização real. Use [] se nada merecer nota. "
        "Não escreva arquivos.\n\nNotas existentes:\n"
        + json.dumps(vault_outline(), ensure_ascii=False)
        + "\n\nMensagens:\n" + json.dumps(items, ensure_ascii=False)
    )
    result = json_object(chat("memory-reviewer", prompt, timeout=300))
    raw_items = result.get("items")
    if not isinstance(raw_items, list) or len(raw_items) > 20:
        raise ValueError("reviewer returned invalid items")
    valid_ids = {item["id"] for item in items}
    decisions = []
    for candidate in raw_items:
        if not isinstance(candidate, dict):
            raise ValueError("invalid candidate")
        source_ids = candidate.get("source_ids")
        area, title, fact = candidate.get("area"), candidate.get("title"), candidate.get("fact")
        if not isinstance(source_ids, list) or not source_ids or any(not isinstance(source_id, str) or source_id not in valid_ids for source_id in source_ids):
            raise ValueError("candidate has invalid source IDs")
        if area not in AREAS or not isinstance(title, str) or not 2 <= len(title.strip()) <= 100:
            raise ValueError("candidate has invalid title/area")
        if not isinstance(fact, str) or not 8 <= len(fact.strip()) <= 600:
            raise ValueError("candidate has invalid fact")
        clean = {"source_ids": sorted(set(source_ids)), "area": area, "title": title.strip(), "fact": fact.strip()}
        digest = hashlib.sha256(json.dumps(clean, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:20]
        clean["marker"] = f"<!-- seven:memory:{digest} -->"
        decisions.append(clean)
    return decisions


def choose_note_locally(candidate: dict) -> str:
    """Use cheap local inference for filing; never let model output become a path."""
    titles = [path.stem for path in sorted(VAULT.glob("*.md")) if path.is_file()][:200]
    prompt = (
        "Escolha uma nota existente para registrar o fato. Se nenhuma servir, escolha NOVA. "
        "Responda SOMENTE JSON: {\"nota\":\"título exato ou NOVA\"}. "
        "Não invente título.\n"
        f"Fato: {candidate['fact']}\nTítulo sugerido: {candidate['title']}\n"
        f"Notas: {json.dumps(titles, ensure_ascii=False)}"
    )
    body = json.dumps({
        "model": WRITER_MODEL,
        "prompt": prompt,
        "format": "json",
        "think": False,
        "stream": False,
        "options": {"num_ctx": 1536, "num_predict": 60, "temperature": 0},
    }, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{OLLAMA}/api/generate", data=body, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        result = json.load(response)
    answer = json_object(result.get("response", ""))
    chosen = answer.get("nota")
    if not isinstance(chosen, str):
        raise ValueError("local writer returned no note title")
    # Exact-title matches take priority even if the small model is uncertain.
    for title in titles:
        if title.casefold() == candidate["title"].casefold():
            return title
    if chosen == "NOVA":
        return "NOVA"
    for title in titles:
        if title.casefold() == chosen.casefold():
            return title
    return "NOVA"


def _new_note_path(title: str) -> Path:
    safe = re.sub(r'[<>:"/\\|?*\x00-\x1f]', " ", title).strip(" .")[:100]
    if not safe:
        raise ValueError("empty note title")
    return VAULT / f"{safe}.md"


def _save_atomic(path: Path, content: str) -> None:
    VAULT.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=".seven-memory-", suffix=".md", dir=VAULT)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temp_name, 0o600)
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def write_with_local_agent(candidate: dict) -> None:
    marker = candidate["marker"]
    if marker_exists(marker):
        return
    title = choose_note_locally(candidate)
    path = _new_note_path(candidate["title"] if title == "NOVA" else title)
    if path.is_symlink():
        raise ValueError("refusing symlink note")
    fact = candidate["fact"].strip().rstrip(".") + "."
    if path.exists():
        current = path.read_text(encoding="utf-8")
        if fact.casefold() in current.casefold():
            updated = current.rstrip() + f"\n\n{marker}\n"
        else:
            updated = current.rstrip() + f"\n\n## Registros do Seven\n{marker}\n- {fact}\n"
    else:
        updated = (
            f'---\nid: "{uuid4()}"\narea: "{candidate["area"]}"\n---\n\n'
            f"{fact}\n{marker}\n\n## Conexões\n\n- [[Matheus Henrique]]\n"
        )
    _save_atomic(path, updated)
    if not marker_exists(marker):
        raise RuntimeError("local writer did not persist the candidate")


def main() -> int:
    INBOX.mkdir(parents=True, exist_ok=True)
    STATE.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(STATE) as db:
        db.execute("CREATE TABLE IF NOT EXISTS processed (id TEXT PRIMARY KEY, at TEXT NOT NULL)")
        reviewed = notes = 0
        for _ in range(10):
            items = pending_messages(db)
            if not items:
                break
            candidates = review(items)
            for candidate in candidates:
                write_with_local_agent(candidate)
            now = datetime.now(timezone.utc).isoformat()
            db.executemany("INSERT OR IGNORE INTO processed (id, at) VALUES (?, ?)", [(item["id"], now) for item in items])
            db.commit()
            reviewed += len(items)
            notes += len(candidates)
        print(f"Revisadas {reviewed} mensagens; {notes} notas registradas.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError, urllib.error.URLError, TimeoutError) as exc:
        print(f"Seven memory review failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(1)
