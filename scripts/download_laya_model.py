#!/usr/bin/env python3
"""Download the Laya model checkpoint files for bundling in the Docker image.

This script uses huggingface_hub.snapshot_download to download only the root
English checkpoint files needed by laya, avoiding unnecessary model weights
and reducing image size.
"""

import argparse
import logging
import shutil
from pathlib import Path

from huggingface_hub import snapshot_download

logger = logging.getLogger(__name__)


def download_laya_model(
    repo: str,
    output: Path,
    revision: str,
) -> Path:
    """Download the Laya English checkpoint from Hugging Face.

    Args:
        repo: Hugging Face repository ID.
        output: Local directory to download the model to.
        revision: Git revision (tag/branch/commit) of the model.

    Returns:
        The path to the downloaded model directory.

    """
    logger.info(f"Downloading laya model from {repo} (revision {revision}) to {output}")

    downloaded = snapshot_download(
        repo_id=repo,
        revision=revision,
        local_dir=output,
        allow_patterns=[
            "rl_agent_config.json",
            "model.safetensors",
            "tokenizer/*",
            "encoder/*",
        ],
    )

    cache_dir = output / ".cache"
    if cache_dir.is_dir():
        shutil.rmtree(cache_dir)
    logger.info(f"Model downloaded to: {downloaded}")
    return Path(downloaded)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Download the Laya model checkpoint for Docker bundling.",
    )
    parser.add_argument(
        "--repo",
        default="convaiinnovations/laya",
        help="Hugging Face repository ID (default: convaiinnovations/laya)",
    )
    parser.add_argument(
        "--output",
        default="/app/models/laya",
        type=Path,
        help="Local directory to download the model to (default: /app/models/laya)",
    )
    parser.add_argument(
        "--revision",
        default="55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851",
        help="Git revision (tag/branch/commit) of the model",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Enable verbose logging",
    )

    args = parser.parse_args()

    if args.verbose:
        logging.basicConfig(level=logging.INFO)
    else:
        logging.basicConfig(level=logging.WARNING)

    output_dir = download_laya_model(args.repo, args.output, args.revision)
    print(str(output_dir))


if __name__ == "__main__":
    main()
