// UPSTREAM-DIVERGENCE(temporary): upstream bug — DeepMutable destroys branded scalar identity. Remove when upstream fixes it.
// Branded primitives also satisfy `object`; keep their scalar identity intact.
export type DeepMutable<A> = A extends string | number | bigint | boolean | symbol | null | undefined
  ? A
  : A extends (...args: never[]) => unknown
    ? A
    : A extends ReadonlyMap<infer K, infer V>
      ? Map<DeepMutable<K>, DeepMutable<V>>
      : A extends ReadonlyArray<infer I>
        ? DeepMutable<I>[]
        : A extends object
          ? { -readonly [K in keyof A]: DeepMutable<A[K]> }
          : A
