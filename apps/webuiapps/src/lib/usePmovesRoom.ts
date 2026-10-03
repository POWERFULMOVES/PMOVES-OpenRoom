import { useEffect, useState } from 'react';
import { getActiveRoom, type PmovesRoomManifest } from './pmovesRoomAdapter';

/** React binding for the PMOVES room adapter. Re-renders on 'pmoves-room-loaded'. */
export function usePmovesRoom(): PmovesRoomManifest | null {
  const [room, setRoom] = useState<PmovesRoomManifest | null>(() => getActiveRoom());
  useEffect(() => {
    const onRoom = (e: Event) => setRoom((e as CustomEvent<PmovesRoomManifest>).detail);
    document.addEventListener('pmoves-room-loaded', onRoom);
    if (getActiveRoom()) setRoom(getActiveRoom());
    return () => document.removeEventListener('pmoves-room-loaded', onRoom);
  }, []);
  return room;
}
