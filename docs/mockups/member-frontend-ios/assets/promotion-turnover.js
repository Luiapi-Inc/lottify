(function () {
  const tabs = [...document.querySelectorAll('[data-pt-tab]')];
  const panels = [...document.querySelectorAll('[data-pt-panel]')];
  if (!tabs.length || !panels.length) return;

  function activate(name, focusTab) {
    tabs.forEach((tab) => {
      const active = tab.dataset.ptTab === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focusTab) tab.focus();
    });
    panels.forEach((panel) => { panel.hidden = panel.dataset.ptPanel !== name; });
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab.dataset.ptTab, false));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let next = index;
      if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      activate(tabs[next].dataset.ptTab, true);
    });
  });

  document.querySelectorAll('[data-pt-open]').forEach((button) => {
    button.addEventListener('click', () => {
      const name = button.dataset.ptOpen;
      activate(name, false);
      document.querySelector(`[data-pt-panel="${name}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });

  activate('summary', false);
})();
