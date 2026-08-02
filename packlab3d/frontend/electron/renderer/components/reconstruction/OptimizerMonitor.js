import { actionButton, el, makePanel, svgEl, tr } from '../editorUtils.js';

export function mountOptimizerMonitor(container, { i18n, report, activeJob, onCancel, onAcceptCheckpoint }) {
  container.innerHTML = '';
  const panel = makePanel(tr('phase7.optimizer.monitor', 'Optimizer Monitor', i18n));
  const opt = report?.optimizationReport || {};
  const toolbar = el('div', 'interactive-editor__toolbar');
  const metrics = el('pre', 'optimizer-monitor');
  const chart = svgEl('svg', { class: 'optimizer-monitor__chart', viewBox: '0 0 320 120', role: 'img' });
  const perView = el('div', 'silhouette-diagnostics');
  const termsPanel = el('div', 'objective-terms-panel');
  toolbar.append(
    actionButton(tr('phase7.optimizer.cancel', 'Cancel', i18n), () => onCancel?.(activeJob?.id), 'editor-button editor-button--warning'),
    actionButton(tr('phase7.optimizer.acceptBest', 'Accept Current Best', i18n), () => {
      const checkpoint = (opt.checkpoints || []).slice(-1)[0];
      onAcceptCheckpoint?.(checkpoint);
    }),
  );
  panel.append(toolbar, metrics, chart, perView, termsPanel);
  container.appendChild(panel);
  render();

  function render() {
    const iterations = opt.iterations || [];
    const last = iterations[iterations.length - 1] || {};
    const checkpoint = (opt.checkpoints || []).slice(-1)[0];
    const objectiveTerms = Object.entries(opt.objectiveTerms || {})
      .slice(0, 4)
      .map(([name, value]) => `${name} ${value.weightedContribution ?? '?'}`)
      .join(' | ');
    metrics.textContent = [
      `${tr('phase7.optimizer.stage', 'Stage', i18n)}: ${last.stage || opt.stages?.slice(-1)?.[0]?.name || 'complete'}`,
      `${tr('phase7.optimizer.iteration', 'Iteration', i18n)}: ${last.iteration ?? opt.iterationCount ?? 0}/${opt.settings?.maxIterations ?? 0}`,
      `${tr('phase7.optimizer.initialError', 'Initial error', i18n)}: ${opt.initialError ?? '?'}`,
      `${tr('phase7.optimizer.currentError', 'Current error', i18n)}: ${last.error ?? opt.finalError ?? '?'}`,
      `${tr('phase7.optimizer.bestError', 'Best error', i18n)}: ${checkpoint?.error ?? opt.finalError ?? '?'}`,
      `${tr('phase7.optimizer.checkpoint', 'Checkpoint', i18n)}: ${checkpoint?.id || '?'}`,
      `${tr('phase7.optimizer.objectiveTerms', 'Objective terms', i18n)}: ${objectiveTerms || '?'}`,
    ].join('\n');
    drawChart(iterations);
    renderPerView();
    renderTerms();
  }

  function drawChart(iterations) {
    chart.innerHTML = '';
    chart.appendChild(svgEl('rect', { x: 0, y: 0, width: 320, height: 120, fill: '#f8fbff', stroke: '#d7e5f7' }));
    if (!iterations.length) return;
    const max = Math.max(...iterations.map((item) => Number(item.error) || 0), 1);
    const points = iterations.map((item, index) => {
      const x = iterations.length === 1 ? 0 : (index / (iterations.length - 1)) * 300 + 10;
      const y = 110 - ((Number(item.error) || 0) / max) * 92;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    chart.appendChild(svgEl('polyline', { points, fill: 'none', stroke: '#0ea5e9', 'stroke-width': 2 }));
  }

  function renderPerView() {
    perView.innerHTML = '';
    const title = el('strong', null, tr('phase7.optimizer.perViewIou', 'Per-view IoU', i18n));
    perView.appendChild(title);
    (opt.perView || []).forEach((view) => {
      const row = el('div', 'silhouette-diagnostics__row');
      const bar = el('span', 'silhouette-diagnostics__bar');
      bar.style.width = `${Math.max(1, Math.min(100, Number(view.iou || 0) * 100))}%`;
      row.textContent = `${view.view || view.photoId}: IoU ${view.iou ?? '?'} Dice ${view.dice ?? '?'} p95 ${view.p95ContourDistance ?? '?'}`;
      row.appendChild(bar);
      perView.appendChild(row);
    });
  }

  function renderTerms() {
    termsPanel.innerHTML = '';
    termsPanel.appendChild(el('strong', null, tr('phase7.optimizer.objectiveTerms', 'Objective terms', i18n)));
    Object.entries(opt.objectiveTerms || {}).forEach(([name, value]) => {
      const row = el('div', 'objective-terms-panel__row');
      row.textContent = `${name}: raw ${value.rawValue ?? '?'} weight ${value.weight ?? '?'} contribution ${value.weightedContribution ?? '?'}`;
      termsPanel.appendChild(row);
    });
  }
}
