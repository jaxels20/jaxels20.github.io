import { useEffect } from 'react'

export const SITE_NAME = 'Badminton Intelligence'

/** Path (pathname + search) that the current document.title was set for. */
let titledPath: string | null = null

export function pathHasTitle(path: string): boolean {
  return titledPath === path
}

/**
 * Sets the document title for the current page. Pass `null` while the name is still
 * loading; the analytics tracker waits briefly for a real title before recording
 * the page view, so the dashboard shows "Vendsyssel 2 · Hold" rather than a bare path.
 */
export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    if (title) {
      document.title = `${title} · ${SITE_NAME}`
      titledPath = `${window.location.pathname}${window.location.search}`
    } else {
      document.title = SITE_NAME
    }
  }, [title])
}
