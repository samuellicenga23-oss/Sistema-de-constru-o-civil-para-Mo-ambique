"""Testes da cascata de níveis."""
import unittest

from cascade import run_cascade
from parser import Opening
from resolve_cascade import resolve_openings_cascade


class CascadeTests(unittest.TestCase):
    def test_openings_combine_schedule_and_geometry_before_accepting(self):
        schedule = Opening("janela", "J-01", 1.5, 1.2, None, 2, "Piso Térreo", "exterior", None, 1, 0.96, "quadro", False)
        spatial = Opening("porta", "P-01", 0.9, 2.1, 0, 1, "Piso Térreo", "interior", None, 2, 0.84, "geometria", True)
        items, result = resolve_openings_cascade(
            quadro_openings=[schedule],
            spatial_openings=[spatial],
            page_texts=[""],
            architecture_pages={1, 2},
            document_text="",
        )
        self.assertEqual({item.code for item in items}, {"J-01", "P-01"})
        self.assertEqual(result.chosen_level, 1)

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
