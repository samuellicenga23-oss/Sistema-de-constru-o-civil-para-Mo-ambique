import unittest

import fitz

from parser import (
    Room,
    PageClassification,
    build_document_analysis,
    classify_document_pages,
    dedupe_rooms,
    extract_room_list_fallback,
    extract_rooms,
    extract_rooms_spatial,
    extract_opening_schedule,
    extract_slabs,
    detect_plan_type,
    is_room_area_page,
    parse_pdf,
    Slab,
    RebarLine,
    build_structural_summary,
    summarise_slabs,
    BeamSpan,
    extract_openings_spatial,
    extract_structural_material_specs,
    build_technical_quality_issues,
    extract_hydrosanitary_summary,
    extract_hydro_vector_measurements,
    extract_hydro_coded_equipment,
    extract_hydro_vector_accessories,
    DocumentAnalysis,
    DocumentSection,
    Opening,
    merge_openings,
)


class RoomExtractionTests(unittest.TestCase):
    def test_extracts_supply_point_codes_without_counting_repeated_labels(self):
        doc = fitz.open()
        page = doc.new_page()
        text = "Conteudo: ABASTECIMENTO DE AGUA\nB01 B02 B02 B06 P01\nEscala: 1:100"
        page.insert_text((30, 30), text)

        equipment = extract_hydro_coded_equipment(page, page.get_text(), 1)
        doc.close()

        points = [item for item in equipment if item.kind == "ponto_abastecimento"]
        self.assertEqual([item.code for item in points], ["B01", "B02", "B06"])
        self.assertTrue(all(item.quantity == 1 and not item.requires_confirmation for item in points))

    def test_estimates_vector_fittings_but_marks_them_for_confirmation(self):
        doc = fitz.open()
        page = doc.new_page(width=500, height=500)
        page.insert_text((30, 30), "Conteudo: ABASTECIMENTO DE AGUA\nEscala: 1:100")
        page.draw_line(fitz.Point(50, 100), fitz.Point(150, 100), color=(0, 0, 1), width=0.567)
        page.draw_line(fitz.Point(150, 100), fitz.Point(150, 180), color=(0, 0, 1), width=0.567)

        accessories = extract_hydro_vector_accessories(page, page.get_text(), 1)
        doc.close()

        elbow = next(item for item in accessories if item.kind.startswith("curva"))
        self.assertEqual(elbow.quantity, 1)
        self.assertEqual(elbow.source, "vector_topology")
        self.assertTrue(elbow.requires_confirmation)

    def test_measures_scaled_coloured_hydro_vector(self):
        doc = fitz.open()
        page = doc.new_page(width=500, height=500)
        page.insert_text((30, 30), "Conteudo: ABASTECIMENTO DE AGUA\nEscala: 1:100")
        page.draw_line(fitz.Point(50, 100), fitz.Point(150, 100), color=(1, 0, 0), width=0.567)

        measured = extract_hydro_vector_measurements(page, page.get_text(), 1)
        doc.close()

        self.assertEqual(len(measured), 1)
        self.assertEqual(measured[0].system, "agua_quente")
        self.assertAlmostEqual(measured[0].measured_length_m or 0, 3.53, places=2)
        self.assertEqual(measured[0].measurement_basis, "vector_stroke")

    def test_extracts_hydrosanitary_plan_evidence_without_inventing_lengths(self):
        analysis = DocumentAnalysis(
            page_count=1,
            is_multi_discipline=False,
            sections=[DocumentSection("hidrossanitario", "Hidrossanitário", 1, 1, 1, 0.9)],
        )
        summary = extract_hydrosanitary_summary(analysis, [
            'Conteúdo: ABASTECIMENTO DE ÁGUA\nREDE DE ÁGUA FRIA\nØ¾"HDPE\nØ¾"HDPE\nØ½"HDPE\nDepósito de\n1500L'
        ])

        self.assertIsNotNone(summary)
        assert summary is not None
        self.assertIn("agua_fria", summary.systems)
        three_quarter = next(pipe for pipe in summary.pipes if pipe.diameter_inch == "¾")
        self.assertEqual(three_quarter.occurrences, 2)
        self.assertIsNone(three_quarter.measured_length_m)
        tank = next(item for item in summary.equipment if item.kind == "deposito")
        self.assertEqual(tank.capacity_l, 1500)

    def test_does_not_treat_rebar_spacing_as_hydrosanitary_pipe(self):
        analysis = DocumentAnalysis(
            page_count=1,
            is_multi_discipline=False,
            sections=[DocumentSection("hidrossanitario", "Hidrossanitário", 1, 1, 1, 0.9)],
        )
        summary = extract_hydrosanitary_summary(analysis, [
            "PORMENOR DA FOSSA SÉPTICA\nArmadura Ø8@15 cm\nTubagem PVC Ø110 mm"
        ])

        assert summary is not None
        self.assertFalse(any(pipe.diameter_mm == 8 for pipe in summary.pipes))
        self.assertTrue(any(pipe.diameter_mm == 110 for pipe in summary.pipes))

    def test_keeps_equal_openings_in_different_rooms(self):
        base = dict(
            kind="porta", code=None, width_m=0.8, height_m=None, sill_height_m=0,
            quantity=1, floor="Piso Térreo", material=None, page=1, confidence=0.7,
            source="geometria", needs_confirmation=True,
        )
        openings = merge_openings([
            Opening(**base, location="desconhecida", designation="Próximo de Sala"),
            Opening(**base, location="desconhecida", designation="Próximo de Cozinha"),
        ], "")

        self.assertEqual(len(openings), 2)

    def test_extracts_explicit_room_perimeter_near_area_tag(self):
        document = fitz.open()
        page = document.new_page(width=500, height=500)
        page.insert_text((100, 100), "SALA")
        page.insert_text((100, 125), "A:20.00 m2")
        page.insert_text((100, 145), "Perímetro: 18.50 m")

        rooms = extract_rooms_spatial(page, 1, page.get_text())

        self.assertEqual(len(rooms), 1)
        self.assertEqual(rooms[0].name, "SALA")
        self.assertAlmostEqual(rooms[0].perimeter_m or 0, 18.5, places=2)
        document.close()

    def test_extracts_uncoded_window_frame_at_declared_scale(self):
        document = fitz.open()
        page = document.new_page(width=1191, height=842)
        page.insert_text((50, 70), "PLANTA COTADA PISO TÉRREO - Escala 1:100")
        page.insert_text((100, 145), "SALA DE ESTAR")
        page.insert_text((100, 170), "A:20.00 m2")
        for offset in (0.0, 0.5, 1.0, 1.5, 2.0, 2.5):
            page.draw_line(fitz.Point(100, 110 + offset), fitz.Point(140, 110 + offset))

        openings = extract_openings_spatial(page, 1, page.get_text())
        windows = [opening for opening in openings if opening.kind == "janela"]

        self.assertEqual(len(windows), 1)
        self.assertAlmostEqual(windows[0].width_m, 1.41, places=2)
        self.assertIsNone(windows[0].height_m)
        self.assertEqual(windows[0].location, "desconhecida")
        self.assertEqual(windows[0].designation, "Próximo de SALA DE ESTAR")
        self.assertTrue(windows[0].needs_confirmation)
        document.close()

    def test_quality_report_separates_missing_windows_and_perimeters(self):
        analysis = DocumentAnalysis(
            page_count=2,
            is_multi_discipline=False,
            sections=[DocumentSection("arquitectura", "Arquitectura", 1, 2, 2, 0.95)],
        )
        rooms = [Room("Sala", None, 20.0, 1, "Piso Térreo")]
        doors = [Opening("porta", None, 0.9, None, None, 1, "Piso Térreo", "desconhecida", None, 1, 0.7, "geometry", True)]

        issues = build_technical_quality_issues(analysis, rooms, doors, None)
        codes = {issue.code for issue in issues}

        self.assertIn("architecture.room_perimeters_missing", codes)
        self.assertIn("architecture.windows_missing", codes)
        self.assertIn("architecture.openings_incomplete", codes)
        self.assertNotIn("architecture.doors_missing", codes)

    def test_extracts_door_arc_without_inventing_height(self):
        document = fitz.open()
        page = document.new_page(width=1191, height=842)
        page.draw_bezier(
            fitz.Point(100, 100),
            fitz.Point(100, 76),
            fitz.Point(124, 76),
            fitz.Point(124, 100),
        )

        openings = extract_openings_spatial(
            page,
            1,
            "PLANTA COTADA PISO TÃ‰RREO\nEscala 1:100",
        )

        self.assertEqual(len(openings), 1)
        self.assertEqual(openings[0].kind, "porta")
        self.assertAlmostEqual(openings[0].width_m, 0.85, places=2)
        self.assertIsNone(openings[0].height_m)
        self.assertTrue(openings[0].needs_confirmation)
        document.close()

    def test_extracts_door_and_window_schedule_with_dimensions_and_quantity(self):
        text = """PLANTA COTADA PISO T\u00c9RREO
J01 Janela de alum\u00ednio 1,50 x 1,20 m 4
P02 Porta interior de madeira 0,90 x 2,10 m 6
"""
        openings = extract_opening_schedule(text, 7)
        self.assertEqual(len(openings), 2)
        # O código é normalizado com traço (J01 -> J-01) para casar de forma consistente,
        # seja qual for o formato usado na planta de origem (J01, J-01 ou J.01).
        self.assertEqual((openings[0].kind, openings[0].code, openings[0].quantity), ("janela", "J-01", 4))
        self.assertEqual((openings[0].width_m, openings[0].height_m, openings[0].material), (1.5, 1.2, "Alum\u00ednio"))
        self.assertEqual((openings[1].kind, openings[1].location, openings[1].quantity), ("porta", "interior", 6))

    def test_extracts_opening_dimensions_written_in_centimetres_and_millimetres(self):
        text = """MAPA DE VÃOS PISO TÃ‰RREO
P01 Porta principal 900 x 2100 mm 1
J02 Janela da sala 150 x 120 cm 2
"""
        openings = extract_opening_schedule(text, 3)
        self.assertEqual(len(openings), 2)
        self.assertEqual((openings[0].width_m, openings[0].height_m), (0.9, 2.1))
        self.assertEqual((openings[1].width_m, openings[1].height_m), (1.5, 1.2))
        self.assertEqual(openings[0].designation, "Porta principal")

    def test_groups_slab_layers_but_keeps_different_floor_thicknesses(self):
        slabs = summarise_slabs([
            Slab("1º Piso", "inferior", 15, 12),
            Slab("1º Piso", "superior", 15, 13),
            Slab("Cobertura", "inferior", 12, 14),
            Slab("Cobertura", "superior", 12, 15),
        ])

        self.assertEqual(len(slabs), 2)
        self.assertEqual([(slab.floor, slab.thickness_cm) for slab in slabs], [("1º Piso", 15), ("Cobertura", 12)])
        self.assertEqual(slabs[0].layers, ["inferior", "superior"])

    def test_reads_each_slab_layer_mesh_and_keeps_it_on_the_physical_slab(self):
        lower = extract_slabs(
            "PLANTA DE ARMADURA INFERIOR - 1º PISO\nh=15\nBetão B25\nS-400\nRecobrimento 25 mm\nDirecção X Ø10a/15\nDirecção Y Ø8a/20",
            12,
        )
        upper = extract_slabs(
            "PLANTA DE ARMADURA SUPERIOR - 1º PISO\nh=15\nØ8a/20",
            13,
        )
        slabs = summarise_slabs([*lower, *upper])

        self.assertEqual(len(slabs), 1)
        self.assertEqual(slabs[0].layers, ["inferior", "superior"])
        self.assertEqual(slabs[0].bottom_rebar.x_diameter_mm, 10)
        self.assertEqual(slabs[0].bottom_rebar.y_spacing_cm, 20)
        self.assertEqual(slabs[0].top_rebar.x_spacing_cm, 20)
        self.assertEqual((slabs[0].concrete_class, slabs[0].steel_grade, slabs[0].cover_cm), ("B25", "S-400", 2.5))

    def test_does_not_confuse_beam_codes_with_concrete_class(self):
        concrete, steel, cover = extract_structural_material_specs(
            "B15 B20 B33\nBetÃ£o: C20/25\nAÃ§o em varÃµes: S-400\nRecobrimentos adoptados:\nLajes: 2 cm"
        )

        self.assertEqual((concrete, steel, cover), ("C20/25", "S-400", 2.0))

    def test_does_not_reduce_multiple_slab_diameters_to_one_uniform_mesh(self):
        slabs = extract_slabs(
            "PLANTA DE ARMADURA SUPERIOR - 2Âº PISO\nP1Ã˜12a/15\nP2Ã˜10a/15\nP3Ã˜8a/15",
            66,
        )

        self.assertEqual(len(slabs), 1)
        self.assertIsNone(slabs[0].rebar)

    def test_groups_beams_by_declared_floor_and_assigns_floor_steel(self):
        slabs = [
            Slab("1Âº Piso", "geral", 15, 41),
            Slab("2Âº Piso", "geral", 25, 42),
            Slab("Cobertura", "geral", 20, 43),
        ]
        spans = [
            BeamSpan("PÃ³rtico 1", 20, 30, 5, 46, "1Âº Piso"),
            BeamSpan("PÃ³rtico 1", 40, 25, 6, 49, "2Âº Piso"),
            BeamSpan("PÃ³rtico 1", 30, 20, 4, 56, "Cobertura"),
        ]
        summary = build_structural_summary(
            [], [], spans,
            [
                RebarLine("Vigas", 10, 100, 48),
                RebarLine("Vigas", 10, 200, 55),
                RebarLine("Vigas", 10, 300, 61),
            ],
            [], slabs,
        )

        self.assertEqual([group.beams_count for group in summary.beam_groups], [1, 1, 1])
        self.assertEqual([group.total_length_m for group in summary.beam_groups], [5, 6, 4])
        self.assertEqual([group.steel_weight_kg for group in summary.beam_groups], [100, 200, 300])

    def test_links_separate_rebar_pages_to_the_slab_geometry_by_floor(self):
        slabs = [
            Slab("1º Piso", "geral", 15, 41),
            Slab("1º Piso", "inferior", 0, 62),
            Slab("1º Piso", "superior", 0, 65),
        ]
        summary = build_structural_summary(
            [], [], [],
            [RebarLine("Armadura inferior", 8, 97.5, 62), RebarLine("Armadura superior", 10, 59.5, 65)],
            [], slabs,
        )

        self.assertEqual(summary.slabs_count, 1)
        slab = summary.slabs[0]
        self.assertEqual((slab.thickness_cm, slab.pages), (15, [41, 62, 65]))
        self.assertEqual(slab.bottom_steel_weight_kg, 97.5)
        self.assertEqual(slab.top_steel_weight_kg, 59.5)
        self.assertEqual(slab.steel_by_diameter, {"8": 97.5, "10": 59.5})

    def test_accepts_mixed_case_and_common_area_labels(self):
        text = """Planta Cotada Piso Térreo
Suite 2
CA: 22,400 m2
Cozinha Área: 16.00 m²
Quarto 1
S = 12,35 m2
"""
        rooms = extract_rooms(text, 1)

        self.assertEqual(
            [(room.name, room.number, room.area_m2) for room in rooms],
            [("Suite", "2", 22.4), ("Cozinha", None, 16.0), ("Quarto", "1", 12.35)],
        )

    def test_normalises_common_room_name_typos_from_drawings(self):
        rooms = extract_rooms("Garragem\nA: 47,52 m2\nQ.BANHIO\nA: 3,90 m2", 1)

        self.assertEqual([(room.name, room.area_m2) for room in rooms], [("Garagem", 47.52), ("Q. Banho", 3.9)])

    def test_uses_geometry_when_pdf_text_order_is_not_semantic(self):
        doc = fitz.open()
        page = doc.new_page(width=600, height=400)
        # Inserida primeiro de propósito: na ordem interna do PDF a área vem antes do nome.
        page.insert_text((100, 130), "12,50 m2", fontsize=10)
        page.insert_text((100, 110), "Cozinha", fontsize=10)

        rooms = extract_rooms_spatial(page, 1)

        self.assertEqual(len(rooms), 1)
        self.assertEqual(rooms[0].name, "Cozinha")
        self.assertEqual(rooms[0].area_m2, 12.5)
        doc.close()

    def test_excludes_satellite_and_misspelled_site_plan_sheets(self):
        satellite = "Planta de Piso\nConteúdo: IMAGEM SATÉLITE"
        site_plan = "Planta de Piso\nConteúdo: PLANTA DE IMPLATAÇÃO"

        self.assertEqual(detect_plan_type(satellite), "imagem_satelite")
        self.assertEqual(detect_plan_type(site_plan), "implantacao")
        self.assertFalse(is_room_area_page(satellite))
        self.assertFalse(is_room_area_page(site_plan))

    def test_ignores_room_tags_hidden_by_published_pdf_mask(self):
        doc = fitz.open()
        page = doc.new_page(width=600, height=400)
        page.insert_text((100, 110), "Cozinha", fontsize=10)
        page.insert_text((100, 130), "12,50 m2", fontsize=10)
        page.insert_text((360, 110), "Quarto", fontsize=10)
        page.insert_text((360, 130), "18,00 m2", fontsize=10)
        page.draw_rect(fitz.Rect(345, 90, 440, 145), color=(1, 1, 1), fill=(1, 1, 1), overlay=True)

        rooms = extract_rooms_spatial(page, 1)

        self.assertEqual([(room.name, room.area_m2) for room in rooms], [("Cozinha", 12.5)])
        doc.close()

    def test_prefers_dimensioned_view_when_two_views_share_one_sheet(self):
        doc = fitz.open()
        page = doc.new_page(width=700, height=400)
        for x in (120, 470):
            page.insert_text((x, 100), "Cozinha", fontsize=10)
            page.insert_text((x, 120), "12,50 m2", fontsize=10)
            page.insert_text((x, 160), "W.C", fontsize=10)
            page.insert_text((x, 180), "4,00 m2", fontsize=10)
        page.insert_text((110, 350), "PLANTA DE PISO", fontsize=12)
        page.insert_text((455, 350), "PLANTA COTADA", fontsize=12)

        rooms = extract_rooms_spatial(page, 1)

        self.assertEqual([(room.name, room.area_m2) for room in rooms], [("Cozinha", 12.5), ("W.C", 4.0)])
        doc.close()

    def test_duplicate_sheets_do_not_remove_legitimate_equal_rooms(self):
        page_one = [
            Room("Sala", None, 24.0, 1, "Piso Térreo"),
            Room("Cozinha", None, 12.0, 1, "Piso Térreo"),
            Room("W.C", None, 4.0, 1, "Piso Térreo"),
            Room("W.C", None, 4.0, 1, "Piso Térreo"),
        ]
        page_two = [
            Room("Sala", None, 24.0, 2, "Piso Térreo"),
            Room("Cozinha", None, 12.0, 2, "Piso Térreo"),
            Room("W.C", None, 4.0, 2, "Piso Térreo"),
            Room("W.C", None, 4.0, 2, "Piso Térreo"),
        ]

        rooms = dedupe_rooms(page_one + page_two, {1: 3, 2: 4})

        self.assertEqual(len(rooms), 4)
        self.assertEqual(sum(room.name == "W.C" for room in rooms), 2)
        self.assertTrue(all(room.page == 2 for room in rooms))

    def test_room_number_is_scoped_by_room_type(self):
        rooms = dedupe_rooms(
            [
                Room("Quarto", "1", 20.0, 1, "Piso Térreo"),
                Room("Suite", "1", 22.0, 1, "Piso Térreo"),
            ]
        )
        self.assertEqual({(room.name, room.number) for room in rooms}, {("Quarto", "1"), ("Suite", "1")})

    def test_uses_explicit_room_list_only_as_supported_fallback(self):
        rooms = extract_room_list_fallback(
            "• Sala de estar 42,20 m²;\n• Cozinha 16.00 m²;\nTexto geral 208,22 m².",
            5,
        )
        self.assertEqual([(room.name, room.area_m2) for room in rooms], [("Sala de estar", 42.2), ("Cozinha", 16.0)])

    def test_single_storey_document_assigns_ground_floor_and_skips_furniture_plan(self):
        doc = fitz.open()
        description = doc.new_page()
        description.insert_text((50, 70), "Moradia de piso único")
        floor_plan = doc.new_page()
        floor_plan.insert_text((50, 50), "Nome do Desenho: Planta de Piso")
        floor_plan.insert_text((100, 100), "Sala de Estar")
        floor_plan.insert_text((100, 120), "CA: 24,00 m2")
        furniture = doc.new_page()
        furniture.insert_text((50, 50), "Nome do Desenho: Planta Mobilia")
        furniture.insert_text((100, 100), "Sala de Estar")
        furniture.insert_text((100, 120), "CA: 24,00 m2")
        payload = doc.tobytes()
        doc.close()

        result = parse_pdf(payload)

        self.assertEqual(len(result.rooms), 1)
        self.assertEqual(result.rooms[0].name, "Sala de Estar")
        self.assertEqual(result.rooms[0].floor, "Piso Térreo")

    def test_separates_complete_project_even_with_wrong_hydro_stamp(self):
        texts = [
            "Projecto Arquitetónico\nPlanta Cotada Piso Térreo",
            "Especialidade: ARQUITECTURA\nPlanta Cotada Piso Superior",
            "Projecto Hidrossanitário\nEspecialidade: ARQUITECTURA\nHID.1\nABASTECIMENTO DE ÁGUA",
            "Especialidade: ARQUITECTURA\nPlanta de Piso\nHID.2\nESPECIFICAÇÕES TÉCNICAS",
            "Projecto Estrutural\nEspecialidade: ESTRUTURA\nPLANTA DE FUNDAÇÃO",
        ]

        analysis = build_document_analysis(classify_document_pages(texts))

        self.assertTrue(analysis.is_multi_discipline)
        self.assertEqual(
            [(section.discipline, section.start_page, section.end_page) for section in analysis.sections],
            [("arquitectura", 1, 2), ("hidrossanitario", 3, 4), ("estrutura", 5, 5)],
        )

    def test_blocks_combination_when_discipline_identity_conflicts(self):
        texts = [
            "Projecto Arquitectónico\nProprietário: Fernando Gore Chaera\nDistrito: Chimoio\nPlanta cotada",
            "Projecto Estrutural\nProprietário: Edson Nhapulo\nDistrito: Marracuene\nPlanta de fundação",
        ]
        classifications = [
            PageClassification(page=1, discipline="arquitectura", confidence=0.95, evidence=["planta cotada"]),
            PageClassification(page=2, discipline="estrutura", confidence=0.95, evidence=["planta de fundação"]),
        ]

        analysis = build_document_analysis(classifications, texts)

        self.assertTrue(analysis.requires_identity_confirmation)
        self.assertEqual({conflict.field for conflict in analysis.identity_conflicts}, {"owner", "location"})
        self.assertEqual(analysis.sections[0].identity.owner, "Fernando Gore Chaera")
        self.assertEqual(analysis.sections[1].identity.location, "Marracuene")

    def test_combines_disciplines_when_identity_is_consistent(self):
        texts = [
            "Projecto Arquitectónico\nCliente: Empresa ABC, Lda\nLocal: Matola\nPlanta cotada",
            "Projecto Estrutural\nCliente: Empresa ABC Lda\nLocal: Matola\nPlanta de fundação",
        ]
        classifications = [
            PageClassification(page=1, discipline="arquitectura", confidence=0.95),
            PageClassification(page=2, discipline="estrutura", confidence=0.95),
        ]

        analysis = build_document_analysis(classifications, texts)

        self.assertFalse(analysis.requires_identity_confirmation)
        self.assertEqual(analysis.identity_conflicts, [])

    def test_blocks_internal_location_conflict_hidden_in_technical_memory(self):
        texts = [
            "Projecto Estrutural\nProprietario: Fernando Gore Chaera\nLocalizacao: Cidade de Chimoio",
            "A estrutura a analisar esta localizada na provincia de Maputo, tem dois pisos.",
        ]
        classifications = [
            PageClassification(page=1, discipline="estrutura", confidence=0.95),
            PageClassification(page=2, discipline="estrutura", confidence=0.9),
        ]

        analysis = build_document_analysis(classifications, texts)

        self.assertTrue(analysis.requires_identity_confirmation)
        self.assertEqual([conflict.field for conflict in analysis.identity_conflicts], ["location"])

    def test_uses_extracted_content_when_sheet_has_no_standard_title(self):
        classifications = classify_document_pages(
            ["Gabinete XPTO\nFolha 01", "Desenho sem carimbo normalizado", "Notas gerais"],
            {2: [("arquitectura", 7, "compartimentos e áreas reconhecidos")]},
        )

        self.assertEqual([page.discipline for page in classifications], ["arquitectura"] * 3)
        self.assertIn("compartimentos e áreas reconhecidos", classifications[1].evidence)

    def test_duplicate_general_plan_inherits_floor_from_dimensioned_plan(self):
        rooms = dedupe_rooms(
            [
                Room("Sala", None, 24.0, 1, None),
                Room("Cozinha", None, 12.0, 1, None),
                Room("W.C", None, 4.0, 1, None),
                Room("Sala", None, 24.0, 2, "Piso Térreo"),
                Room("Cozinha", None, 12.0, 2, "Piso Térreo"),
                Room("W.C", None, 4.0, 2, "Piso Térreo"),
            ],
            {1: 3, 2: 4},
        )

        self.assertEqual(len(rooms), 3)
        self.assertTrue(all(room.floor == "Piso Térreo" for room in rooms))

    def test_reports_configured_terms_found_in_complete_project(self):
        doc = fitz.open()
        page = doc.new_page()
        page.insert_text((50, 70), "Projecto de seguranca: rede CCTV e central de incendio")
        payload = doc.tobytes()
        doc.close()

        result = parse_pdf(payload, detection_tags=["cctv", "elevador", "incendio"])

        # matched_tags também acumula evidência de diagnóstico da cascata (visível no health de
        # parse) — só confirmamos aqui que as tags configuradas realmente encontradas estão lá,
        # não a lista exacta (essa evidência varia consoante o que a cascata encontrar/não encontrar).
        self.assertIn("cctv", result.document_analysis.matched_tags)
        self.assertIn("incendio", result.document_analysis.matched_tags)
        self.assertNotIn("elevador", result.document_analysis.matched_tags)


if __name__ == "__main__":
    unittest.main()
