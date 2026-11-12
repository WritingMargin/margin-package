"""The installable package declares UI and HTTP mappings, never a Python runtime."""
import unittest
from manifest import MANIFEST
class BrowserPackageTests(unittest.TestCase):
    def test_notebook_contract_is_portable_and_owner_only(self):
        self.assertEqual(MANIFEST['version'],'0.5.0')
        self.assertEqual(MANIFEST['blocks'][0]['entry'],'ui/notebook.html')
        for action in MANIFEST['actions']:
            self.assertEqual(action['http'], {'method':'POST','path':'/actions/'+action['name'],'reader':False})
if __name__ == '__main__': unittest.main()
