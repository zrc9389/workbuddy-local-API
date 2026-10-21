#!/usr/bin/env python3
"""Offline unit/static checks only; no Docker, services, network, or temp files."""
import copy
import hashlib
import io
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
VERIFY = runpy.run_path(str(HERE / "verify-mihomo.py"))
BASH = next((str(p) for p in (
    Path("C:/Program Files/Git/bin/bash.exe"),
    Path("C:/Program Files/Git/usr/bin/bash.exe"),
) if p.is_file()), None) if os.name == "nt" else shutil.which("bash")


def elf(arch="amd64"):
    header = bytearray(64)
    header[:7] = b"\x7fELF\x02\x01\x01"
    header[16:18] = (2).to_bytes(2, "little")
    header[18:20] = ({"amd64": 62, "arm64": 183}[arch]).to_bytes(2, "little")
    return bytes(header) + b"synthetic test bytes, not an executable"


def entry(arch="amd64"):
    asset = f"mihomo-linux-{arch}-v1.19.32.gz"
    return {
        "platform": f"linux-{arch}",
        "binary_path": f"bin/linux-{arch}/mihomo",
        "binary_sha256": hashlib.sha256(elf(arch)).hexdigest(),
        "asset": asset,
        "url": f"https://github.com/MetaCubeX/mihomo/releases/download/v1.19.32/{asset}",
        "archive_sha256": "a" * 64,
        "digest_source": "GitHub official release asset digest (compressed archive)",
    }


def manifest(arch="amd64"):
    return {"mihomo": {"version": "v1.19.32", "platforms": {f"linux-{arch}": entry(arch)}}}


class ManifestTests(unittest.TestCase):
    def test_accepts_both_arches_without_duplicating_pins(self):
        for arch in ("amd64", "arm64"):
            with self.subTest(arch=arch):
                record = VERIFY["record_for"](manifest(arch), arch)
                self.assertEqual(record["binary_sha256"], entry(arch)["binary_sha256"])

    def test_accepts_platform_records_in_a_list(self):
        doc = {"mihomo": {"version": "v1.19.32", "platforms": [entry()]}}
        self.assertEqual(VERIFY["record_for"](doc, "amd64")["platform"], "linux-amd64")

    def test_rejects_windows_only_manifest(self):
        doc = {"mihomo": {"version": "v1.19.32", "binary_path": "bin/windows-amd64/mihomo.exe"}}
        with self.assertRaises(ValueError):
            VERIFY["record_for"](doc, "amd64")

    def test_rejects_duplicate_matching_records(self):
        doc = manifest()
        doc["mihomo"]["copy"] = copy.deepcopy(entry())
        with self.assertRaises(ValueError):
            VERIFY["record_for"](doc, "amd64")

    def test_rejects_incomplete_or_wrong_provenance(self):
        for key, value in (
            ("binary_sha256", "not-a-hash"),
            ("archive_sha256", "not-a-hash"),
            ("digest_source", ""),
            ("platform", "linux-arm64"),
            ("url", "https://github.com/MetaCubeX/mihomo/releases/latest/download/mihomo.gz"),
            ("asset", "mihomo-windows-amd64-v1.19.32.zip"),
            ("version", "v0.0.0"),
        ):
            with self.subTest(key=key):
                doc = manifest()
                doc["mihomo"]["platforms"]["linux-amd64"][key] = value
                with self.assertRaises(ValueError):
                    VERIFY["record_for"](doc, "amd64")

    def test_never_inherits_windows_archive_digest(self):
        doc = manifest()
        doc["mihomo"]["archive_sha256"] = "b" * 64
        del doc["mihomo"]["platforms"]["linux-amd64"]["archive_sha256"]
        with self.assertRaises(ValueError):
            VERIFY["record_for"](doc, "amd64")

    def test_rejects_missing_platform_and_version(self):
        for doc, arch in ((manifest(), "386"), (manifest(), "arm64"), ({"mihomo": {}}, "amd64")):
            with self.subTest(arch=arch, doc=doc):
                with self.assertRaises(ValueError):
                    VERIFY["record_for"](doc, arch)


class BinaryTests(unittest.TestCase):
    def verify(self, payload, arch="amd64", digest=None):
        return VERIFY["verify_binary"](io.BytesIO(payload), arch, digest or hashlib.sha256(payload).hexdigest())

    def test_accepts_correct_elf_and_digest(self):
        for arch in ("amd64", "arm64"):
            with self.subTest(arch=arch):
                self.assertEqual(self.verify(elf(arch), arch), hashlib.sha256(elf(arch)).hexdigest())

    def test_rejects_wrong_architecture_even_when_digest_matches(self):
        with self.assertRaises(ValueError):
            self.verify(elf("amd64"), "arm64")

    def test_rejects_wrong_digest(self):
        with self.assertRaises(ValueError):
            self.verify(elf(), digest="0" * 64)

    def test_rejects_windows_and_truncated_files(self):
        for payload in (b"MZ" + bytes(80), b"\x7fELF", b""):
            with self.subTest(payload=payload):
                with self.assertRaises(ValueError):
                    self.verify(payload)

    def test_rejects_32bit_bigendian_and_non_executable_elf(self):
        for offset, value in ((4, 1), (5, 2), (16, 1)):
            with self.subTest(offset=offset):
                payload = bytearray(elf())
                payload[offset] = value
                with self.assertRaises(ValueError):
                    self.verify(bytes(payload))

    def test_rejects_oversized_file_with_bounded_reads(self):
        function = VERIFY["verify_binary"]
        with patch.dict(function.__globals__, MAX_BINARY_BYTES=80):
            with self.assertRaises(ValueError):
                self.verify(elf() + bytes(100))


class ArtifactTests(unittest.TestCase):
    def text(self, path):
        return (ROOT / path).read_text(encoding="utf-8")

    def test_shell_scripts_are_lf_without_bom(self):
        for name in ("start.sh", "healthcheck.sh", "package-start.sh"):
            payload = (HERE / name).read_bytes()
            with self.subTest(name=name):
                self.assertTrue(payload.startswith(b"#!/bin/sh\n"))
                self.assertNotIn(b"\r", payload)

    def test_systemd_identity_paths_and_shutdown(self):
        service = self.text("deployment/linux/workbuddy-local.service")
        for directive in (
            "User=workbuddy-local", "Group=workbuddy-local",
            "WorkingDirectory=/opt/workbuddy-local", "UMask=0077",
            "KillMode=mixed", "KillSignal=SIGTERM", "TimeoutStopSec=120s", "SendSIGKILL=yes",
            "Restart=on-failure", "ReadWritePaths=/etc/workbuddy-local /var/lib/workbuddy-local",
        ):
            with self.subTest(directive=directive):
                self.assertIn(directive, service)
        self.assertNotIn("MemoryMax=", service)
        self.assertNotIn("EnvironmentFile=", service)

    def test_docker_selects_target_linux_binary_and_verifies(self):
        dockerfile = self.text("Dockerfile")
        self.assertIn("bin/linux-${TARGETARCH}/mihomo", dockerfile)
        self.assertIn("verify-mihomo.py", dockerfile)
        self.assertIn('GOARCH="${TARGETARCH}"', dockerfile)
        self.assertIn("USER 10001:10001", dockerfile)
        self.assertIn("ca-certificates", dockerfile)
        self.assertIn("tzdata", dockerfile)
        self.assertIn("STOPSIGNAL SIGTERM", dockerfile)
        self.assertNotIn("mihomo.exe", dockerfile)
        self.assertNotIn("COPY . .", dockerfile)
        self.assertNotIn("/healthz", dockerfile)

    def test_compose_preserves_loopback_and_writable_config_directory(self):
        compose = self.text("docker-compose.yml")
        self.assertIn("network_mode: host", compose)
        self.assertNotIn("ports:", compose)
        self.assertIn("stop_grace_period: 120s", compose)
        self.assertIn("source: ./runtime/config", compose)
        self.assertIn("target: /etc/workbuddy-local", compose)
        self.assertIn("create_host_path: false", compose)
        self.assertNotIn("mem_limit:", compose)
        self.assertNotIn("PASSWORD:", compose)

    def test_healthcheck_uses_exact_200_session_not_pool_readiness(self):
        script = self.text("deployment/linux/healthcheck.sh")
        self.assertIn("/auth/session", script)
        self.assertIn('"$status" = 200', script)
        self.assertNotIn("/healthz", script)

    def test_sample_has_loopback_persistent_paths_and_small_budgets(self):
        import json
        sample = json.loads(self.text("deployment/linux/config.json.example"))
        self.assertEqual(sample["listen"], "127.0.0.1:7863")
        self.assertEqual(sample["auth_dir"], "/var/lib/workbuddy-local/auths")
        self.assertEqual(sample["state_file"], "/var/lib/workbuddy-local/state.json")
        self.assertTrue(sample["memory"]["persistent"])
        self.assertNotIn("api_key", sample)
        self.assertNotIn("password", sample)


@unittest.skipUnless(BASH, "Bash is not installed; shell execution checks skipped")
class ShellTests(unittest.TestCase):
    def shell(self, code, script, **extra_env):
        env = dict(os.environ, **extra_env)
        return subprocess.run([BASH, "-c", code, "offline-test", script], cwd=ROOT,
                              env=env, capture_output=True, text=True, timeout=10)

    def test_shell_syntax(self):
        result = subprocess.run([BASH, "-n", str(HERE / "start.sh"), str(HERE / "healthcheck.sh"), str(HERE / "package-start.sh")],
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_help_does_not_start_or_require_linux(self):
        result = self.shell('bash "$1" --help', "deployment/linux/start.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Usage:", result.stdout)

    def test_rejects_extra_arguments(self):
        result = self.shell('bash "$1" /unused /unexpected', "deployment/linux/start.sh")
        self.assertEqual(result.returncode, 64, result.stderr)

    def test_refuses_root_without_touching_runtime(self):
        code = ('uname() { case "$1" in -s) printf Linux;; -m) printf x86_64;; esac; }; '
                'id() { printf 0; }; export -f uname id; bash "$1"')
        result = self.shell(code, "deployment/linux/start.sh")
        self.assertEqual(result.returncode, 77, result.stderr)
        self.assertIn("Refusing root", result.stderr)

    def test_rejects_unsupported_arch_without_touching_runtime(self):
        code = ('uname() { case "$1" in -s) printf Linux;; -m) printf riscv64;; esac; }; '
                'export -f uname; bash "$1"')
        result = self.shell(code, "deployment/linux/start.sh")
        self.assertEqual(result.returncode, 69, result.stderr)

    def test_rejects_relative_config_without_touching_runtime(self):
        code = ('uname() { case "$1" in -s) printf Linux;; -m) printf x86_64;; esac; }; '
                'id() { printf 10001; }; export -f uname id; bash "$1" relative.json')
        result = self.shell(code, "deployment/linux/start.sh")
        self.assertEqual(result.returncode, 64, result.stderr)
        self.assertIn("absolute config", result.stderr)

    def test_liveness_status_and_network_error_without_network(self):
        # A shell stub replaces curl. This is NOT an HTTP/runtime test.
        code = ('curl() { printf "%s" "$MOCK_STATUS"; return "$MOCK_EXIT"; }; '
                'export -f curl; bash "$1"')
        for status, curl_exit, expected in (("200", "0", 0), ("503", "0", 1),
                                             ("302", "0", 1), ("000", "0", 1), ("200", "7", 1)):
            with self.subTest(status=status, curl_exit=curl_exit):
                result = self.shell(code, "deployment/linux/healthcheck.sh",
                                    MOCK_STATUS=status, MOCK_EXIT=curl_exit)
                self.assertEqual(result.returncode, expected, result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
