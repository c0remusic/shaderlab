import type { Preview } from "@storybook/react-vite";
import "../src/design/index.css";
import "../src/design/tailwind.css";

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: "app",
      values: [{ name: "app", value: "var(--primitive-neutral-925)" }],
    },
  },
  tags: ["autodocs"],
};

export default preview;
