export const noop = () => {
  /* intentionally empty */
};

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[Feathermarks] ${message}`);
  }
}
