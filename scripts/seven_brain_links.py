"""Refresh local Obsidian backlinks only when note content changes."""

from __future__ import annotations

import fcntl
import hashlib
import os
import subprocess
from pathlib import Path


HOME = Path.home()
VAULT = HOME / "Documents" / "Seven Brain"
TOOL_HOME = HOME / ".local" / "share" / "rhizome"
STATE_HOME = HOME / ".local" / "state" / "seven-brain"


def snapshot() -> str:
    digest = hashlib.sha256()
    for path in sorted(VAULT.rglob("*.md")):
        if ".obsidian" in path.parts:
            continue
        content = path.read_text(encoding="utf-8")
        # Rhizome owns this section. Its writes must not trigger another run.
        content = content.split("\n## Related Notes\n", 1)[0]
        digest.update(str(path.relative_to(VAULT)).encode("utf-8"))
        digest.update(content.encode("utf-8"))
    return digest.hexdigest()


def main() -> None:
    if not VAULT.is_dir():
        return
    STATE_HOME.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(STATE_HOME, 0o700)
    with (STATE_HOME / "lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        current = snapshot()
        marker = STATE_HOME / "content.sha256"
        if marker.exists() and marker.read_text(encoding="utf-8").strip() == current:
            return
        env = dict(os.environ)
        env.update(
            VAULT_PATH=str(VAULT),
            VAULT_APP="obsidian",
            MODEL_DIR=str(TOOL_HOME / "models"),
            LOG_DIR=str(STATE_HOME / "runs"),
            SIMILARITY_THRESHOLD="0.60",
            TOP_K="3",
            DRY_RUN="false",
        )
        log_path = STATE_HOME / "refresh.log"
        fd = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(fd, "a", encoding="utf-8") as log:
            result = subprocess.run(
                [str(HOME / ".local" / "bin" / "rhizome"), "run", "--yes"],
                cwd=TOOL_HOME,
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
                check=False,
            )
        if result.returncode == 0:
            marker.write_text(snapshot() + "\n", encoding="utf-8")
            os.chmod(marker, 0o600)


if __name__ == "__main__":
    main()
