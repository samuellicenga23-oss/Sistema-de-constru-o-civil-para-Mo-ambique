export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function resolveBoqHistoryShortcut(
  event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; target: EventTarget | null },
  history: { canUndo: boolean; canRedo: boolean },
): "undo" | "redo" | null {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return null;
  if (event.shiftKey) {
    return history.canRedo ? "redo" : null;
  }
  if (!history.canUndo) return null;
  return "undo";
}
