import { useEffect, useRef } from 'react'

export function useScrollReveal() {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) {
      el.classList.add('visible')
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add('visible')
          observer.disconnect()
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -48px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return ref
}

export function useScrollY() {
  const scrollY = useRef(0)

  useEffect(() => {
    const handler = () => { scrollY.current = window.scrollY }
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])

  return scrollY
}
