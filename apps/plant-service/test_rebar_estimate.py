"""Testes do cálculo de aço (Peso+10%, C=, malha)."""
import unittest

from rebar_estimate import (
    estimate_slab_rebar_from_area,
    extract_rebar_from_length_callouts,
    extract_rebar_peso_plus10_table,
    mesh_weight_kg_per_m2,
    rebar_weight_per_meter,
)
from parser import Room, Slab, SlabRebarLayer


class RebarEstimateTests(unittest.TestCase):
    def test_weight_per_meter_matches_shared_formula(self):
        # Ø12 ≈ 0.888 kg/m
        self.assertAlmostEqual(rebar_weight_per_meter(12), 0.888, places=2)
        self.assertAlmostEqual(mesh_weight_kg_per_m2(8, 15), rebar_weight_per_meter(8) / 0.15, places=4)

    def test_peso_plus10_table(self):
        text = """
Comp. total
(m)
Peso+10%
(kg)
S-400
Ø6
725.6
177
Ø12
857.2
837
1014
Total
"""
        lines = extract_rebar_peso_plus10_table(text, 83)
        self.assertEqual(len(lines), 2)
        by_d = {int(line.diameter_mm): line.weight_kg for line in lines}
        self.assertEqual(by_d[6], 177)
        self.assertEqual(by_d[12], 837)

    def test_length_callouts(self):
        text = "Armadura longitudinal inferior\nØ10a/15 C=530\nØ8a/15 C=570\n12P1Ø8a/10 C=222\n"
        lines = extract_rebar_from_length_callouts(text, 93)
        total = sum(line.weight_kg for line in lines)
        self.assertGreater(total, 5)
        diameters = {int(line.diameter_mm) for line in lines}
        self.assertIn(8, diameters)
        self.assertIn(10, diameters)

    def test_slab_rebar_is_calculated_per_floor_and_layer(self):
        rooms = [
            Room("Sala", None, 100, 1, "1º Piso"),
            Room("Quarto", None, 80, 2, "2º Piso"),
        ]
        slabs = [
            Slab("1º Piso", "inferior", 15, 10, SlabRebarLayer(10, 20, 8, 20)),
            Slab("2º Piso", "inferior", 12, 11, SlabRebarLayer(6, 20, 6, 20)),
        ]

        lines = estimate_slab_rebar_from_area(rooms, slabs, {})

        self.assertEqual(len(lines), 4)
        self.assertTrue(any("1º Piso" in line.element and line.diameter_mm == 10 for line in lines))
        self.assertTrue(any("2º Piso" in line.element and line.diameter_mm == 6 for line in lines))
        first_floor_weight = sum(line.weight_kg for line in lines if "1º Piso" in line.element)
        second_floor_weight = sum(line.weight_kg for line in lines if "2º Piso" in line.element)
        self.assertGreater(first_floor_weight, second_floor_weight)


if __name__ == "__main__":
    unittest.main()
