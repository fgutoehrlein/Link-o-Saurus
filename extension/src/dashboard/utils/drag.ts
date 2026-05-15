export const createDragPayload = (ids: readonly string[]): string => {
  return JSON.stringify({ ids: Array.from(new Set(ids)) });
};

export const parseDragPayload = (event: DragEvent): string[] => {
  const payload = event.dataTransfer?.getData('application/x-linkosaurus-bookmark');
  if (!payload) {
    return [];
  }
  try {
    const parsed = JSON.parse(payload) as { ids?: unknown };
    if (Array.isArray(parsed.ids)) {
      return parsed.ids.map((id) => String(id));
    }
  } catch (error) {
    console.warn('Failed to parse drag payload', error);
  }
  return [];
};
