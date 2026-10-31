import { useCallback, useEffect, useRef, useState } from 'react'
import { detectPhone, type CurrentContact } from './whatsapp-bridge'

/**
 * Tenta descobrir o telefone da conversa aberta pelo painel "Dados do contato".
 * Roda sozinho uma vez ao montar (se o contato ainda não tem telefone) e pode ser repetido com run().
 */
export function usePhoneDetection(contact: CurrentContact | null, onFound: (phone: string) => void) {
  const [detecting, setDetecting] = useState(false)
  const [failed, setFailed] = useState(false)
  const found = useRef(onFound)
  found.current = onFound

  const run = useCallback(() => {
    setDetecting(true)
    setFailed(false)
    void detectPhone()
      .then(r => {
        if (r.phone) found.current(r.phone)
        else setFailed(true)
      })
      .catch(() => setFailed(true))
      .finally(() => setDetecting(false))
  }, [])

  useEffect(() => {
    if (contact && !contact.phone) run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { detecting, failed, run }
}
