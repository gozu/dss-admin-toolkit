#!/usr/bin/env python3
"""
Auto-increment plugin version in plugin.json and sync to frontend package.json

Version scheme: 0.0.1 -> 0.0.9 -> 0.1.0 -> 0.9.9 -> 1.0.0
- Patch (z) increments from 1-9
- When patch hits 9, minor (y) increments and patch resets to 0
- When minor hits 9 and patch is 9, major (x) increments and minor/patch reset to 0
"""

import json
import sys
from pathlib import Path


def bump_version(version: str) -> str:
    """Increment version according to the scheme: 0.0.1 -> 0.0.9 -> 0.1.0 -> 0.9.9 -> 1.0.0"""
    parts = version.split(".")
    if len(parts) != 3:
        raise ValueError(f"Invalid version format: {version}. Expected x.y.z")

    major, minor, patch = int(parts[0]), int(parts[1]), int(parts[2])

    if patch < 9:
        # Increment patch
        patch += 1
    elif minor < 9:
        # Patch is 9, increment minor and reset patch
        minor += 1
        patch = 0
    else:
        # Both minor and patch are 9, increment major and reset
        major += 1
        minor = 0
        patch = 0

    return f"{major}.{minor}.{patch}"


def main():
    plugin_file = Path("plugin.json")
    frontend_package = Path("resource/frontend/package.json")

    # Read current plugin.json
    with open(plugin_file, "r") as f:
        plugin = json.load(f)

    old_version = plugin.get("version", "0.0.0")
    new_version = bump_version(old_version)

    # Update plugin.json
    plugin["version"] = new_version
    with open(plugin_file, "w") as f:
        json.dump(plugin, f, indent=4)
        f.write("\n")

    print(f"plugin.json: {old_version} -> {new_version}")

    # Update frontend package.json if it exists
    if frontend_package.exists():
        with open(frontend_package, "r") as f:
            package = json.load(f)

        old_pkg_version = package.get("version", "0.0.0")
        package["version"] = new_version

        with open(frontend_package, "w") as f:
            json.dump(package, f, indent=2)
            f.write("\n")

        print(f"package.json: {old_pkg_version} -> {new_version}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
