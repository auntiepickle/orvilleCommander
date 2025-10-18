// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true, // Expose on 0.0.0.0 to fix localhost HMR issues on Windows
    hmr: {
      host: 'localhost', // Explicitly set HMR host for reliable websocket connection
      protocol: 'ws', // Use ws (non-secure) for local dev
    },
    watch: {
      usePolling: true, // Poll for changes (essential for WSL2 or Windows watcher issues)
      interval: 300, // Shorter poll interval for quicker detection (default 1000ms may be too slow)
      ignored: ['**/node_modules/**'], // Ignore node_modules to optimize performance
    },
  },
});