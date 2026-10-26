import { useEffect, useState } from "react";
import NetInfo from "@react-native-community/netinfo";

/** Thin wrapper hook around NetInfo — drives isOnline for the agent flow to decide "queue or execute directly." */
export function useNetworkStatus(): { isOnline: boolean } {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOnline(Boolean(state.isConnected));
    });
    return () => unsubscribe();
  }, []);

  return { isOnline };
}
