import { StrictMode, Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { kaynnistaVari } from "./vari";
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
        <main>
          <div className="wrap stack">
            <p className="note note--stop" role="alert">
              Päiväkirjaa ei voitu avata. Selaimen pitää sallia tämän sivuston
              tallennus; yksityisessä selaustilassa se ei aina onnistu.
            </p>
            <div className="actions">
              <button className="btn" onClick={() => location.reload()}>
                Yritä uudelleen
              </button>
            </div>
          </div>
        </main>
      );
    return this.props.children;
  }
}
kaynnistaVari();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
