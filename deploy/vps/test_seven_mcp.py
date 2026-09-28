"""Offline contract checks for the Seven MCP bridge."""

import unittest
from unittest.mock import patch

import seven_mcp


class SevenMCPTests(unittest.TestCase):
    def test_search_prefers_title(self):
        with patch.object(seven_mcp, "api", return_value={"notes": [
            {"id": "a", "title": "Projeto Gabi", "area": "projetos", "body": "Plano"},
            {"id": "b", "title": "Outra nota", "area": "meta", "body": "A Gabi participa"},
        ]}):
            self.assertEqual([item["id"] for item in seven_mcp.brain_search("Gabi")], ["a", "b"])

    def test_save_keeps_other_notes_and_uses_revision(self):
        profile = {"revision": "before", "notes": [
            {"id": "a", "title": "Existente", "area": "meta", "body": "Preservar", "links": [], "path": "Existente.md"},
        ]}
        calls = []

        def fake_api(path, payload=None):
            calls.append((path, payload))
            return profile if payload is None else {"revision": "after"}

        with patch.object(seven_mcp, "api", side_effect=fake_api):
            result = seven_mcp.brain_save("Nova nota", "projetos", "Decisão confirmada")
        self.assertTrue(result["saved"])
        self.assertEqual(calls[1][1]["revision"], "before")
        self.assertEqual(calls[1][1]["notes"][0]["body"], "Preservar")
        self.assertEqual(calls[1][1]["notes"][1]["body"], "Decisão confirmada")

    def test_save_rejects_duplicate_title(self):
        with patch.object(seven_mcp, "api", return_value={"revision": "r", "notes": [
            {"id": "a", "title": "Projeto Gabi", "area": "projetos", "body": "Texto"},
        ]}):
            with self.assertRaisesRegex(ValueError, "Já existe"):
                seven_mcp.brain_save("projeto gabi", "projetos", "Novo texto")

    def test_delegate_does_not_post_when_offline(self):
        with patch.object(seven_mcp, "squad_status", return_value={"online": False}), patch.object(seven_mcp, "api") as call:
            with self.assertRaisesRegex(RuntimeError, "offline"):
                seven_mcp.squad_delegate("seven", "Título", "Detalhes")
            call.assert_not_called()


if __name__ == "__main__":
    unittest.main()
