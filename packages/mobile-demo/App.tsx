import { useState } from "react";
import { View, Button } from "react-native";
import { StatusBar } from "expo-status-bar";
import { HomeScreen } from "./src/app/HomeScreen";
import { QueueScreen } from "./src/app/QueueScreen";

export default function App() {
  const [screen, setScreen] = useState<"home" | "queue">("home");
  return (
    <View style={{ flex: 1, paddingTop: 48 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-around" }}>
        <Button title="Home" onPress={() => setScreen("home")} />
        <Button title="Queue" onPress={() => setScreen("queue")} />
      </View>
      {screen === "home" ? <HomeScreen /> : <QueueScreen />}
      <StatusBar style="auto" />
    </View>
  );
}
