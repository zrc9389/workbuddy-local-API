#!/bin/sh
# Pinned Mihomo installer: official v1.19.32 assets only; no service/proxy/TUN setup.
# Source SHA-256 and upstream archive digests: third_party/meta/manifest.json.
set -eu
umask 022

fail() { printf '%s\n' "meta-install-linux: $*" >&2; exit 1; }
usage() {
    printf '%s\n' 'Usage: sh scripts/meta-install-linux.sh [--arch amd64|arm64] [--destination DIR] [--archive FILE.gz]'
    printf '%s\n' 'Default: host architecture, third_party/meta/bin/linux-ARCH next to this script.'
    printf '%s\n' 'Existing matching binary: verify then chmod 0755; any other existing target is refused.'
    printf '%s\n' 'No overwrite, cleanup, system-service installation, root requirement, TUN or system proxy.'
}

arch=''
destination=''
local_archive=''
while [ "$#" -gt 0 ]; do
    case "$1" in
        --arch|--destination|--archive)
            [ "$#" -ge 2 ] || fail "missing value for $1"
            [ -n "$2" ] || fail "empty value for $1"
            case "$1" in
                --arch) arch=$2 ;;
                --destination) destination=$2 ;;
                --archive) local_archive=$2 ;;
            esac
            shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) usage >&2; fail "unknown argument: $1" ;;
    esac
done

[ "$(uname -s)" = Linux ] || fail 'Linux required'
if [ -z "$arch" ]; then
    case "$(uname -m)" in
        x86_64|amd64) arch=amd64 ;;
        aarch64|arm64) arch=arm64 ;;
        *) fail 'unsupported architecture (only Linux amd64 and arm64 are pinned)' ;;
    esac
fi
version=v1.19.32
archive_max=33554432
binary_max=134217728
case "$arch" in
    amd64)
        asset=mihomo-linux-amd64-compatible-v1.19.32.gz
        archive_size=22877876
        archive_sha=ba3ce607747a07f948fc35780e108a4a7c7f552a38b9bd4d115f313ebcb89c20
        binary_size=62054526
        binary_sha=7a0d59da2e678d56c899a3db996a2ad8963286c4f3634b0451435db248f13fa1 ;;
    arm64)
        asset=mihomo-linux-arm64-v1.19.32.gz
        archive_size=20809592
        archive_sha=9dd862e28b46ff7d775f169cceebc28deccaa0a9e804237d421cd2571e0caba0
        binary_size=57409662
        binary_sha=c80df2ca5159567804da883401e0118908fc1155e05df2baf3dbd4d3ecfc3754 ;;
    *) fail 'unsupported architecture (only Linux amd64 and arm64 are pinned)' ;;
esac
url="https://github.com/MetaCubeX/mihomo/releases/download/$version/$asset"
for tool in sha256sum wc chmod; do
    command -v "$tool" >/dev/null 2>&1 || fail "required tool not found: $tool"
done
sha() { result=$(sha256sum < "$1"); printf '%s' "${result%% *}"; }
if [ -z "$destination" ]; then
    script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
    destination="$script_dir/../third_party/meta/bin/linux-$arch"
fi
mkdir -p -- "$destination"
destination=$(CDPATH= cd -- "$destination" && pwd -P)
target="$destination/mihomo"

# Idempotent repair for executable bits lost during ZIP/Windows transfer. Do not
# chmod or replace an unverified binary, symlink, directory or dangling symlink.
if [ -e "$target" ] || [ -L "$target" ]; then
    [ -f "$target" ] && [ ! -L "$target" ] || fail 'existing target is not a regular non-symlink file'
    size=$(wc -c < "$target")
    [ "$size" -gt 0 ] && [ "$size" -le "$binary_max" ] || fail 'existing kernel exceeds size bound'
    [ "$(sha "$target")" = "$binary_sha" ] || fail 'existing kernel checksum mismatch; not replaced or chmodded'
    chmod 0755 "$target"
    printf '%s\n' "version=$version platform=linux-$arch source=existing-pinned-binary" "binary_sha256=$binary_sha" "mode=0755 path=$target"
    exit 0
fi

for tool in mktemp head gzip timeout ln; do
    command -v "$tool" >/dev/null 2>&1 || fail "required tool not found: $tool"
done
if [ -n "$local_archive" ]; then
    [ -f "$local_archive" ] && [ ! -L "$local_archive" ] || fail 'offline archive must be a regular non-symlink file'
    size=$(wc -c < "$local_archive")
    [ "$size" -gt 0 ] && [ "$size" -le "$archive_max" ] || fail 'archive size bound exceeded'
else
    command -v curl >/dev/null 2>&1 || fail 'curl required to download the official pinned archive'
fi
stage=$(mktemp -d "$destination/.mihomo-$version-XXXXXX")
archive="$stage/$asset"
pending="$stage/mihomo.pending"
# Leave verified source archives and failed staging files for audit; no cleanup.
printf '%s\n' "stage=$stage" "source=$url"
if [ -n "$local_archive" ]; then
    head -c "$((archive_max + 1))" "$local_archive" > "$archive"
else
    # Ignore user curl config, never forward credentials or downgrade HTTPS.
    # One attempt; hard deadline and size cap, checked again before extraction.
    curl -q --fail --silent --show-error --location --max-redirs 5 \
        --proto '=https' --proto-redir '=https' --noproxy '*' \
        --connect-timeout 15 --max-time 120 --max-filesize "$archive_max" \
        --retry 0 --output "$archive" "$url" || fail 'bounded official download failed; staged files retained'
fi
size=$(wc -c < "$archive")
[ "$size" -gt 0 ] && [ "$size" -le "$archive_max" ] || fail 'archive size bound exceeded'
[ "$(sha "$archive")" = "$archive_sha" ] || fail 'archive checksum mismatch; not extracted'
[ "$size" -eq "$archive_size" ] || fail 'official archive size mismatch; not extracted'
printf '%s\n' "archive_sha256=$archive_sha bytes=$size verified=GitHub-official-release-asset-digest"
# Verified gzip stream only (not tar); no upstream member path is ever followed.
timeout 30 gzip -t "$archive" || fail 'invalid or timed-out gzip archive'
timeout 30 gzip -dc "$archive" | head -c "$((binary_max + 1))" > "$pending"
size=$(wc -c < "$pending")
[ "$size" -gt 0 ] && [ "$size" -le "$binary_max" ] || fail 'binary size bound exceeded'
[ "$size" -eq "$binary_size" ] || fail 'decompressed binary size mismatch'
[ "$(sha "$pending")" = "$binary_sha" ] || fail 'decompressed binary checksum mismatch'
chmod 0755 "$pending"
# Same filesystem, atomic no-clobber publication. Never overwrite a racing target.
ln -T "$pending" "$target" || fail 'target appeared during staging; not replaced'
printf '%s\n' "version=$version platform=linux-$arch" "binary_sha256=$binary_sha bytes=$size" "mode=0755 path=$target"
