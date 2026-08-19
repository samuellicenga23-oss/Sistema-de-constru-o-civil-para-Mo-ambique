export type LocatableMeasurement = {
  id: string;
  floor?: string | null;
  zone?: string | null;
};

export function measurementLocationGroupKey(line: LocatableMeasurement): string {
  return [line.floor?.trim(), line.zone?.trim()].filter(Boolean).join(" · ");
}

export function groupMeasurementsByFloorZone<T extends LocatableMeasurement>(lines: T[]): Array<{ key: string; lines: T[] }> {
  const order: string[] = [];
  const map = new Map<string, T[]>();
  for (const line of lines) {
    const key = measurementLocationGroupKey(line);
    if (!map.has(key)) {
      order.push(key);
      map.set(key, []);
    }
    map.get(key)!.push(line);
  }
  return order.map((key) => ({ key, lines: map.get(key)! }));
}
