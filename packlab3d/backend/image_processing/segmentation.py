import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np
from PIL import Image

from packlab3d.core.utils.errors import ModelNotAvailableError

SAM_CHECKPOINT_ENV = "PACKLAB_SAM_CHECKPOINT"
DEFAULT_MODEL_TYPE = "vit_b"


@dataclass
class SegmentationResult:
    mask: np.ndarray
    foreground: Image.Image


def segment_image(
    image: Image.Image,
    checkpoint_path: Optional[str] = None,
    model_type: str = DEFAULT_MODEL_TYPE,
) -> SegmentationResult:
    """Isolate the main packaging object using Segment Anything (SAM).

    Uses a single center-point prompt as the default strategy since the UI does
    not yet supply a bounding box (Stage 8). Grounded-SAM box-prompt support can
    be added on top of this once text/box prompts are available.
    """
    try:
        import torch  # noqa: F401
        from segment_anything import SamPredictor, sam_model_registry
    except ImportError as exc:
        raise ModelNotAvailableError(
            "torch and segment-anything are required for image segmentation. "
            "Install with: pip install torch segment-anything"
        ) from exc

    checkpoint_path = checkpoint_path or os.environ.get(SAM_CHECKPOINT_ENV)
    if not checkpoint_path or not Path(checkpoint_path).exists():
        raise ModelNotAvailableError(
            f"SAM checkpoint not found. Set the {SAM_CHECKPOINT_ENV} environment "
            "variable or pass checkpoint_path explicitly. Download checkpoints from "
            "https://github.com/facebookresearch/segment-anything#model-checkpoints"
        )

    sam = sam_model_registry[model_type](checkpoint=checkpoint_path)
    predictor = SamPredictor(sam)

    image_rgb = image.convert("RGB")
    image_np = np.array(image_rgb)
    predictor.set_image(image_np)

    h, w = image_np.shape[:2]
    input_point = np.array([[w // 2, h // 2]])
    input_label = np.array([1])
    masks, scores, _ = predictor.predict(
        point_coords=input_point, point_labels=input_label, multimask_output=True
    )
    best_mask = masks[int(np.argmax(scores))]
    foreground = _apply_mask_alpha(image_rgb, best_mask)
    return SegmentationResult(mask=best_mask, foreground=foreground)


def remove_background(
    image: Image.Image,
    checkpoint_path: Optional[str] = None,
    model_type: str = DEFAULT_MODEL_TYPE,
) -> Image.Image:
    return segment_image(image, checkpoint_path=checkpoint_path, model_type=model_type).foreground


def _apply_mask_alpha(image_rgb: Image.Image, mask: np.ndarray) -> Image.Image:
    rgba_np = np.array(image_rgb.convert("RGBA"))
    rgba_np[:, :, 3] = mask.astype(np.uint8) * 255
    return Image.fromarray(rgba_np, mode="RGBA")
