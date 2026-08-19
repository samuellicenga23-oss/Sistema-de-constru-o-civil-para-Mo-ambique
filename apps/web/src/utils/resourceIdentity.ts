export function resolveSupplierLookupId(
  line: { refId: string; familyKey?: string | null },
  options: Array<{ id: string; familyKey?: string | null }>,
): string {
  if (line.familyKey) {
    const byFamily = options.find((option) => option.familyKey === line.familyKey);
    if (byFamily) return byFamily.id;
  }
  return options.find((option) => option.id === line.refId)?.id ?? line.refId;
}
