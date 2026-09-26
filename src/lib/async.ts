function abortError(signal: AbortSignal) {
  return signal.reason ?? new DOMException("操作已取消", "AbortError")
}

export function delay(duration: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal))
      return
    }
    const abort = () => {
      clearTimeout(timer)
      reject(abortError(signal))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort)
      resolve()
    }, duration)
    signal.addEventListener("abort", abort, { once: true })
  })
}

export function createTimeoutSignal(parentSignal: AbortSignal, timeout: number) {
  const controller = new AbortController()
  const abort = () => controller.abort(parentSignal.reason)
  const timer = setTimeout(() => controller.abort(new DOMException("请求超时", "TimeoutError")), timeout)
  if (parentSignal.aborted) abort()
  else parentSignal.addEventListener("abort", abort, { once: true })
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer)
      parentSignal.removeEventListener("abort", abort)
    },
  }
}

export async function runConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  signal: AbortSignal,
  task: (item: T, index: number) => Promise<R>,
  onResult?: (result: R, index: number) => void,
) {
  const results = new Array<R | undefined>(items.length)
  let nextIndex = 0
  async function worker() {
    while (!signal.aborted) {
      const index = nextIndex++
      if (index >= items.length) return
      const result = await task(items[index] as T, index)
      results[index] = result
      onResult?.(result, index)
    }
  }
  const count = Math.min(Math.max(1, Math.floor(concurrency)), items.length)
  await Promise.all(Array.from({ length: count }, worker))
  return results.filter((result): result is R => result !== undefined)
}
