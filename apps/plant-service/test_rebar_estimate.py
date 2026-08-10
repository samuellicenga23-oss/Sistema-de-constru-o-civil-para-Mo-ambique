"""Testes do cálculo de aço (Peso+10%, C=, malha, Resumo por família)."""
import unittest

from rebar_estimate import (
    combine_resumo_with_total,
    estimate_footing_rebar,
    estimate_slab_rebar_from_area,
    extract_rebar_from_length_callouts,
    extract_rebar_peso_plus10_table,
    merge_rebar_lines,
    mesh_weight_kg_per_m2,
    rebar_weight_per_meter,
    steel_family_of,
)
from parser import (
    Room,
    Slab,
    SlabRebarLayer,
    _classify_steel_weights,
    extract_footings,
    extract_rebar_total_plus10,
    is_foundation_rebar_page,
)


class RebarEstimateTests(unittest.TestCase):
    def test_weight_per_meter_matches_shared_formula(self):
        self.assertAlmostEqual(rebar_weight_per_meter(12), 0.888, places=2)
        self.assertAlmostEqual(mesh_weight_kg_per_m2(8, 15), rebar_weight_per_meter(8) / 0.15, places=4)

    def test_peso_plus10_table_without_resumo_header(self):
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

    def test_foundation_resumo_deduped_and_classified(self):
        text = """
Resumo Aço
Fundação
Pormenor fundação
Comp. total
(m)
Peso+10%
(kg)
S-400
Ø6
57.1
14
Ø10
224.6
152
Ø12
648.2
633
Ø16
61.7
107
906
Total
"""
        self.assertTrue(is_foundation_rebar_page(text))
        page_a = extract_rebar_peso_plus10_table(text, 35)
        page_b = extract_rebar_peso_plus10_table(text, 36)
        merged = merge_rebar_lines([*page_a, *page_b])
        self.assertTrue(all(line.element == "Fundação" for line in merged))
        total = sum(line.weight_kg for line in merged)
        self.assertAlmostEqual(total, 14 + 152 + 633 + 107, places=1)
        footings, columns, *_rest = _classify_steel_weights(merged)
        self.assertAlmostEqual(footings, total, places=1)
        self.assertEqual(columns, 0)

    def test_pillar_resumo_not_confused_with_fundacao_floor_label(self):
        text = """
Conteúdo:
QUADRO DE PILARES
Primeiro Piso
Fundação
Quadro de pilares
Resumo Aço
Quadro de pilares
Comp. total
(m)
Peso+10%
(kg)
S-400
Ø6
1157.6
283
Ø10
305.0
207
Ø12
641.9
627
Ø16
424.8
738
1855
Total
"""
        lines = extract_rebar_peso_plus10_table(text, 44)
        self.assertTrue(lines)
        self.assertTrue(all(line.element == "Pilares" for line in lines))
        self.assertEqual(steel_family_of(lines[0].element), "columns")
        footings, columns, *_rest = _classify_steel_weights(lines)
        self.assertEqual(footings, 0)
        self.assertAlmostEqual(columns, 1855, places=0)

    def test_combine_prefers_resumo_families(self):
        fund_text = """
Resumo Aço
Fundação
Pormenor fundação
Comp. total
(m)
Peso+10%
(kg)
S-400
Ø12
100
100
100
Total
"""
        pillar_text = """
Resumo Aço
Quadro de pilares
Comp. total
(m)
Peso+10%
(kg)
S-400
Ø12
200
200
200
Total
"""
        peso = [
            *extract_rebar_peso_plus10_table(fund_text, 35),
            *extract_rebar_peso_plus10_table(pillar_text, 44),
        ]
        from parser import RebarLine

        total_plus = [
            RebarLine(element="Sapata P12", diameter_mm=12, weight_kg=50, page=35),
            RebarLine(element="Pórtico 1", diameter_mm=12, weight_kg=80, page=46),
        ]
        combined = combine_resumo_with_total(peso, total_plus)
        footings, columns, beams, *_rest = _classify_steel_weights(combined)
        self.assertAlmostEqual(footings, 100, places=0)
        self.assertAlmostEqual(columns, 200, places=0)
        self.assertAlmostEqual(beams, 80, places=0)

    def test_same_summary_row_keeps_decimal_total_plus10_precision(self):
        from parser import RebarLine

        combined = combine_resumo_with_total(
            [RebarLine("Armadura longitudinal inferior", 8, 97, 62)],
            [RebarLine("Armadura longitudinal inferior", 8, 97.5, 62)],
        )

        self.assertEqual(len(combined), 1)
        self.assertEqual(combined[0].weight_kg, 97.5)

    def test_foundation_total_plus10_tagged_as_sapata(self):
        text = """
Conteúdo:
PORMENOR DE FUNDAÇÃO
P8=P11
10
Ø10
9
134
1206
7.4
11
Ø10
9
134
1206
7.4
20.8
41.6
Total+10%:
(x2):
Ø6:
1.2
Ø10:
14.8
Ø12:
25.6
Total:
41.6
QUADRO DE ELEMENTOS DE FUNDAÇÃO
"""
        lines = extract_rebar_total_plus10(text, 35)
        self.assertTrue(lines)
        self.assertTrue(all(line.element.startswith("Sapata") for line in lines))
        footings, columns, *_rest = _classify_steel_weights(lines)
        self.assertGreater(footings, 0)
        self.assertEqual(columns, 0)

    def test_footing_quadro_captures_mesh_and_estimates(self):
        text = """
QUADRO DE ELEMENTOS DE FUNDAÇÃO
Referências
Dimensões (cm) Altura (cm) Armadura inf. X Armadura inf. Y Armadura sup. X Armadura sup. Y
P1, P2 e P3
65x65
30
4Ø10a/15
4Ø10a/15
P15
210x210
50
17Ø12a/11.5
17Ø12a/11.5
(P19-P21)
240x240
50
15Ø12a/15
15Ø12a/15
15Ø12a/15
15Ø12a/15
"""
        footings = extract_footings(text, 35)
        self.assertEqual(len(footings), 3)
        group = next(f for f in footings if "P1" in f.refs)
        self.assertEqual(len(group.refs), 3)
        self.assertIsNotNone(group.bottom_x)
        self.assertEqual(group.bottom_x.diameter_mm, 10)
        top_group = next(f for f in footings if "P19" in f.refs)
        self.assertIsNotNone(top_group.top_x)
        estimated = estimate_footing_rebar(footings, {35: text})
        self.assertGreater(sum(line.weight_kg for line in estimated), 20)

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
