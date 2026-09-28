"""Set explicit OpenClaw agent ownership before MCP CLI writes config.

OpenClaw 2026.9 requires this when a multi-agent legacy roster is present.
The existing config is preserved aside from this compatibility key.
"""

import json
import os
import tempfile
from pathlib import Path


config = Path("/var/lib/seven-openjarvis/.openclaw/openclaw.json")
data = json.loads(config.read_text(encoding="utf-8"))
agents = data.setdefault("agents", {})
if agents.get("ownership") not in (None, "explicit"):
    raise SystemExit("Existing agent ownership policy is not compatible")
if agents.get("entries", {}).get("main", {}).get("default") is not True and not agents.get("defaults", {}).get("systemAgent", {}).get("agentId"):
    raise SystemExit("Could not identify the existing default agent")
agents["ownership"] = "explicit"
agents.setdefault("defaults", {}).setdefault("systemAgent", {})["agentId"] = "main"
for entry in agents.get("entries", {}).values():
    entry.pop("default", None)
fd, name = tempfile.mkstemp(prefix=".openclaw-mcp-", dir=config.parent)
try:
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        json.dump(data, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(name, config)
finally:
    if os.path.exists(name):
        os.unlink(name)
print("OpenClaw agent ownership: explicit")
