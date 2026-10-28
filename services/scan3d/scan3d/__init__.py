"""Basement Ready scan3d: MapAnything frames-to-room service."""

# Apache-2.0 weights only; facebook/map-anything is CC-BY-NC. See docs/research/mapanything.md.
MODEL_ID = "facebook/map-anything-apache"
MODEL_REVISION = "00f9c245bbcb60522d1ed7f9e9d88462c6e3f38a"
MODEL_CODE_TAG = "v1.1.3"


class ScanError(ValueError):
    """Bad input the caller can fix (too few frames, unreadable images, bad measurement)."""
