"""验证遗忘曲线定义、反函数和命令输入边界。"""

import json
from pathlib import Path
import subprocess
import sys
import unittest

from fsrs6 import interval_days, retrievability


SCRIPT = Path(__file__).with_name("fsrs6.py")


class Fsrs6Tests(unittest.TestCase):
    def test_stability_definition(self):
        self.assertEqual(retrievability(10, 0, 0.1542), 1.0)
        self.assertAlmostEqual(retrievability(10, 10, 0.1542), 0.9)
        self.assertEqual(interval_days(10, 0.9, 0.1542), 10.0)
        self.assertEqual(interval_days(10, 1, 0.1542), 0.0)

    def test_inverse_for_nondefault_decay(self):
        stability = 12.5
        elapsed = 7.25
        w20 = 0.3
        retention = retrievability(stability, elapsed, w20)
        self.assertAlmostEqual(interval_days(stability, retention, w20), elapsed)
        self.assertGreater(retention, retrievability(stability, elapsed * 2, w20))

    def test_documented_command(self):
        result = subprocess.run(
            [sys.executable, "-B", str(SCRIPT), "retrievability",
             "--stability-days", "10", "--elapsed-days", "10", "--w20", "0.1542"],
            check=True, capture_output=True, text=True,
        )
        self.assertEqual(json.loads(result.stdout), {"retrievability": 0.9})

    def test_invalid_input(self):
        for command in (
            ["retrievability", "--stability-days", "0",
             "--elapsed-days", "10", "--w20", "0.1542"],
            ["retrievability", "--stability-days", "10",
             "--elapsed-days", "-1", "--w20", "0.1542"],
            ["retrievability", "--stability-days", "10",
             "--elapsed-days", "10", "--w20", "nan"],
            ["interval", "--stability-days", "10",
             "--desired-retention", "1.1", "--w20", "0.1542"],
        ):
            with self.subTest(command=command):
                result = subprocess.run(
                    [sys.executable, "-B", str(SCRIPT), *command],
                    capture_output=True, text=True,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "")


if __name__ == "__main__":
    unittest.main()
