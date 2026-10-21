#!/usr/bin/env python3
"""Offline, fail-closed Linux kernel/build-context verification (stdlib only).

Never downloads or executes the kernel. Digests come from the selected platform's
manifest record, not the Windows record and not an invented upstream binary pin.
This checks local consistency; it is not a signature or remote provenance audit.
"""
import argparse
import hashlib
import hmac
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit

PINNED_VERSION = "v1.19.32"
MAX_BINARY_BYTES = 128 << 20
ELF_MACHINES = {"amd64": 62, "arm64": 183}


def records(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from records(child)
    elif isinstance(value, list):
        for child in value:
            yield from records(child)


def record_for(manifest, arch):
    if arch not in ELF_MACHINES:
        raise ValueError("supported target architectures: amd64, arm64")
    mihomo = manifest.get("mihomo", {})
    if not isinstance(mihomo, dict) or mihomo.get("version") != PINNED_VERSION:
        raise ValueError(f"manifest must pin Mihomo {PINNED_VERSION}")
    expected = f"bin/linux-{arch}/mihomo"
    matches = [item for item in records(mihomo) if item.get("binary_path") == expected]
    if len(matches) != 1:
        raise ValueError(f"expected one manifest record for {expected}; found {len(matches)}")
    record = dict(matches[0])
    if record.get("version", mihomo["version"]) != PINNED_VERSION:
        raise ValueError("platform record version differs from the pinned Mihomo version")
    if record.get("platform", f"linux-{arch}") != f"linux-{arch}":
        raise ValueError("platform metadata does not match the selected binary path")
    for field in ("binary_sha256", "archive_sha256"):
        if not isinstance(record.get(field), str) or not re.fullmatch(r"[0-9a-fA-F]{64}", record[field]):
            raise ValueError(f"missing/invalid per-platform {field}")
        record[field] = record[field].lower()
    if not isinstance(record.get("digest_source"), str) or not record["digest_source"].strip():
        raise ValueError("per-platform archive digest provenance is required")
    asset = record.get("asset", "")
    if not isinstance(asset, str) or not asset.startswith(f"mihomo-linux-{arch}-") or PINNED_VERSION not in asset or "/" in asset:
        raise ValueError("archive asset does not match the pinned Linux architecture/version")
    url = urlsplit(record.get("url", ""))
    if (url.scheme != "https" or url.netloc != "github.com" or url.query or url.fragment or
            url.path != f"/MetaCubeX/mihomo/releases/download/{PINNED_VERSION}/{asset}"):
        raise ValueError("archive URL must name the exact pinned upstream release asset")
    record["version"] = PINNED_VERSION
    record["platform"] = f"linux-{arch}"
    return record


def verify_binary(stream, arch, expected_sha256):
    if arch not in ELF_MACHINES:
        raise ValueError("unsupported ELF architecture")
    header = stream.read(64)
    if len(header) != 64 or header[:7] != b"\x7fELF\x02\x01\x01":
        raise ValueError("kernel must have a complete ELF64 little-endian header, not a Windows binary/archive")
    if int.from_bytes(header[16:18], "little") not in (2, 3):
        raise ValueError("kernel ELF type must be executable or position-independent executable")
    if int.from_bytes(header[18:20], "little") != ELF_MACHINES[arch]:
        raise ValueError(f"kernel ELF machine does not match linux-{arch}")
    digest = hashlib.sha256(header)
    total = len(header)
    while True:
        chunk = stream.read(1 << 20)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_BINARY_BYTES:
            raise ValueError("kernel exceeds the 128 MiB verification bound")
        digest.update(chunk)
    actual = digest.hexdigest()
    if not hmac.compare_digest(actual, expected_sha256.lower()):
        raise ValueError("kernel SHA256 does not match the selected platform manifest record")
    return actual


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--arch", required=True, choices=tuple(ELF_MACHINES))
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    try:
        meta = (args.root / "third_party" / "meta").resolve(strict=True)
        with (meta / "manifest.json").open(encoding="utf-8-sig") as stream:
            record = record_for(json.load(stream), args.arch)
        binary = meta / record["binary_path"]
        resolved = binary.resolve(strict=True)
        if binary.is_symlink() or not resolved.is_relative_to(meta) or not binary.is_file():
            raise ValueError("kernel must be a regular file inside third_party/meta")
        size = binary.stat().st_size
        if size < 64 or size > MAX_BINARY_BYTES:
            raise ValueError("kernel size must be 64 bytes through 128 MiB")
        with binary.open("rb") as stream:
            actual = verify_binary(stream, args.arch, record["binary_sha256"])
        print(json.dumps({
            "verified": True,
            "platform": record["platform"],
            "version": record["version"],
            "binary_path": record["binary_path"],
            "binary_sha256": actual,
            "binary_digest_source": "extracted binary digest recorded in manifest; not the compressed GitHub asset digest",
            "archive_sha256": record["archive_sha256"],
            "archive_digest_source": record["digest_source"],
            "archive_url": record["url"],
            "checks": ["local manifest", "ELF64 target architecture", "extracted binary SHA256"],
            "executed_kernel": False,
        }, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(f"Linux Mihomo verification failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
