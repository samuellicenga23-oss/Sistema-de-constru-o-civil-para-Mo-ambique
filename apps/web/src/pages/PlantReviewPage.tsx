import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { plantsApi, type ExtractedRoom, type ExtractedRebarLine, type Plant } from "../api/plants";
import { boqApi, type BudgetDocument } from "../api/boq";
import Layout from "../components/Layout";
import { IconBack, IconWand } from "../components/icons";

const UNASSIGNED_FLOOR = "Piso não identificado";

// Ordena os pisos por senso comum de construção: térreo primeiro, depois pisos numerados a
// subir, depois zonas especiais (anexo, cobertura), e por fim o que não foi identificado.
function floorSortKey(floor: string): number {
  const f = floor.toLowerCase();
  if (f.includes("térreo") || f.includes("terreo") || f.includes("rés")) return 0;
  const numMatch = f.match(/(\d+)/);
  if (numMatch) return parseInt(numMatch[1], 10);
  if (f.includes("superior")) return 50;
  if (f.includes("anexo")) return 80;
  if (f.includes("cobertura")) return 90;
  if (f === UNASSIGNED_FLOOR) return 999;
  return 60;
}

export default function PlantReviewPage() {
  const { id } = useParams<{ id: string }>();
  const [plant, setPlant] = useState<Plant | null>(null);
  const [rooms, setRooms] = useState<ExtractedRoom[]>([]);
  const [rebarSchedules, setRebarSchedules] = useState<ExtractedRebarLine[]>([]);
  const [documents, setDocuments] = useState<BudgetDocument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savingRoomId, setSavingRoomId] = useState<string | null>(null);
  const [reprocessing, setReprocessing] = useState(false);

  useEffect(() => {
    if (!id) return;
    plantsApi
      .detail(id)
      .then(async (detail) => {
        setPlant(detail.plant);
        setRooms(detail.rooms);
        setRebarSchedules(detail.rebarSchedules);
        setDocuments(await boqApi.listBudgetDocuments(detail.plant.projectId));
      })
      .catch((err) => setError(err.message));
  }, [id]);

  // Reprocessa o ficheiro já guardado com a lógica de extracção mais recente — útil quando o
  // sistema é melhorado depois de a planta já ter sido carregada, sem obrigar o utilizador a
  // encontrar e reenviar o PDF outra vez.
  async function handleReprocess() {
    if (!id) return;
    setReprocessing(true);
    setError(null);
    try {
      const updated = await plantsApi.reprocess(id);
      setPlant(updated);
      const detail = await plantsApi.detail(id);
      setRooms(detail.rooms);
      setRebarSchedules(detail.rebarSchedules);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao reprocessar a planta");
    } finally {
      setReprocessing(false);
    }
  }

  const floorNames = useMemo(() => {
    const names = new Set(rooms.map((r) => r.floor ?? UNASSIGNED_FLOOR));
    return Array.from(names).sort((a, b) => floorSortKey(a) - floorSortKey(b));
  }, [rooms]);

  const roomsByFloor = useMemo(() => {
    const groups = new Map<string, ExtractedRoom[]>();
    for (const name of floorNames) groups.set(name, []);
    for (const room of rooms) groups.get(room.floor ?? UNASSIGNED_FLOOR)!.push(room);
    return groups;
  }, [rooms, floorNames]);

  async function handleFloorChange(roomId: string, value: string) {
    if (!id) return;
    let newFloor: string | null = value;
    if (value === "__new__") {
      const typed = window.prompt("Nome do novo piso (ex: \"3º Piso\", \"Cave\"):");
      if (!typed || !typed.trim()) return;
      newFloor = typed.trim();
    } else if (value === UNASSIGNED_FLOOR) {
      newFloor = null;
    }
    setSavingRoomId(roomId);
    setError(null);
    try {
      const updated = await plantsApi.updateRoomFloor(id, roomId, newFloor);
      setRooms((rs) => rs.map((r) => (r.id === roomId ? updated : r)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao reatribuir piso");
    } finally {
      setSavingRoomId(null);
    }
  }

  if (!plant) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">A carregar...</div>;
  }

  const totalRoomsArea = rooms.reduce((s, r) => s + Number(r.areaM2), 0);
  const totalRebarWeight = rebarSchedules.reduce((s, r) => s + Number(r.weightKg), 0);
  const targetDoc = documents[0];

  // Lacunas de extracção: o utilizador pediu explicitamente para ser informado do que não foi
  // possível puxar automaticamente da planta, sem lhe perguntar como reformatar o ficheiro — por
  // isso listamos factos concretos (o quê não foi encontrado) e nunca pedimos para reenviar nada.
  const gaps: string[] = [];
  if (plant.processingStatus === "erro") {
    gaps.push(
      plant.errorMessage
        ? `Não foi possível processar este ficheiro: ${plant.errorMessage}.`
        : "Não foi possível processar este ficheiro."
    );
  } else if (plant.discipline === "estrutura") {
    const s = plant.structuralSummary;
    if (!s) {
      gaps.push(
        "Não foi possível identificar nenhum elemento estrutural (sapatas, pilares ou vigas) nesta planta — o formato deste desenho ainda não é reconhecido pelo sistema."
      );
    } else {
      if (s.footingsCount === 0) gaps.push("Não foram identificadas sapatas/fundações.");
      if (s.columnsCount === 0) gaps.push("Não foram identificados pilares.");
      if (s.beamsCount === 0) gaps.push("Não foram identificadas vigas.");
      if (s.slabsCount === 0) gaps.push("Não foi identificada armadura de laje/cobertura.");
      if (s.totalSteelWeightKg === 0 && rebarSchedules.length === 0 && (s.footingsCount > 0 || s.columnsCount > 0 || s.beamsCount > 0)) {
        gaps.push(
          "Não foi possível determinar o peso total de aço — este desenho não parece incluir resumos de peso por elemento, apenas posições/comprimentos de varões."
        );
      }
    }
  } else if (plant.discipline === "arquitectura") {
    if (rooms.length === 0) {
      gaps.push("Não foram identificados compartimentos (áreas) nesta planta.");
    }
  }

  return (
    <Layout
      title={plant.originalFileName ?? "Planta"}
      actions={
        <div className="flex gap-2">
          <button onClick={handleReprocess} disabled={reprocessing} className="btn btn-ghost btn-sm">
            <IconWand className="w-3.5 h-3.5" />
            {reprocessing ? "A reprocessar..." : "Reprocessar"}
          </button>
          <Link to={`/projectos/${plant.projectId}`} className="btn btn-ghost btn-sm">
            <IconBack className="w-3.5 h-3.5" />
            Voltar ao projecto
          </Link>
        </div>
      }
    >
      <div className="space-y-5 max-w-4xl">
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="card card-pad text-xs text-gray-500 leading-relaxed">
          <p className="font-medium text-gray-700 mb-1">Como esta informação é usada</p>
          <p>
            Os dados extraídos abaixo não são escritos directamente no Mapa de Quantidades — servem para{" "}
            <strong>ajustar as quantidades dos itens-padrão já existentes</strong> (do capítulo de fundações ao de
            acabamentos) através do Assistente de Medições, sem duplicar um item por compartimento/elemento nem criar
            capítulos novos.
          </p>
        </div>

        {gaps.length > 0 && (
          <section className="card card-pad border-amber-200 bg-amber-50">
            <div className="flex items-center gap-2 mb-2">
              <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-amber-600 shrink-0">
                <path
                  d="M12 3.5 2 20h20L12 3.5Z M12 9.5v4.5 M12 17h.01"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <h2 className="section-title text-amber-900">O que não foi possível extrair automaticamente</h2>
            </div>
            <ul className="text-sm text-amber-900 space-y-1 list-disc pl-5">
              {gaps.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
            <p className="text-xs text-amber-700 mt-2">
              Estes pontos podem ser preenchidos à mão no Assistente de Medições ou directamente no Mapa de
              Quantidades — o resto da planta continua a ser usado normalmente.
            </p>
          </section>
        )}

        {plant.structuralSummary && (
          <section className="card card-pad">
            <div className="flex items-center gap-2 mb-3">
              <IconWand className="w-4 h-4 text-brand-700" />
              <h2 className="section-title">Resumo estrutural detectado</h2>
            </div>
            <div className="grid grid-cols-5 gap-3 text-center mb-3">
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xl font-semibold text-gray-900">{plant.structuralSummary.footingsCount}</p>
                <p className="muted">
                  sapatas ·{" "}
                  {((plant.structuralSummary.footingsAvgWidthCm / 100) * (plant.structuralSummary.footingsAvgLengthCm / 100)).toFixed(2)}{" "}
                  m² méd.
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xl font-semibold text-gray-900">{plant.structuralSummary.columnsCount}</p>
                <p className="muted">pilares</p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xl font-semibold text-gray-900">{plant.structuralSummary.beamsCount}</p>
                <p className="muted">
                  vigas · {plant.structuralSummary.beamsTotalLengthM.toFixed(1)} ml · {plant.structuralSummary.beamsConcreteVolumeM3.toFixed(2)} m³
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xl font-semibold text-gray-900">{plant.structuralSummary.slabsCount}</p>
                <p className="muted">folha(s) de laje · e={plant.structuralSummary.slabsAvgThicknessCm.toFixed(0)}cm</p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xl font-semibold text-gray-900">{plant.structuralSummary.totalSteelWeightKg.toFixed(0)}</p>
                <p className="muted">kg de aço total</p>
              </div>
            </div>
            {plant.structuralSummary.staircasesCount > 0 && (
              <p className="text-sm text-gray-600 mb-3">
                {plant.structuralSummary.staircasesCount} escada(s) detectada(s) — o aço da(s) escada(s) já está incluído no
                total acima.
              </p>
            )}
            <p className="text-xs text-gray-500 mb-3">
              Estes números vêm do quadro de elementos de fundação, do quadro de pilares/vigas, das folhas de armadura
              de laje/cobertura por piso, do detalhe de escadas e do resumo de aço do projecto estrutural. Ao abrir o
              Assistente de Medições num Mapa de Quantidades deste projecto, o nº de sapatas, a área/profundidade
              média, o volume real de betão em vigas (comprimento × secção de cada vão), a espessura real da laje e o
              peso total de aço já vêm preenchidos automaticamente — não precisa de os medir à mão outra vez, e nenhum
              item novo é criado (só os itens-padrão de fundação/estrutura ficam mais precisos). O volume de betão em
              pilares continua a usar uma estimativa genérica — a secção de cada pilar não vem
              como um dado limpo neste tipo de ficheiro (só o desenho da cofragem, sem um valor de largura×altura
              isolado), pelo que não é seguro extraí-la automaticamente.
            </p>
            {targetDoc && (
              <Link to={`/documentos/${targetDoc.id}`} className="btn btn-primary btn-sm">
                <IconWand className="w-3.5 h-3.5" />
                Ir para o Mapa de Quantidades e usar o Assistente
              </Link>
            )}
          </section>
        )}

        {rooms.length > 0 && (
          <section className="card card-pad">
            <div className="flex items-center gap-2 mb-3">
              <IconWand className="w-4 h-4 text-brand-700" />
              <h2 className="section-title">Compartimentos detectados ({rooms.length}) — confirme o piso de cada um</h2>
            </div>
            <p className="text-sm text-gray-600 mb-3">
              Área total: <span className="font-semibold text-gray-900">{totalRoomsArea.toFixed(2)} m²</span>, em{" "}
              {floorNames.length} piso(s) detectado(s). A detecção automática (pelo texto da folha) pode falhar em
              casos ambíguos — reveja e corrija o piso de qualquer compartimento antes de continuar. Cada piso vira um
              piso próprio no Assistente de Medições; nenhum item é criado por compartimento.
            </p>
            {targetDoc && (
              <Link to={`/documentos/${targetDoc.id}`} className="btn btn-primary btn-sm mb-4">
                <IconWand className="w-3.5 h-3.5" />
                Confirmar e usar no Assistente
              </Link>
            )}

            <div className="space-y-4">
              {floorNames.map((floorName) => {
                const floorRooms = roomsByFloor.get(floorName) ?? [];
                const floorArea = floorRooms.reduce((s, r) => s + Number(r.areaM2), 0);
                return (
                  <div key={floorName} className="rounded-lg border border-gray-200">
                    <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200 rounded-t-lg">
                      <span className="font-medium text-gray-900 text-sm">{floorName}</span>
                      <span className="muted">
                        {floorRooms.length} compartimento(s) · {floorArea.toFixed(2)} m²
                      </span>
                    </div>
                    <table className="w-full text-sm">
                      <tbody>
                        {floorRooms.map((r) => (
                          <tr key={r.id} className="table-row">
                            <td className="py-1.5 pl-3">{r.name}</td>
                            <td className="text-gray-400">{r.number}</td>
                            <td className="text-right tabular-nums">{Number(r.areaM2).toFixed(2)} m²</td>
                            <td className="text-right pr-3 w-48">
                              <select
                                value={r.floor ?? UNASSIGNED_FLOOR}
                                disabled={savingRoomId === r.id}
                                onChange={(e) => handleFloorChange(r.id, e.target.value)}
                                className="input input-sm"
                              >
                                {floorNames.map((f) => (
                                  <option key={f} value={f}>
                                    {f}
                                  </option>
                                ))}
                                <option value="__new__">+ Novo piso...</option>
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {rebarSchedules.length > 0 && (
          <section className="card card-pad">
            <h2 className="section-title mb-3">Aço estrutural detectado ({rebarSchedules.length} linhas)</h2>
            <p className="text-sm text-gray-600 mb-3">
              Peso total: <span className="font-semibold text-gray-900">{totalRebarWeight.toFixed(2)} kg</span>. Este
              total já está incluído no resumo estrutural acima e substitui o rácio genérico kg/m³ do item de aço
              quando usa o Assistente — sem criar um item por elemento/diâmetro.
            </p>
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="table-head-row">
                    <th className="text-left py-1.5">Elemento</th>
                    <th className="text-left">Diâmetro</th>
                    <th className="text-right">Peso (kg)</th>
                    <th className="text-right">Página</th>
                  </tr>
                </thead>
                <tbody>
                  {rebarSchedules.map((r) => (
                    <tr key={r.id} className="table-row">
                      <td className="py-1.5">{r.element}</td>
                      <td>Ø{Number(r.diameterMm)}mm</td>
                      <td className="text-right tabular-nums">{Number(r.weightKg).toFixed(2)}</td>
                      <td className="text-right tabular-nums">{r.page}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </Layout>
  );
}
