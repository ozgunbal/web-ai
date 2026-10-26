import { useCallback, useEffect, useState } from "react";
import { View, Text, Button } from "react-native";
import { readQueue, type QueuedItem } from "../agent/offlineQueue";
import { drainQueueOnReconnect, type DrainResultItem } from "../agent/reconnectDrain";
import { useNetworkStatus } from "../agent/useNetworkStatus";

export function QueueScreen() {
  const { isOnline } = useNetworkStatus();
  const [queue, setQueue] = useState<QueuedItem[]>([]);
  const [drainResults, setDrainResults] = useState<DrainResultItem[]>([]);

  const refresh = useCallback(() => {
    readQueue().then(setQueue);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (isOnline) {
      drainQueueOnReconnect().then((results) => {
        setDrainResults(results);
        refresh();
      });
    }
  }, [isOnline, refresh]);

  return (
    <View style={{ padding: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: "bold" }}>Offline Queue</Text>
      <Text>Network: {isOnline ? "online" : "offline"}</Text>
      <Button title="Refresh" onPress={refresh} />
      {queue.map((item) => (
        <Text key={item.id}>
          {item.intent.type} — queued {new Date(item.queuedAt).toLocaleTimeString()}
        </Text>
      ))}
      {drainResults.length > 0 && (
        <View>
          <Text style={{ fontWeight: "bold" }}>Last drain results:</Text>
          {drainResults.map((r, i) => (
            <Text key={i}>
              {r.item.intent.type} → {r.decision} {r.executed ? "(executed)" : "(pending/dropped)"}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}
