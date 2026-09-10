(function () {
  const root = document.querySelector('[data-correction-history]');
  if (!root) return;
  const buttons = [...root.querySelectorAll('[data-correction-filter]')];
  const events = [...root.querySelectorAll('[data-correction-event]')];
  buttons.forEach((button) => button.setAttribute('aria-pressed', button.classList.contains('active') ? 'true' : 'false'));
  buttons.forEach((button) => button.addEventListener('click', () => {
    const filter = button.dataset.correctionFilter;
    buttons.forEach((item) => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    events.forEach((event) => { event.hidden = filter === 'current' && event.dataset.correctionEvent !== 'current'; });
  }));
})();
