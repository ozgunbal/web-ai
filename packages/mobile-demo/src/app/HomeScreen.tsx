import { useState } from "react";
import { View, Text, TextInput, Button, FlatList } from "react-native";
import { SEED_ACCOUNTS } from "../mock-data/accounts";
import { useNetworkStatus } from "../agent/useNetworkStatus";
import { extractIntent } from "../agent/slotExtractor";
import { enqueueIfAllowed } from "../agent/offlineQueue";
import { evaluateIntent } from "@web-ai-trials/core";

export function HomeScreen() {
  const { isOnline } = useNetworkStatus();
  const [input, setInput] = useState("");
  const [log, setLog] = useState<string[]>([]);

  async function handleSend() {
    const extraction = extractIntent(input);
    if (!extraction.ok || !extraction.intent) {
      setLog((prev) => [...prev, `Could not understand: ${extraction.reason}`]);
      setInput("");
      return;
    }

    if (!isOnline) {
      const result = await enqueueIfAllowed(extraction.intent);
      setLog((prev) => [
        ...prev,
        result.ok
          ? `Queued (offline): ${extraction.intent!.type}`
          : `Refused (offline): ${result.reason}`,
      ]);
      setInput("");
      return;
    }

    const { decision, matchedRule } = evaluateIntent(extraction.intent);
    setLog((prev) => [...prev, `${extraction.intent!.type} -> ${decision} (${matchedRule.reason})`]);
    setInput("");
  }

  return (
    <View style={{ padding: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: "bold" }}>Mock Bank (mobile)</Text>
      <Text>Network: {isOnline ? "online" : "offline"}</Text>
      <FlatList
        data={SEED_ACCOUNTS}
        keyExtractor={(a) => a.id}
        renderItem={({ item }) => (
          <Text>
            {item.name}: {item.currency} {item.balance.toFixed(2)}
          </Text>
        )}
      />
      <TextInput
        value={input}
        onChangeText={setInput}
        placeholder="Ask the agent..."
        style={{ borderWidth: 1, marginVertical: 8, padding: 8 }}
      />
      <Button title="Send" onPress={handleSend} />
      {log.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
    </View>
  );
}
