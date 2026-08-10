import { useState, type FormEvent } from "react";
import type { SiteDiaryEntryInput } from "../api/siteDiary";
import type { ScheduleTask } from "../api/schedule";
import type { StockSummaryLine } from "../api/purchasing";
import Modal from "./Modal";
import { IconPlus, IconTrash } from "./icons";

const WEATHER_OPTIONS = ["Sol", "Nublado", "Chuva", "Chuva forte (obra parada)"];

type Props = {
  projectName: string;
  tasks: ScheduleTask[];
  stock: StockSummaryLine[];
  saving: boolean;
  initialDate: string;
  onClose: () => void;
  onSubmit: (input: SiteDiaryEntryInput) => Promise<void>;
};

export default function SiteDiaryCompleteForm({ projectName, tasks, stock, saving, initialDate, onClose, onSubmit }: Props) {
  const [date, setDate] = useState(initialDate);
  const [weather, setWeather] = useState("Sol");
  const [workers, setWorkers] = useState("");
  const [entryTime, setEntryTime] = useState("07:00");
  const [exitTime, setExitTime] = useState("17:00");
  const [equipment, setEquipment] = useState("");
  const [workDone, setWorkDone] = useState("");
  const [notes, setNotes] = useState("");
  const [taskProgress, setTaskProgress] = useState<Array<{ taskId: string; progressPercent: string; notes: string }>>([]);
  const [consumptions, setConsumptions] = useState<Array<{ materialId: string; quantity: string; notes: string }>>([]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSubmit({
      date,
      weather,
      workersPresent: Number(workers),
      entryTime,
      exitTime,
      equipmentPresent: equipment.trim() || undefined,
      workDone: workDone.trim(),
      incidents: notes.trim() || undefined,
      taskProgress: taskProgress.filter((row) => row.taskId && row.progressPercent !== "").map((row) => ({ taskId: row.taskId, progressPercent: Number(row.progressPercent), notes: row.notes.trim() || undefined })),
      consumptions: consumptions.filter((row) => row.materialId && Number(row.quantity) > 0).map((row) => ({ materialId: row.materialId, quantity: Number(row.quantity), notes: row.notes.trim() || undefined })),
    });
  }

  return (
    <Modal title="Registo diário completo" subtitle={`${projectName} · ${date}`} onClose={() => !saving && onClose()} maxWidth="max-w-4xl">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label><span className="label">Data *</span><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} className="input" /></label>
          <label><span className="label">Tempo *</span><select required value={weather} onChange={(event) => setWeather(event.target.value)} className="input">{WEATHER_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select></label>
          <label><span className="label">Trabalhadores *</span><input required type="number" min="0" value={workers} onChange={(event) => setWorkers(event.target.value)} className="input" placeholder="0" /></label>
          <label><span className="label">Horário *</span><div className="grid grid-cols-2 gap-2"><input required aria-label="Entrada" type="time" value={entryTime} onChange={(event) => setEntryTime(event.target.value)} className="input" /><input required aria-label="Saída" type="time" value={exitTime} onChange={(event) => setExitTime(event.target.value)} className="input" /></div></label>
        </div>

        <label className="block"><span className="label">Trabalhos executados *</span><textarea required rows={4} value={workDone} onChange={(event) => setWorkDone(event.target.value)} className="input" placeholder="Indique o que foi executado, a localização e a quantidade quando aplicável." /></label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label><span className="label">Equipamentos utilizados</span><input value={equipment} onChange={(event) => setEquipment(event.target.value)} className="input" placeholder="Ex.: betoneira, vibrador, escavadora" /></label>
          <label><span className="label">Ocorrências e observações</span><input value={notes} onChange={(event) => setNotes(event.target.value)} className="input" placeholder="Visitas, instruções, problemas ou decisões" /></label>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <details className="rounded-xl border border-slate-200 bg-slate-50">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800">Actualizar cronograma {taskProgress.length > 0 && `(${taskProgress.length})`}</summary>
            <div className="space-y-2 border-t border-slate-200 p-4">
              {taskProgress.map((row, index) => <div key={index} className="grid grid-cols-[minmax(0,1fr)_90px_auto] gap-2">
                <select className="input" value={row.taskId} onChange={(event) => setTaskProgress((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, taskId: event.target.value } : item))}>{tasks.map((task) => <option key={task.id} value={task.id}>{task.code} · {task.name}</option>)}</select>
                <input aria-label="Progresso" className="input" type="number" min="0" max="100" step="0.01" placeholder="%" value={row.progressPercent} onChange={(event) => setTaskProgress((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, progressPercent: event.target.value } : item))} />
                <button type="button" className="icon-btn-danger" onClick={() => setTaskProgress((current) => current.filter((_, itemIndex) => itemIndex !== index))}><IconTrash className="h-3.5 w-3.5" /></button>
              </div>)}
              <button type="button" className="btn btn-secondary btn-sm" disabled={!tasks.length} onClick={() => setTaskProgress((current) => [...current, { taskId: tasks[0]?.id ?? "", progressPercent: "", notes: "" }])}><IconPlus className="h-3.5 w-3.5" /> Actividade</button>
              {!tasks.length && <p className="text-xs text-slate-500">O cronograma ainda não tem actividades.</p>}
            </div>
          </details>

          <details className="rounded-xl border border-slate-200 bg-slate-50">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800">Registar consumo de stock {consumptions.length > 0 && `(${consumptions.length})`}</summary>
            <div className="space-y-2 border-t border-slate-200 p-4">
              {consumptions.map((row, index) => {
                const material = stock.find((item) => item.materialId === row.materialId);
                return <div key={index} className="grid grid-cols-[minmax(0,1fr)_110px_auto] gap-2">
                  <select className="input" value={row.materialId} onChange={(event) => setConsumptions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, materialId: event.target.value } : item))}>{stock.filter((item) => item.balance > 0).map((item) => <option key={item.materialId} value={item.materialId}>{item.materialName} · {item.balance.toFixed(2)} {item.unit}</option>)}</select>
                  <input aria-label="Quantidade consumida" className="input" type="number" min="0" step="0.01" placeholder={material?.unit ?? "Qtd."} value={row.quantity} onChange={(event) => setConsumptions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} />
                  <button type="button" className="icon-btn-danger" onClick={() => setConsumptions((current) => current.filter((_, itemIndex) => itemIndex !== index))}><IconTrash className="h-3.5 w-3.5" /></button>
                </div>;
              })}
              <button type="button" className="btn btn-secondary btn-sm" disabled={!stock.some((item) => item.balance > 0)} onClick={() => setConsumptions((current) => [...current, { materialId: stock.find((item) => item.balance > 0)?.materialId ?? "", quantity: "", notes: "" }])}><IconPlus className="h-3.5 w-3.5" /> Material</button>
              {!stock.some((item) => item.balance > 0) && <p className="text-xs text-slate-500">Não existe stock disponível nesta obra.</p>}
            </div>
          </details>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button><button type="submit" disabled={saving} className="btn btn-primary">{saving ? "A submeter…" : "Submeter registo diário"}</button></div>
      </form>
    </Modal>
  );
}
