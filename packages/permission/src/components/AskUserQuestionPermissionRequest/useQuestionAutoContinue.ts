import { useEffect, useRef, useState } from 'react'
import { useInput } from '@anthropic/ink'

export function useQuestionAutoContinue(
  timeoutMs: number,
  onTimeout: () => void,
): number | null {
  const callbackRef = useRef(onTimeout)
  callbackRef.current = onTimeout
  const [cancelled, setCancelled] = useState(false)
  const [remaining, setRemaining] = useState(Math.ceil(timeoutMs / 1000))
  useInput(() => setCancelled(true), { isActive: timeoutMs > 0 && !cancelled })

  useEffect(() => {
    if (timeoutMs <= 0 || cancelled) return
    const deadline = Date.now() + timeoutMs
    const tick = setInterval(
      () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))),
      1000,
    )
    const timer = setTimeout(() => callbackRef.current(), timeoutMs)
    return () => {
      clearInterval(tick)
      clearTimeout(timer)
    }
  }, [timeoutMs, cancelled])

  return timeoutMs > 0 && !cancelled ? remaining : null
}
