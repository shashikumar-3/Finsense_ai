import subprocess
import sys
import unittest
from pathlib import Path


class RagServiceScriptImportTests(unittest.TestCase):
    def test_script_mode_imports_news_processor_dependencies(self):
        root = Path(__file__).resolve().parents[2]
        venv_python = root / "Rag_model" / "venv" / "Scripts" / "python.exe"
        python = str(venv_python if venv_python.exists() else Path(sys.executable))
        service = root / "Rag_model" / "pipeline" / "rag_service.py"
        result = subprocess.run(
            [python, str(service), "--help"],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("strength", result.stdout)


if __name__ == "__main__":
    unittest.main()
