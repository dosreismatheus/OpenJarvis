"""Lightweight Portuguese speech using the Piper model from the original Seven."""

from __future__ import annotations

import io
import os
from pathlib import Path


class SevenPiperTTS:
    def __init__(self) -> None:
        import sherpa_onnx

        configured = os.environ.get("SEVEN_PIPER_MODEL_DIR")
        candidates = [Path(configured)] if configured else []
        candidates.extend(
            [
                Path.home() / ".openjarvis/models/vits-piper-pt_BR-faber-medium",
                Path("/opt/seven/models/vits-piper-pt_BR-faber-medium"),
            ]
        )
        model_dir = next(
            (path for path in candidates if (path / "pt_BR-faber-medium.onnx").is_file()),
            None,
        )
        if model_dir is None:
            raise RuntimeError("Modelo Piper Faber não encontrado; configure SEVEN_PIPER_MODEL_DIR")

        config = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                    model=str(model_dir / "pt_BR-faber-medium.onnx"),
                    tokens=str(model_dir / "tokens.txt"),
                    data_dir=str(model_dir / "espeak-ng-data"),
                ),
                num_threads=2,
                provider="cpu",
            ),
        )
        if not config.validate():
            raise RuntimeError("Os arquivos do modelo Piper estão incompletos")
        self._tts = sherpa_onnx.OfflineTts(config)

    def synthesize(self, text: str, speed: float) -> bytes:
        import soundfile as sf

        audio = self._tts.generate(text=text, sid=0, speed=speed)
        if len(audio.samples) == 0:
            return b""
        output = io.BytesIO()
        sf.write(output, audio.samples, audio.sample_rate, format="WAV")
        return output.getvalue()
