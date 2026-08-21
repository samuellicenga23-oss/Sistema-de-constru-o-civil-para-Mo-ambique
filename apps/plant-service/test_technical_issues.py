"""Testes de normalização de unidades, detecção de quadros e cross-check estrutural."""
from __future__ import annotations

import unittest

from parser import BeamSpan, ColumnGroupSummary, RebarLine, Room, SlabSummary, StructuralSummary, build_technical_quality_issues, DocumentAnalysis, DocumentSection
from schedule_detect import classify_table_headers
from technical_issues import cross_check_structural
from unit_normalize import (
    parse_concrete_grade,
    parse_diameter_mm,
    parse_length_to_m,
    parse_section_cm,
    parse_spacing_cm,
)


class UnitNormalizeTests(unittest.TestCase):
    def test_length_mm_cm_m(self):
        self.assertAlmostEqual(parse_length_to_m("900 mm").normalized_m, 0.9)
        self.assertAlmostEqual(parse_length_to_m("150 cm").normalized_m, 1.5)
        self.assertAlmostEqual(parse_length_to_m("2.10 m").normalized_m, 2.10)
        self.assertAlmostEqual(parse_length_to_m("900").normalized_m, 0.9)
        self.assertAlmostEqual(parse_length_to_m("150").normalized_m, 1.5)
        self.assertTrue(parse_length_to_m("18").ambiguous)

    def test_diameter_and_section(self):
        self.assertAlmostEqual(parse_diameter_mm("Ø12").value, 12)
        self.assertAlmostEqual(parse_diameter_mm("Φ10").value, 10)
        section = parse_section_cm("20×30")
        assert section is not None
        self.assertEqual((section.width_cm, section.depth_cm), (20.0, 30.0))

    def test_spacing_and_concrete(self):
        spacing = parse_spacing_cm("c/15")
        assert spacing is not None
        self.assertEqual(spacing.spacing_cm, 15)
        self.assertAlmostEqual(parse_spacing_cm("@20").spacing_cm, 20)
        grade = parse_concrete_grade("C20/25")
        assert grade is not None
        self.assertEqual(grade.label, "C20/25")
        self.assertTrue(grade.ambiguous_equivalence)


class ScheduleDetectTests(unittest.TestCase):
    def test_classifies_pilares_and_aco(self):
        pilares = classify_table_headers(["Quadro de Pilares", "Secção", "Quantidade"])
        self.assertEqual(pilares.kind, "pilares")
        self.assertGreaterEqual(pilares.confidence, 0.5)

        aco = classify_table_headers(["Mapa de Aço", "Elemento", "Peso kg"])
        self.assertEqual(aco.kind, "aco")


class TechnicalIssuesTests(unittest.TestCase):
    def test_steel_map_total_mismatch(self):
        summary = StructuralSummary(
            footings_count=1,
            footings_avg_width_cm=100,
            footings_avg_length_cm=100,
            footings_avg_depth_cm=40,
            columns_count=4,
            beams_count=2,
            beams_total_length_m=10,
            beams_avg_width_cm=20,
            beams_avg_height_cm=40,
            beams_concrete_volume_m3=0.8,
            staircases_count=0,
            slabs_count=1,
            slabs_avg_thickness_cm=15,
            slabs=[],
            total_steel_weight_kg=1000,
            footings_steel_weight_kg=200,
            columns_steel_weight_kg=300,
            beams_steel_weight_kg=400,
            slabs_steel_weight_kg=100,
            column_groups=[
                ColumnGroupSummary(
                    code="P1",
                    quantity=4,
                    shape="rectangular",
                    width_cm=30,
                    depth_cm=30,
                    diameter_cm=None,
                    from_floor="Piso Térreo",
                    to_floor="Piso Térreo",
                    explicit_height_m=3.0,
                    longitudinal_bar_count=8,
                    longitudinal_diameter_mm=12,
                    stirrup_diameter_mm=8,
                    stirrup_spacing_cm=15,
                    concrete_volume_m3=1.0,
                    steel_weight_kg=300,
                    steel_source="map",
                    source_page=5,
                    confidence=0.8,
                    needs_confirmation=False,
                )
            ],
        )
        rebar = [
            RebarLine("Pilares P1", 12, 450, 5),
            RebarLine("Vigas", 10, 450, 6),
        ]
        issues = cross_check_structural(summary, rebar, [], [])
        codes = {issue.code for issue in issues}
        self.assertIn("structure.steel_map_total_mismatch", codes)

    def test_cross_issues_merge_into_quality_report(self):
        analysis = DocumentAnalysis(
            page_count=1,
            is_multi_discipline=False,
            sections=[DocumentSection("estrutura", "Estrutura", 1, 1, 1, 0.9)],
        )
        summary = StructuralSummary(
            footings_count=0,
            footings_avg_width_cm=0,
            footings_avg_length_cm=0,
            footings_avg_depth_cm=0,
            columns_count=2,
            beams_count=0,
            beams_total_length_m=0,
            beams_avg_width_cm=0,
            beams_avg_height_cm=0,
            beams_concrete_volume_m3=0,
            staircases_count=0,
            slabs_count=0,
            slabs_avg_thickness_cm=0,
            slabs=[],
            total_steel_weight_kg=500,
            column_groups=[
                ColumnGroupSummary(
                    code="P1=P2",
                    quantity=2,
                    shape="rectangular",
                    width_cm=30,
                    depth_cm=30,
                    diameter_cm=None,
                    from_floor=None,
                    to_floor=None,
                    explicit_height_m=None,
                    longitudinal_bar_count=None,
                    longitudinal_diameter_mm=None,
                    stirrup_diameter_mm=None,
                    stirrup_spacing_cm=None,
                    concrete_volume_m3=0,
                    steel_weight_kg=0,
                    steel_source="calculated",
                    source_page=1,
                    confidence=0.5,
                    needs_confirmation=True,
                )
            ],
        )
        rebar = [RebarLine("Sapatas", 10, 500, 1)]
        base = build_technical_quality_issues(analysis, [], [], summary)
        merged = base + cross_check_structural(summary, rebar, [], [])
        self.assertTrue(any(issue.code.startswith("structure.") for issue in merged))


if __name__ == "__main__":
    unittest.main()
