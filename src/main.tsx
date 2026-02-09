import { createRoot } from "react-dom/client";
import { StatsigProvider } from "@statsig/react-bindings";
import { StatsigSessionReplayPlugin } from "@statsig/session-replay";
import { StatsigAutoCapturePlugin } from "@statsig/web-analytics";
import App from "./App";
import "./index.css";

const statsigClientKey = import.meta.env.VITE_STATSIG_CLIENT_KEY as
  | string
  | undefined;

createRoot(document.getElementById("root")!).render(
  statsigClientKey ? (
    <StatsigProvider
      sdkKey={statsigClientKey}
      user={{}}
      options={{
        plugins: [
          new StatsigSessionReplayPlugin(),
          new StatsigAutoCapturePlugin(),
        ],
      }}
    >
      <App />
    </StatsigProvider>
  ) : (
    <App />
  ),
);
