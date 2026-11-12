"""Packaging copy checks do not download dependencies or start kernels."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from manifest import MANIFEST

spec = importlib.util.spec_from_file_location('build_package', Path(__file__).with_name('build-package.py'))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class BuildPackageTests(unittest.TestCase):
    def test_package_declares_its_notebook_interface(self):
        self.assertEqual(MANIFEST['version'], '0.3.0')
        block, = MANIFEST['blocks']
        self.assertEqual(block['entry'], 'ui/notebook.html')
        self.assertEqual(block['languages'], ['ipynb'])
        self.assertTrue(block['reader'])
        self.assertEqual(block['actions'], [action['name'] for action in MANIFEST['actions']])
        notebook = json.loads(block['defaultSource'])
        self.assertEqual(notebook['nbformat'], 4)
        self.assertTrue(notebook['cells'])

    def test_builder_includes_browser_interface_using_explicit_paths(self):
        with patch.object(builder.subprocess, 'run') as run:
            builder.build_interface('/developer/node', Path('/temporary/payload'))
        run.assert_called_once_with(['/developer/node', str(builder.HERE / 'build-ui.mjs'),
                                    '/temporary/payload/ui/notebook.html'], check=True)

    def test_distribution_copy_keeps_interpreter_and_dereferences_internal_links(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'source'
            (source / 'bin').mkdir(parents=True)
            (source / 'lib').mkdir()
            interpreter = f'python{sys.version_info.major}.{sys.version_info.minor}'
            (source / 'bin' / interpreter).write_text('interpreter')
            (source / 'bin' / 'python').symlink_to(interpreter)
            (source / 'lib' / 'resource').write_text('data')
            (source / 'lib' / 'alias').symlink_to('resource')
            (source / 'lib' / '__pycache__').mkdir()
            target = root / 'target'
            builder.copy_distribution(source, target)
            self.assertEqual([path.name for path in (target / 'bin').iterdir()], [interpreter])
            self.assertFalse((target / 'lib' / 'alias').is_symlink())
            self.assertEqual((target / 'lib' / 'alias').read_text(), 'data')
            self.assertFalse((target / 'lib' / '__pycache__').exists())

    def test_distribution_link_cannot_escape_selected_root(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'source'
            source.mkdir()
            (root / 'secret').write_text('outside')
            (source / 'escape').symlink_to('../secret')
            with self.assertRaisesRegex(ValueError, 'escapes'):
                builder.copy_distribution(source, root / 'target')

    def test_copy_omits_unused_linux_terminal_database_but_keeps_licenses(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'source'
            (source / 'share' / 'terminfo' / '2').mkdir(parents=True)
            (source / 'share' / 'terminfo' / '2' / '2621a').write_text('terminal')
            (source / 'share' / 'LICENSE').write_text('distribution license')
            target = root / 'target'
            builder.copy_distribution(source, target)
            self.assertFalse((target / 'share' / 'terminfo').exists())
            self.assertEqual((target / 'share' / 'LICENSE').read_text(), 'distribution license')


if __name__ == '__main__':
    unittest.main()
