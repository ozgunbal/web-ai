import React from "react";
import ReactDOM from "react-dom/client";
import { EvalPage } from "./EvalPage";
import "../styles/theme.css";
import "./eval.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <EvalPage />
  </React.StrictMode>,
);
