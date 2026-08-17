/**
 * Entry point, plus the last line of defence.
 *
 * Everything reachable through dropping a log is handled where it happens: the Worker catches, the
 * client rejects, `App.vue` calls `failLoad`, and the drop zone shows what went wrong. This file
 * covers what is left — a defect in a component's render, or a rejected promise nobody awaited.
 * Vue's default for both is to log to the console and leave the page as it is, which for a user who
 * is not going to open devtools means a blank or frozen workspace with no explanation.
 *
 * A tool whose whole argument is that it never hides a failure cannot exit silently itself.
 */
import { createApp } from 'vue';

import App from './App.vue';
import './styles.css';

const MOUNT_SELECTOR = '#app';

/** Replace the page with something that says what happened and how to recover. */
function showFatal(detail: string): void {
  const host = document.querySelector(MOUNT_SELECTOR);
  if (host === null) {
    return;
  }

  // Built with the DOM rather than innerHTML: `detail` is an error message, and error messages
  // routinely contain a file name the user chose.
  host.replaceChildren();

  const panel = document.createElement('div');
  panel.className = 'fatal';
  panel.setAttribute('role', 'alert');

  const heading = document.createElement('h1');
  heading.textContent = 'PandaLog stopped unexpectedly.';

  const explanation = document.createElement('p');
  explanation.textContent =
    'This is a defect in PandaLog, not in your log file. Nothing was uploaded and nothing was ' +
    'changed on your machine. Reload the page to start again; the message below is what to report.';

  const message = document.createElement('pre');
  message.textContent = detail;

  panel.append(heading, explanation, message);
  host.append(panel);
}

const describe = (error: unknown): string =>
  error instanceof Error
    ? `${error.name}: ${error.message}\n\n${error.stack ?? ''}`
    : String(error);

const app = createApp(App);

/*
 * These two `console.error` calls are the only ones in the app, and the lint rule is suspended for
 * them deliberately. The panel shows a user a flattened string; the console keeps the original
 * error object with its prototype, its `cause` and a live stack, which is what anybody debugging a
 * report actually needs. Dropping the log to satisfy the rule would trade the useful copy for the
 * readable one.
 */
app.config.errorHandler = (error: unknown, _instance, info: string) => {
  // eslint-disable-next-line no-console
  console.error('PandaLog: unhandled error in', info, error);
  showFatal(`${describe(error)}\n\nWhile: ${info}`);
};

window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  // eslint-disable-next-line no-console
  console.error('PandaLog: unhandled rejection', event.reason);
  showFatal(describe(event.reason));
});

app.mount(MOUNT_SELECTOR);
