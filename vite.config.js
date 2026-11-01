import { defineConfig } from "vite";

export default defineConfig({
  server: {
    allowedHosts: true,
  },
  plugins: [{
    name: "gosolo-cloud-account",
    transformIndexHtml(html) {
      return html.replace("</body>", '<script type="module" src="/src/cloud.js"></script>\n</body>');
    }
  }]
});
