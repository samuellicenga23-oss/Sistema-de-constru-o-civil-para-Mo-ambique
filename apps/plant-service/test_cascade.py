"""Testes da cascata de níveis."""
import unittest

from cascade import run_cascade


class CascadeTests(unittest.TestCase):
    def test_stops_at_first_passing_level(self):
        calls = []

        def l1():
            calls.append(1)
            return [], "vazio"

        def l2():
            calls.append(2)
            return ["a", "b"], "ok"

        def l3():
            calls.append(3)
            return ["x"], "nao deve correr"

        items, result = run_cascade(
            "teste",
            [(1, "um", l1), (2, "dois", l2), (3, "tres", l3)],
            min_count=1,
        )
        self.assertEqual(items, ["a", "b"])
        self.assertEqual(result.chosen_level, 2)
        self.assertEqual(calls, [1, 2])
        self.assertIn("L2", result.summary)

    def test_all_fail(self):
        items, result = run_cascade(
            "teste",
            [(1, "um", lambda: ([], "")), (2, "dois", lambda: ([], ""))],
            min_count=1,
        )
        self.assertEqual(items, [])
        self.assertIsNone(result.chosen_level)


if __name__ == "__main__":
    unittest.main()
