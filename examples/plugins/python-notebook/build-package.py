#!/usr/bin/env python3
"""Build a platform-specific package from a relocatable standalone Python distribution."""
import argparse
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent


def copy_distribution(source, target):
    """Dereference only links contained within the explicitly selected distribution."""
    source = source.resolve()
    for path in source.rglob('*'):
        if path.is_symlink() and not path.resolve().is_relative_to(source):
            raise ValueError(f'Distribution link escapes its root: {path}')
    def ignore(directory, names):
        excluded = {name for name in names if name == '__pycache__' or name.endswith(('.pyc', '.pyo'))}
        if Path(directory) == source / 'share':
            # Linux standalone builds include terminal aliases differing only in
            # case. Notebook kernels do not use the interactive terminal database;
            # omit it so archives remain portable to case-insensitive filesystems.
            excluded.add('terminfo')
        if Path(directory) == source / 'bin':
            excluded.update(name for name in names if name != f'python{sys.version_info.major}.{sys.version_info.minor}')
        return excluded
    # Keep one interpreter executable; kernel argv uses it explicitly, so aliases
    # and development command scripts are unnecessary and cannot hide host paths.
    shutil.copytree(source, target, symlinks=False, ignore=ignore)


def build_interface(node, payload):
    """Bundle the package-owned notebook UI; Node is only a build dependency."""
    subprocess.run([str(node), str(HERE / 'build-ui.mjs'), str(payload / 'ui' / 'notebook.html')], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--python-root', required=True, type=Path, help='Relocatable standalone Python root, e.g. a uv-managed distribution.')
    parser.add_argument('--output', type=Path, default=Path('python-notebook.margin-plugin'))
    parser.add_argument('--node', default=shutil.which('node'), help='Developer Node binary for the SDK archive writer (not packaged).')
    args = parser.parse_args()
    if not args.node:
        parser.error('Node.js 24+ is needed on the build machine for the SDK archive writer.')
    source = args.python_root.resolve()
    if source != Path(sys.prefix).resolve():
        parser.error('Run build-package.py using the selected standalone interpreter; its sys.prefix must match --python-root.')
    executable = source / 'bin' / f'python{sys.version_info.major}.{sys.version_info.minor}'
    if not executable.is_file() or not (source / 'lib').is_dir():
        parser.error('Run this builder with the selected standalone distribution interpreter; --python-root must contain its bin and lib.')
    output = args.output.resolve()
    if output.exists():
        parser.error('Output already exists; choose a new --output path.')
    selected_os = {'Darwin': 'darwin', 'Linux': 'linux'}.get(platform.system())
    arch = {'arm64': 'arm64', 'aarch64': 'arm64', 'x86_64': 'amd64', 'AMD64': 'amd64'}.get(platform.machine())
    if not selected_os or not arch:
        parser.error('Build on Linux/macOS amd64/arm64 matching the engine host.')
    with tempfile.TemporaryDirectory(prefix='margin-python-build-') as temporary:
        root = Path(temporary)
        payload = root / 'payload'
        runtime = payload / 'runtime' / 'python'
        payload.mkdir()
        copy_distribution(source, runtime)
        # The temporary copy is our package payload, not uv's managed install.
        (runtime / 'lib' / f'python{sys.version_info.major}.{sys.version_info.minor}' / 'EXTERNALLY-MANAGED').unlink(missing_ok=True)
        python = runtime / 'bin' / executable.name
        env = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1', 'PIP_DISABLE_PIP_VERSION_CHECK': '1', 'PIP_NO_CACHE_DIR': '1'}
        # Install into the copied distribution, never the developer's original.
        subprocess.run([str(python), '-B', '-m', 'pip', 'install', '--quiet', '--no-compile', '-r', str(HERE / 'requirements.txt')], env=env, check=True)
        # Wheel console scripts embed this temporary build path. Runtime entry
        # points use -m with the bundled interpreter, so ship no such wrappers.
        for path in (runtime / 'bin').iterdir():
            if path.name != python.name:
                if path.is_dir():
                    shutil.rmtree(path)
                else:
                    path.unlink()
        site = runtime / 'lib' / f'python{sys.version_info.major}.{sys.version_info.minor}' / 'site-packages'
        # Packaging tools and upstream test fixtures are not execution features.
        # Excluding them also avoids shipping sample private keys from test data.
        for path in list(site.glob('pip')) + list(site.glob('pip-*.dist-info')) + [site / 'tornado' / 'test']:
            if path.is_dir():
                shutil.rmtree(path)
        build_interface(args.node, payload)
        app = payload / 'app'
        app.mkdir()
        for name in ('server.py', 'runtime.py', 'manifest.py'):
            shutil.copy2(HERE / name, app / name)
        manifest = root / 'manifest.json'
        with manifest.open('w') as stream:
            subprocess.run([str(python), '-B', str(app / 'server.py'), '--manifest'], stdout=stream, env=env, check=True)
        # Both interpreter and imports must work after relocation with no host PATH.
        probe_env = {'PATH': '', 'HOME': str(root), 'TMPDIR': str(root), 'PYTHONDONTWRITEBYTECODE': '1',
                     'MARGIN_PLUGIN_TOKEN': 'build-validation-only-credential-0123456789'}
        subprocess.run([str(python), '-B', str(app / 'server.py'), '--check'], env=probe_env, check=True)
        # Wheels sometimes install scripts or distribution test fixtures which are
        # not runtime dependencies and may match the package's secret-path filter.
        for path in runtime.rglob('__pycache__'):
            if path.is_dir():
                shutil.rmtree(path)
        subprocess.run([args.node, str(HERE.parents[2] / 'packages/plugin-sdk/pack.mjs'),
                        '--directory', str(payload), '--manifest', str(manifest),
                        '--executable', f'runtime/python/bin/{python.name}',
                        '--args', json.dumps(['-B', 'app/server.py']), '--os', selected_os, '--arch', arch,
                        '--output', str(output)], check=True)
    print(f'Python notebook package ready: {output}')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, subprocess.CalledProcessError) as error:
        print(f'Package build failed: {error}', file=sys.stderr)
        raise SystemExit(1) from None
