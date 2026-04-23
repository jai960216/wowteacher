// DEV 빌드에서만 찍히는 console 래퍼. 프로덕션에서는 no-op.
// console.error / console.warn은 그대로 쓰고, 진단용 console.log만 이 래퍼로 교체.
export const devLog: (...args: unknown[]) => void =
  import.meta.env.DEV ? console.log.bind(console) : () => {};
