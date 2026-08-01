import sys
import types

import numpy as np
import pytest
from PIL import Image

from packlab3d.backend.image_processing.segmentation import remove_background, segment_image
from packlab3d.core.utils.errors import ModelNotAvailableError


def test_segment_image_raises_without_dependencies():
    # torch / segment-anything are genuinely not installed in this environment.
    image = Image.new("RGB", (64, 64))
    with pytest.raises(ModelNotAvailableError):
        segment_image(image)


def _install_fake_sam(monkeypatch):
    fake_torch = types.ModuleType("torch")
    monkeypatch.setitem(sys.modules, "torch", fake_torch)

    fake_sa = types.ModuleType("segment_anything")

    class FakeSamPredictor:
        def __init__(self, sam):
            self.sam = sam
            self._image = None

        def set_image(self, image_np):
            self._image = image_np

        def predict(self, point_coords, point_labels, multimask_output=True):
            h, w = self._image.shape[:2]
            mask = np.zeros((h, w), dtype=bool)
            mask[h // 4 : 3 * h // 4, w // 4 : 3 * w // 4] = True
            n = 3 if multimask_output else 1
            masks = np.stack([mask] * n)
            scores = np.linspace(0.7, 0.95, n)
            return masks, scores, None

    fake_sa.SamPredictor = FakeSamPredictor
    fake_sa.sam_model_registry = {"vit_b": lambda checkpoint: f"fake-sam:{checkpoint}"}
    monkeypatch.setitem(sys.modules, "segment_anything", fake_sa)


def test_segment_image_mask_shape_and_alpha(tmp_path, monkeypatch):
    _install_fake_sam(monkeypatch)
    checkpoint = tmp_path / "fake_sam.pth"
    checkpoint.write_bytes(b"not-a-real-checkpoint")

    image = Image.new("RGB", (64, 48), color=(10, 20, 30))
    result = segment_image(image, checkpoint_path=str(checkpoint), model_type="vit_b")

    assert result.mask.shape == (48, 64)
    assert result.mask.dtype == bool
    assert result.foreground.size == (64, 48)
    assert result.foreground.mode == "RGBA"

    alpha = np.array(result.foreground)[:, :, 3]
    assert alpha[24, 32] == 255
    assert alpha[0, 0] == 0


def test_segment_image_missing_checkpoint_raises(monkeypatch):
    _install_fake_sam(monkeypatch)
    image = Image.new("RGB", (32, 32))
    with pytest.raises(ModelNotAvailableError):
        segment_image(image, checkpoint_path="/nonexistent/path.pth")


def test_remove_background_returns_rgba(tmp_path, monkeypatch):
    _install_fake_sam(monkeypatch)
    checkpoint = tmp_path / "fake_sam.pth"
    checkpoint.write_bytes(b"x")
    image = Image.new("RGB", (16, 16))
    fg = remove_background(image, checkpoint_path=str(checkpoint), model_type="vit_b")
    assert fg.mode == "RGBA"
