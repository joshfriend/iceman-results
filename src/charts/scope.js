export function chartScope(root, { ownsTooltip = false } = {}) {
  const observers = new Set();
  const listeners = [];
  return {
    $: (id) => root.querySelector(`#${id}`),
    observe(element, callback) {
      const observer = new ResizeObserver(callback);
      observers.add(observer);
      observer.observe(element);
      return observer;
    },
    on(element, event, listener) {
      element.addEventListener(event, listener);
      listeners.push(() => element.removeEventListener(event, listener));
    },
    destroy() {
      for (const observer of observers) observer.disconnect();
      for (const remove of listeners) remove();
      if (ownsTooltip) document.getElementById("chart-tooltip")?.remove();
    },
  };
}
