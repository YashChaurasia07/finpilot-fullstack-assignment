import { useEffect } from 'react';

/** Each page sets the browser tab / screen-reader title ("Customers · FinPilot"). */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · FinPilot`;
  }, [title]);
}
