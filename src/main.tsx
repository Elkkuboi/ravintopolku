import { StrictMode, Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    if (this.state.error)
      return (
        <main className="card">
          <h1>Päiväkirjaa ei voitu avata</h1>
          <p>
            Tarkista, että selain sallii tämän sivuston paikallisen
            tallennuksen. Sulje yksityinen selaustila tai kokeile sivun
            lataamista uudelleen. Älä poista selaintietoja ilman varmuuskopiota.
          </p>
          <button className="primary" onClick={() => location.reload()}>
            Yritä uudelleen
          </button>
        </main>
      );
    return this.props.children;
  }
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
